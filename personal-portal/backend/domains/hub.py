"""스니펫·링크 허브 (DESIGN.md 6.9, 7장: USER#<sub> / HUB#<id>, HUBCOL#<id>). 개인 전용.

- 스니펫: 제목·언어·코드·설명·태그 / 링크: 제목·URL·설명·태그
- 컬렉션은 폴더처럼 항목당 하나 (DESIGN.md 6.9 구현 결정). 컬렉션을 지우면 항목은 "컬렉션 없음"으로
"""

from typing import Annotated, Any, Literal
from uuid import uuid4

from aws_lambda_powertools.event_handler.api_gateway import Router
from aws_lambda_powertools.event_handler.exceptions import BadRequestError, NotFoundError
from boto3.dynamodb.conditions import Key
from pydantic import BaseModel, ConfigDict, Field

from common.access import current_sub
from common.aws import table
from common.http import parse_body
from common.serialize import to_dynamo, to_plain
from common.users import now_iso, user_pk

router = Router()

ID = r"^[A-Za-z0-9_-]{1,40}$"
MAX_ITEMS = 1000
MAX_COLLECTIONS = 50
Kind = Literal["snippet", "link"]
Lang = Literal[
    "bash", "powershell", "python", "javascript", "typescript", "json", "yaml", "sql",
    "hcl", "dockerfile", "xml", "css", "go", "java", "plaintext",
]  # fmt: skip
Tag = Annotated[str, Field(min_length=1, max_length=30)]


class ItemFields(BaseModel):
    """생성·수정 공통. 수정은 보낸 필드만 바뀌고, collectionId: null은 컬렉션에서 뺀다"""

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=200)
    lang: Lang | None = None
    code: str | None = Field(default=None, min_length=1, max_length=20000)
    url: str | None = Field(default=None, pattern=r"^https?://", max_length=2000)
    description: str | None = Field(default=None, max_length=2000)
    tags: list[Tag] | None = Field(default=None, max_length=20)
    favorite: bool | None = None
    collectionId: str | None = Field(default=None, pattern=ID)


class ItemCreate(ItemFields):
    kind: Kind
    title: str = Field(min_length=1, max_length=200)


class CollectionBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=30)
    order: float | None = None


def _strip(item: dict[str, Any]) -> dict[str, Any]:
    return to_plain({k: v for k, v in item.items() if k not in ("PK", "SK")})


