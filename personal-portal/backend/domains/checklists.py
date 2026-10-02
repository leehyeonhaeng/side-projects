"""공용 체크리스트 (DESIGN.md 6.10, 7.2: LIST#<id> / META, MEMBER#<sub>, ITEM#<id>, GSI1 USER#<sub> / LIST#<id>,
7.1: USER#<sub> / LISTTPL#<id>). 멤버·권한은 domains/sharing.py (보드와 같은 규칙).

항목 순서: 추가한 순서(order), 체크한 항목은 화면에서 아래로. 체크하면 체크한 사람·시각을 남긴다.
"""

from typing import Any
from uuid import uuid4

from aws_lambda_powertools.event_handler.api_gateway import Router
from aws_lambda_powertools.event_handler.exceptions import BadRequestError, NotFoundError
from boto3.dynamodb.conditions import Key
from pydantic import BaseModel, ConfigDict, Field

from common.access import current_access
from common.aws import table
from common.http import parse_body
from common.perms import Module
from common.serialize import to_dynamo, to_plain
from common.users import now_iso, user_pk
from domains.sharing import Space, effective, query_all

router = Router()
SPACE = Space(router, "LIST", Module.CHECKLISTS)

MAX_ITEMS = 300
MAX_TEMPLATES = 20


class ListCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=40)
    icon: str = Field(default="📝", min_length=1, max_length=8)  # 정해진 이모지 중 하나 (프론트에서 선택)
    templateId: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{1,40}$")


class ListPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=40)
    icon: str | None = Field(default=None, min_length=1, max_length=8)


class ItemsAdd(BaseModel):
    """한 번에 여러 줄 추가 (붙여넣기)"""

    model_config = ConfigDict(extra="forbid")

    texts: list[str] = Field(min_length=1, max_length=50)


class ItemPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str | None = Field(default=None, min_length=1, max_length=200)
    done: bool | None = None


class TemplateCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=40)
    listId: str = Field(pattern=r"^[A-Za-z0-9_-]{1,40}$")  # 이 리스트의 항목 내용을 저장


def _strip(item: dict[str, Any]) -> dict[str, Any]:
    return to_plain({k: v for k, v in item.items() if k not in ("PK", "SK", "GSI1PK", "GSI1SK")})


def _load(lid: str) -> tuple[dict[str, Any] | None, dict[str, dict[str, Any]], list[dict[str, Any]]]:
    """META, 멤버, 항목(추가순)"""
    meta: dict[str, Any] | None = None
    members: dict[str, dict[str, Any]] = {}
    items: list[dict[str, Any]] = []
    for i in query_all(KeyConditionExpression=Key("PK").eq(SPACE.pk(lid))):
        sk: str = i["SK"]
        if sk == "META":
            meta = _strip(i)
        elif sk.startswith("MEMBER#"):
            members[i["sub"]] = _strip(i)
        elif sk.startswith("ITEM#"):
            items.append(_strip(i))
    items.sort(key=lambda x: x["order"])
    return meta, members, items


def _new_items(lid: str, texts: list[str], start: float) -> list[dict[str, Any]]:
    now = now_iso()
    out = []
    for n, text in enumerate(texts):
        iid = uuid4().hex[:12]
        out.append({"PK": SPACE.pk(lid), "SK": f"ITEM#{iid}", "id": iid, "text": text, "done": False, "order": to_dynamo(start + n), "createdAt": now})
    return out


def _clean(texts: list[str]) -> list[str]:
    cleaned = [t.strip()[:200] for t in texts if t.strip()]
    if not cleaned:
        raise BadRequestError("text is required")
    return cleaned


def _write(items: list[dict[str, Any]]) -> None:
    with table().batch_writer() as batch:
        for i in items:
            batch.put_item(Item=i)


# ── 리스트 ───────────────────────────────────────────

@router.get("/checklists")
def list_lists() -> dict[str, Any]:
    access = current_access(router)
    out = []
    for m in SPACE.memberships(access.identity.sub):
        lid = m["GSI1SK"].removeprefix("LIST#")
        meta, members, items = _load(lid)
        if meta is None:
            continue
        out.append(
            {
                **meta,
                "role": effective(m["role"], access.level),
                "favorite": bool(m.get("favorite")),
                "remaining": sum(1 for i in items if not i["done"]),
                "total": len(items),
                "memberCount": len(members),
            }
        )
    return {"lists": sorted(out, key=lambda x: x["createdAt"])}


@router.post("/checklists")
def create_list() -> dict[str, Any]:
    sub = current_access(router).identity.sub
    body = parse_body(router, ListCreate)
    texts: list[str] = []
    if body.templateId:
        tpl = table().get_item(Key={"PK": user_pk(sub), "SK": f"LISTTPL#{body.templateId}"}).get("Item")
        if tpl is None:
            raise NotFoundError("template not found")
        texts = list(tpl["items"])
    lid = uuid4().hex[:12]
    meta = {"PK": SPACE.pk(lid), "SK": "META", "id": lid, "name": body.name, "icon": body.icon, "ownerSub": sub, "createdAt": now_iso()}
    _write([meta, SPACE.member_item(lid, sub, "owner"), *_new_items(lid, texts, 1)])
    return _strip(meta)


# 템플릿 경로는 /checklists/<rid> 보다 먼저 등록한다 (Powertools는 등록 순서대로 매칭)
@router.get("/checklists/templates")
def list_templates() -> dict[str, Any]:
    sub = current_access(router).identity.sub
    items = query_all(KeyConditionExpression=Key("PK").eq(user_pk(sub)) & Key("SK").begins_with("LISTTPL#"))
    return {"templates": sorted((_strip(i) for i in items), key=lambda t: t["createdAt"])}