def _all(sub: str, prefix: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    start: dict[str, Any] | None = None
    while True:
        page = table().query(
            KeyConditionExpression=Key("PK").eq(user_pk(sub)) & Key("SK").begins_with(prefix),
            **({"ExclusiveStartKey": start} if start else {}),
        )
        items.extend(page["Items"])
        start = page.get("LastEvaluatedKey")
        if not start:
            return items


def _get(sub: str, sk: str, what: str) -> dict[str, Any]:
    item = table().get_item(Key={"PK": user_pk(sub), "SK": sk}).get("Item")
    if item is None:
        raise NotFoundError(f"{what} not found")
    return item


def _validate(sub: str, item: dict[str, Any]) -> dict[str, Any]:
    """종류별 필수 항목, 다른 종류 필드 정리, 태그 정리, 컬렉션 존재 확인"""
    if item["kind"] == "snippet":
        if not item.get("code"):
            raise BadRequestError("snippet needs code")
        item.setdefault("lang", "plaintext")
        item.pop("url", None)
    else:
        if not item.get("url"):
            raise BadRequestError("link needs url")
        item.pop("code", None)
        item.pop("lang", None)
    if "tags" in item:
        item["tags"] = list(dict.fromkeys(t.strip() for t in item["tags"] if t.strip()))
    if item.get("collectionId"):
        _get(sub, f"HUBCOL#{item['collectionId']}", "collection")
    else:
        item.pop("collectionId", None)
    return item


# 컬렉션 경로를 /hub/<id> 보다 먼저 등록한다 (Powertools는 등록 순서대로 매칭)
@router.get("/hub/collections")
def list_collections() -> dict[str, Any]:
    items = [_strip(i) for i in _all(current_sub(router), "HUBCOL#")]
    return {"collections": sorted(items, key=lambda c: c["order"])}


@router.post("/hub/collections")
def create_collection() -> dict[str, Any]:
    sub = current_sub(router)
    body = parse_body(router, CollectionBody)
    if not body.name:
        raise BadRequestError("name is required")
    existing = _all(sub, "HUBCOL#")
    if len(existing) >= MAX_COLLECTIONS:
        raise BadRequestError(f"up to {MAX_COLLECTIONS} collections")
    cid = uuid4().hex[:12]
    order = max((float(c["order"]) for c in existing), default=0.0) + 1
    item = {"PK": user_pk(sub), "SK": f"HUBCOL#{cid}", "id": cid, "name": body.name, "order": to_dynamo(order)}
    table().put_item(Item=item)
    return _strip(item)


@router.patch("/hub/collections/<cid>")
def patch_collection(cid: str) -> dict[str, Any]:
    sub = current_sub(router)
    changes = parse_body(router, CollectionBody).model_dump(exclude_none=True)
    if not changes:
        raise BadRequestError("nothing to update")
    item = {**_get(sub, f"HUBCOL#{cid}", "collection"), **to_dynamo(changes)}
    table().put_item(Item=item)
    return _strip(item)


@router.delete("/hub/collections/<cid>")
def delete_collection(cid: str) -> dict[str, Any]:
    sub = current_sub(router)
    _get(sub, f"HUBCOL#{cid}", "collection")
    moved = 0
    for item in _all(sub, "HUB#"):
        if item.get("collectionId") == cid:
            table().put_item(Item={k: v for k, v in item.items() if k != "collectionId"})
            moved += 1
    table().delete_item(Key={"PK": user_pk(sub), "SK": f"HUBCOL#{cid}"})
    return {"deleted": cid, "moved": moved}


@router.get("/hub")
def list_items() -> dict[str, Any]:
    items = [_strip(i) for i in _all(current_sub(router), "HUB#")]
    return {"items": sorted(items, key=lambda i: i["updatedAt"], reverse=True)}


@router.post("/hub")
def create_item() -> dict[str, Any]:
    sub = current_sub(router)
    data = parse_body(router, ItemCreate).model_dump(exclude_none=True)
    if len(_all(sub, "HUB#")) >= MAX_ITEMS:
        raise BadRequestError(f"up to {MAX_ITEMS} items")
    now = now_iso()
    item_id = uuid4().hex[:12]
    item = _validate(sub, {"id": item_id, "description": "", "tags": [], "favorite": False, **data, "createdAt": now, "updatedAt": now})
    table().put_item(Item={"PK": user_pk(sub), "SK": f"HUB#{item_id}", **item})
    return item


@router.patch("/hub/<item_id>")
def patch_item(item_id: str) -> dict[str, Any]:
    sub = current_sub(router)
    changes = parse_body(router, ItemFields).model_dump(exclude_unset=True)
    if not changes:
        raise BadRequestError("nothing to update")
    for field in ("title", "lang", "code", "url", "favorite"):
        if field in changes and changes[field] is None:
            raise BadRequestError(f"{field} cannot be null")
    for field, empty in (("description", ""), ("tags", [])):
        if field in changes and changes[field] is None:
            changes[field] = empty
    current = _strip(_get(sub, f"HUB#{item_id}", "item"))
    item = _validate(sub, {**current, **changes, "updatedAt": now_iso()})
    table().put_item(Item={"PK": user_pk(sub), "SK": f"HUB#{item_id}", **item})
    return item


@router.delete("/hub/<item_id>")
def delete_item(item_id: str) -> dict[str, Any]:
    sub = current_sub(router)
    _get(sub, f"HUB#{item_id}", "item")
    table().delete_item(Key={"PK": user_pk(sub), "SK": f"HUB#{item_id}"})
    return {"deleted": item_id}