@router.post("/checklists/templates")
def create_template() -> dict[str, Any]:
    sub = current_access(router).identity.sub
    body = parse_body(router, TemplateCreate)
    SPACE.authorize(body.listId, "view")
    existing = table().query(KeyConditionExpression=Key("PK").eq(user_pk(sub)) & Key("SK").begins_with("LISTTPL#"), Select="COUNT")
    if existing["Count"] >= MAX_TEMPLATES:
        raise BadRequestError(f"up to {MAX_TEMPLATES} templates")
    meta, _, items = _load(body.listId)
    if not items:
        raise BadRequestError("the list has no items")
    tid = uuid4().hex[:12]
    item = {"PK": user_pk(sub), "SK": f"LISTTPL#{tid}", "id": tid, "name": body.name, "icon": (meta or {}).get("icon", "📝"), "items": [i["text"] for i in items], "createdAt": now_iso()}
    table().put_item(Item=item)
    return _strip(item)


@router.delete("/checklists/templates/<tid>")
def delete_template(tid: str) -> dict[str, Any]:
    sub = current_access(router).identity.sub
    key = {"PK": user_pk(sub), "SK": f"LISTTPL#{tid}"}
    if table().get_item(Key=key).get("Item") is None:
        raise NotFoundError("template not found")
    table().delete_item(Key=key)
    return {"deleted": tid}


@router.get("/checklists/<rid>")
def get_list(rid: str) -> dict[str, Any]:
    sub, role = SPACE.authorize(rid, "view")
    meta, members, items = _load(rid)
    if meta is None:
        raise NotFoundError("checklists not found")
    return {"list": meta, "role": role, "favorite": bool(members[sub].get("favorite")), "items": items, "members": Space.member_views(members)}


@router.patch("/checklists/<rid>")
def patch_list(rid: str) -> dict[str, Any]:
    SPACE.authorize(rid, "edit")
    changes = parse_body(router, ListPatch).model_dump(exclude_none=True)
    if not changes:
        raise BadRequestError("nothing to update")
    item = table().get_item(Key={"PK": SPACE.pk(rid), "SK": "META"}).get("Item")
    if item is None:
        raise NotFoundError("checklists not found")
    item = {**item, **changes}
    table().put_item(Item=item)
    return _strip(item)


@router.delete("/checklists/<rid>")
def delete_list(rid: str) -> dict[str, Any]:
    SPACE.authorize(rid, "owner")
    items = query_all(KeyConditionExpression=Key("PK").eq(SPACE.pk(rid)))
    with table().batch_writer() as batch:
        for i in items:
            batch.delete_item(Key={"PK": i["PK"], "SK": i["SK"]})
    return {"deleted": len(items)}


# ── 항목 ─────────────────────────────────────────────

@router.post("/checklists/<rid>/items")
def add_items(rid: str) -> dict[str, Any]:
    SPACE.authorize(rid, "edit")
    texts = _clean(parse_body(router, ItemsAdd).texts)
    _, _, items = _load(rid)
    if len(items) + len(texts) > MAX_ITEMS:
        raise BadRequestError(f"up to {MAX_ITEMS} items per list")
    new = _new_items(rid, texts, max((float(i["order"]) for i in items), default=0.0) + 1)
    _write(new)
    return {"items": [_strip(i) for i in new]}


@router.patch("/checklists/<rid>/items/<iid>")
def patch_item(rid: str, iid: str) -> dict[str, Any]:
    """체크하면 체크한 사람·시각을 남기고, 해제하면 지운다"""
    sub, _ = SPACE.authorize(rid, "edit")
    body = parse_body(router, ItemPatch)
    key = {"PK": SPACE.pk(rid), "SK": f"ITEM#{iid}"}
    item = table().get_item(Key=key).get("Item")
    if item is None:
        raise NotFoundError("item not found")
    if body.text is not None:
        item["text"] = body.text.strip() or item["text"]
    if body.done is not None and body.done != item["done"]:
        item["done"] = body.done
        if body.done:
            item |= {"doneBy": sub, "doneAt": now_iso()}
        else:
            item.pop("doneBy", None)
            item.pop("doneAt", None)
    table().put_item(Item=item)
    return _strip(item)


@router.delete("/checklists/<rid>/items/<iid>")
def delete_item(rid: str, iid: str) -> dict[str, Any]:
    SPACE.authorize(rid, "edit")
    key = {"PK": SPACE.pk(rid), "SK": f"ITEM#{iid}"}
    if table().get_item(Key=key).get("Item") is None:
        raise NotFoundError("item not found")
    table().delete_item(Key=key)
    return {"deleted": iid}


@router.post("/checklists/<rid>/clear-done")
def clear_done(rid: str) -> dict[str, Any]:
    """체크한 항목 일괄 삭제"""
    SPACE.authorize(rid, "edit")
    _, _, items = _load(rid)
    done = [i for i in items if i["done"]]
    with table().batch_writer() as batch:
        for i in done:
            batch.delete_item(Key={"PK": SPACE.pk(rid), "SK": f"ITEM#{i['id']}"})
    return {"deleted": len(done)}


@router.post("/checklists/<rid>/uncheck-all")
def uncheck_all(rid: str) -> dict[str, Any]:
    """전체 체크 해제 (다시 쓰는 장보기·준비물 리스트용)"""
    SPACE.authorize(rid, "edit")
    _, _, items = _load(rid)
    done = [i for i in items if i["done"]]
    _write([{**{k: v for k, v in to_dynamo(i).items() if k not in ("doneBy", "doneAt")}, "PK": SPACE.pk(rid), "SK": f"ITEM#{i['id']}", "done": False} for i in done])
    return {"unchecked": len(done)}


SPACE.register_member_routes("/checklists/<rid>")
