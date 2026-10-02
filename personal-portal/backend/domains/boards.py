"""작업 보드 (DESIGN.md 6.6, 7.2: BOARD#<id> / META, MEMBER#<sub>, COL#<id>, CARD#<id>, GSI1 USER#<sub> / BOARD#<id>).

권한 (DESIGN.md 4.2, 6.6 구현 결정)
- 모듈 PERM은 미들웨어가 확인하고, 여기서는 보드 멤버 여부와 역할을 확인한다
- 실제 역할은 모듈 권한과 보드 역할 중 낮은 쪽 (모듈 view면 보드 편집자라도 열람만)
- 만든 사람이 소유자: 멤버 관리·보드 삭제는 소유자만. 멤버가 아니면 보드가 없는 것처럼 404
"""

from datetime import date
from typing import Annotated, Any, Literal
from uuid import uuid4

from aws_lambda_powertools.event_handler.api_gateway import Router
from aws_lambda_powertools.event_handler.exceptions import BadRequestError, ForbiddenError, NotFoundError
from boto3.dynamodb.conditions import Key
from pydantic import BaseModel, ConfigDict, Field

from common.access import current_access
from common.aws import dynamodb, table
from common.http import parse_body
from common.perms import Level, Module, Role, Status, allows
from common.serialize import to_dynamo, to_plain
from common.users import load_access, now_iso, user_pk

router = Router()

ID = r"^[A-Za-z0-9_-]{1,40}$"
MAX_COLUMNS = 20
MAX_CARDS = 500
DEFAULT_COLUMNS = [("할 일", False), ("진행 중", False), ("완료", True)]

BoardRole = Literal["owner", "editor", "viewer"]
MemberRole = Literal["editor", "viewer"]
Color = Literal["gray", "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink"]
Priority = Literal["high", "normal", "low"]
Need = Literal["view", "edit", "owner"]


class Label(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=ID)
    name: str = Field(default="", max_length=20)
    color: Color


class BoardCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=60)


class BoardPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=60)
    labels: list[Label] | None = Field(default=None, max_length=20)


class MemberAdd(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sub: str = Field(pattern=ID)
    role: MemberRole


class MemberPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: MemberRole


class ColumnCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=30)
    done: bool = False


class ColumnPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=30)
    order: float | None = None
    done: bool | None = None  # 완료 컬럼: 진행률 계산에 쓴다


class CheckItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=ID)
    text: str = Field(min_length=1, max_length=200)
    done: bool = False


class Link(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(default="", max_length=100)
    url: str = Field(pattern=r"^https?://", max_length=1000)


class CardFields(BaseModel):
    """생성·수정 공통. 수정은 보낸 필드만 바뀌고 null은 비운다"""

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=10000)  # 마크다운
    assignee: str | None = Field(default=None, pattern=ID)
    due: date | None = None
    priority: Priority | None = None
    labels: list[Annotated[str, Field(pattern=ID)]] | None = Field(default=None, max_length=20)
    checklist: list[CheckItem] | None = Field(default=None, max_length=50)
    links: list[Link] | None = Field(default=None, max_length=20)
    columnId: str | None = Field(default=None, pattern=ID)
    order: float | None = None


class CardCreate(CardFields):
    title: str = Field(min_length=1, max_length=200)
    columnId: str = Field(pattern=ID)


# ── 저장소 ───────────────────────────────────────────

def _pk(bid: str) -> str:
    return f"BOARD#{bid}"


def _strip(item: dict[str, Any]) -> dict[str, Any]:
    return to_plain({k: v for k, v in item.items() if k not in ("PK", "SK", "GSI1PK", "GSI1SK")})


def _items(bid: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    start: dict[str, Any] | None = None
    while True:
        page = table().query(KeyConditionExpression=Key("PK").eq(_pk(bid)), **({"ExclusiveStartKey": start} if start else {}))
        items.extend(page["Items"])
        start = page.get("LastEvaluatedKey")
        if not start:
            return items


class Snapshot:
    """보드 파티션 한 번 조회로 META·멤버·컬럼·카드를 나눈다"""

    def __init__(self, bid: str) -> None:
        self.meta: dict[str, Any] | None = None
        self.members: dict[str, dict[str, Any]] = {}
        self.columns: list[dict[str, Any]] = []
        self.cards: list[dict[str, Any]] = []
        for item in _items(bid):
            sk: str = item["SK"]
            if sk == "META":
                self.meta = _strip(item)
            elif sk.startswith("MEMBER#"):
                self.members[item["sub"]] = _strip(item)
            elif sk.startswith("COL#"):
                self.columns.append(_strip(item))
            elif sk.startswith("CARD#") and "#" not in sk.removeprefix("CARD#"):
                self.cards.append(_strip(item))
        self.columns.sort(key=lambda c: c["order"])
        self.cards.sort(key=lambda c: c["order"])

    def progress(self) -> dict[str, int]:
        done_cols = {c["id"] for c in self.columns if c.get("done")}
        return {"done": sum(1 for c in self.cards if c["columnId"] in done_cols), "total": len(self.cards)}


def _effective(role: BoardRole, level: Level) -> BoardRole:
    return role if level == Level.EDIT else "viewer"


def _authorize(bid: str, need: Need) -> tuple[str, BoardRole]:
    access = current_access(router)
    sub = access.identity.sub
    member = table().get_item(Key={"PK": _pk(bid), "SK": f"MEMBER#{sub}"}).get("Item")
    if member is None:
        raise NotFoundError("board not found")
    role = _effective(member["role"], access.level)
    if need == "edit" and role == "viewer":
        raise ForbiddenError("board is read-only for you")
    if need == "owner" and role != "owner":
        raise ForbiddenError("only the board owner can do this")
    return sub, role


def _member_item(bid: str, sub: str, role: BoardRole) -> dict[str, Any]:
    return {"PK": _pk(bid), "SK": f"MEMBER#{sub}", "sub": sub, "role": role, "addedAt": now_iso(), "GSI1PK": user_pk(sub), "GSI1SK": f"BOARD#{bid}"}


def _profiles(subs: list[str]) -> dict[str, dict[str, Any]]:
    if not subs:
        return {}
    name = table().name
    out: dict[str, dict[str, Any]] = {}
    for i in range(0, len(subs), 100):
        keys = [{"PK": user_pk(s), "SK": "PROFILE"} for s in subs[i : i + 100]]
        res = dynamodb().batch_get_item(RequestItems={name: {"Keys": keys}})
        for p in res["Responses"].get(name, []):
            out[p["sub"]] = p
    return out


def _can_join(sub: str) -> dict[str, Any] | None:
    """초대 가능한 계정: 활성 + 보드 모듈 view 이상 (Host는 항상)"""
    profile, level = load_access(sub, Module.BOARDS)
    if profile is None or profile.get("status") != Status.ACTIVE:
        return None
    if profile.get("role") != Role.HOST and not allows(level, Level.VIEW):
        return None
    return profile


def _person(p: dict[str, Any] | None, sub: str) -> dict[str, str]:
    return {"sub": sub, "name": (p or {}).get("name", ""), "email": (p or {}).get("email", "")}


def _next_order(items: list[dict[str, Any]]) -> float:
    return max((float(i["order"]) for i in items), default=0.0) + 1


# ── 보드 ─────────────────────────────────────────────

@router.get("/boards")
def list_boards() -> dict[str, Any]:
    access = current_access(router)
    res = table().query(
        IndexName="GSI1",
        KeyConditionExpression=Key("GSI1PK").eq(user_pk(access.identity.sub)) & Key("GSI1SK").begins_with("BOARD#"),
    )
    boards = []
    for m in res["Items"]:
        bid = m["GSI1SK"].removeprefix("BOARD#")
        snap = Snapshot(bid)
        if snap.meta is None:
            continue
        boards.append({**snap.meta, "role": _effective(m["role"], access.level), "progress": snap.progress(), "memberCount": len(snap.members)})
    boards.sort(key=lambda b: b["createdAt"])
    return {"boards": boards}


@router.post("/boards")
def create_board() -> dict[str, Any]:
    sub = current_access(router).identity.sub
    body = parse_body(router, BoardCreate)
    bid = uuid4().hex[:12]
    now = now_iso()
    meta = {"PK": _pk(bid), "SK": "META", "id": bid, "name": body.name, "ownerSub": sub, "labels": [], "createdAt": now}
    with table().batch_writer() as batch:
        batch.put_item(Item=meta)
        batch.put_item(Item=_member_item(bid, sub, "owner"))
        for i, (name, done) in enumerate(DEFAULT_COLUMNS, start=1):
            cid = uuid4().hex[:12]
            batch.put_item(Item={"PK": _pk(bid), "SK": f"COL#{cid}", "id": cid, "name": name, "order": i, "done": done})
    return _strip(meta)


@router.get("/boards/<bid>")
def get_board(bid: str) -> dict[str, Any]:
    _, role = _authorize(bid, "view")
    snap = Snapshot(bid)
    if snap.meta is None:
        raise NotFoundError("board not found")
    profiles = _profiles(list(snap.members))
    members = [{**_person(profiles.get(s), s), "role": m["role"]} for s, m in snap.members.items()]
    members.sort(key=lambda m: (m["role"] != "owner", m["name"]))
    return {"board": snap.meta, "role": role, "columns": snap.columns, "cards": snap.cards, "members": members, "progress": snap.progress()}


@router.patch("/boards/<bid>")
def patch_board(bid: str) -> dict[str, Any]:
    _authorize(bid, "edit")
    body = parse_body(router, BoardPatch)
    changes = body.model_dump(exclude_none=True)
    if not changes:
        raise BadRequestError("nothing to update")
    item = table().get_item(Key={"PK": _pk(bid), "SK": "META"}).get("Item")
    if item is None:
        raise NotFoundError("board not found")
    item = {**item, **to_dynamo(changes)}
    table().put_item(Item=item)
    if "labels" in changes:
        # 지운 라벨은 카드에서도 뺀다
        keep = {lb["id"] for lb in changes["labels"]}
        for card in Snapshot(bid).cards:
            labels = card.get("labels", [])
            if any(lb not in keep for lb in labels):
                _update_card_fields(bid, card["id"], {"labels": [lb for lb in labels if lb in keep]})
    return _strip(item)


@router.delete("/boards/<bid>")
def delete_board(bid: str) -> dict[str, Any]:
    _authorize(bid, "owner")
    items = _items(bid)
    with table().batch_writer() as batch:
        for i in items:
            batch.delete_item(Key={"PK": i["PK"], "SK": i["SK"]})
    return {"deleted": len(items)}


# ── 멤버 ─────────────────────────────────────────────

@router.get("/boards/<bid>/candidates")
def candidates(bid: str) -> dict[str, Any]:
    """초대할 수 있는 계정 (이미 멤버인 계정 제외)"""
    _authorize(bid, "owner")
    members = set(Snapshot(bid).members)
    out = []
    for p in _active_profiles():
        if p["sub"] not in members and _can_join(p["sub"]) is not None:
            out.append(_person(p, p["sub"]))
    out.sort(key=lambda p: p["name"])
    return {"candidates": out}


def _active_profiles() -> list[dict[str, Any]]:
    res = table().query(IndexName="GSI1", KeyConditionExpression=Key("GSI1PK").eq(f"STATUS#{Status.ACTIVE}"))
    return list(res["Items"])


@router.post("/boards/<bid>/members")
def add_member(bid: str) -> dict[str, Any]:
    _authorize(bid, "owner")
    body = parse_body(router, MemberAdd)
    if table().get_item(Key={"PK": _pk(bid), "SK": f"MEMBER#{body.sub}"}).get("Item"):
        raise BadRequestError("already a member")
    profile = _can_join(body.sub)
    if profile is None:
        raise BadRequestError("this account cannot join boards")
    table().put_item(Item=_member_item(bid, body.sub, body.role))
    return {**_person(profile, body.sub), "role": body.role}


@router.patch("/boards/<bid>/members/<msub>")
def patch_member(bid: str, msub: str) -> dict[str, Any]:
    _authorize(bid, "owner")
    body = parse_body(router, MemberPatch)
    member = table().get_item(Key={"PK": _pk(bid), "SK": f"MEMBER#{msub}"}).get("Item")
    if member is None:
        raise NotFoundError("member not found")
    if member["role"] == "owner":
        raise BadRequestError("owner role cannot be changed")
    table().put_item(Item={**member, "role": body.role})
    return {"sub": msub, "role": body.role}


@router.delete("/boards/<bid>/members/<msub>")
def remove_member(bid: str, msub: str) -> dict[str, Any]:
    """소유자가 내보내거나, 멤버가 스스로 나간다. 소유자는 나갈 수 없다 (보드 삭제)"""
    access = current_access(router)
    me = access.identity.sub
    mine = table().get_item(Key={"PK": _pk(bid), "SK": f"MEMBER#{me}"}).get("Item")
    if mine is None:
        raise NotFoundError("board not found")
    if msub != me and _effective(mine["role"], access.level) != "owner":
        raise ForbiddenError("only the board owner can do this")
    snap = Snapshot(bid)
    target = snap.members.get(msub)
    if target is None:
        raise NotFoundError("member not found")
    if target["role"] == "owner":
        raise BadRequestError("owner cannot leave; delete the board instead")
    table().delete_item(Key={"PK": _pk(bid), "SK": f"MEMBER#{msub}"})
    for card in snap.cards:
        if card.get("assignee") == msub:
            _update_card_fields(bid, card["id"], {"assignee": None})
    return {"removed": msub}


# ── 컬럼 ─────────────────────────────────────────────

@router.post("/boards/<bid>/columns")
def create_column(bid: str) -> dict[str, Any]:
    _authorize(bid, "edit")
    body = parse_body(router, ColumnCreate)
    snap = Snapshot(bid)
    if len(snap.columns) >= MAX_COLUMNS:
        raise BadRequestError(f"up to {MAX_COLUMNS} columns")
    cid = uuid4().hex[:12]
    item = {"PK": _pk(bid), "SK": f"COL#{cid}", "id": cid, "name": body.name, "order": to_dynamo(_next_order(snap.columns)), "done": body.done}
    table().put_item(Item=item)
    return _strip(item)


@router.patch("/boards/<bid>/columns/<cid>")
def patch_column(bid: str, cid: str) -> dict[str, Any]:
    _authorize(bid, "edit")
    changes = parse_body(router, ColumnPatch).model_dump(exclude_none=True)
    if not changes:
        raise BadRequestError("nothing to update")
    item = table().get_item(Key={"PK": _pk(bid), "SK": f"COL#{cid}"}).get("Item")
    if item is None:
        raise NotFoundError("column not found")
    item = {**item, **to_dynamo(changes)}
    table().put_item(Item=item)
    return _strip(item)


@router.delete("/boards/<bid>/columns/<cid>")
def delete_column(bid: str, cid: str) -> dict[str, Any]:
    _authorize(bid, "edit")
    snap = Snapshot(bid)
    if not any(c["id"] == cid for c in snap.columns):
        raise NotFoundError("column not found")
    if len(snap.columns) == 1:
        raise BadRequestError("a board needs at least one column")
    if any(c["columnId"] == cid for c in snap.cards):
        raise BadRequestError("move or delete the cards in this column first")
    table().delete_item(Key={"PK": _pk(bid), "SK": f"COL#{cid}"})
    return {"deleted": cid}


# ── 카드 ─────────────────────────────────────────────

def _validate_refs(snap: Snapshot, data: dict[str, Any]) -> None:
    if "columnId" in data and not any(c["id"] == data["columnId"] for c in snap.columns):
        raise BadRequestError("column not found")
    if data.get("assignee") and data["assignee"] not in snap.members:
        raise BadRequestError("assignee must be a board member")
    if data.get("labels"):
        known = {lb["id"] for lb in (snap.meta or {}).get("labels", [])}
        if any(lb not in known for lb in data["labels"]):
            raise BadRequestError("unknown label")
        data["labels"] = list(dict.fromkeys(data["labels"]))


def _update_card_fields(bid: str, card_id: str, changes: dict[str, Any]) -> dict[str, Any]:
    item = table().get_item(Key={"PK": _pk(bid), "SK": f"CARD#{card_id}"}).get("Item")
    if item is None:
        raise NotFoundError("card not found")
    merged = {**item, **to_dynamo(changes), "updatedAt": now_iso()}
    merged = {k: v for k, v in merged.items() if v is not None}
    table().put_item(Item=merged)
    return _strip(merged)


@router.post("/boards/<bid>/cards")
def create_card(bid: str) -> dict[str, Any]:
    sub, _ = _authorize(bid, "edit")
    data = parse_body(router, CardCreate).model_dump(exclude_none=True)
    snap = Snapshot(bid)
    if len(snap.cards) >= MAX_CARDS:
        raise BadRequestError(f"up to {MAX_CARDS} cards per board")
    _validate_refs(snap, data)
    if "order" not in data:
        data["order"] = _next_order([c for c in snap.cards if c["columnId"] == data["columnId"]])
    card_id = uuid4().hex[:12]
    now = now_iso()
    item = {
        "PK": _pk(bid),
        "SK": f"CARD#{card_id}",
        "id": card_id,
        "description": "",
        "priority": "normal",
        "labels": [],
        "checklist": [],
        "links": [],
        **to_dynamo(data),
        "createdBy": sub,
        "createdAt": now,
        "updatedAt": now,
    }
    table().put_item(Item=item)
    return _strip(item)


@router.patch("/boards/<bid>/cards/<card_id>")
def patch_card(bid: str, card_id: str) -> dict[str, Any]:
    _authorize(bid, "edit")
    changes = parse_body(router, CardFields).model_dump(exclude_unset=True)
    if not changes:
        raise BadRequestError("nothing to update")
    for field in ("title", "columnId", "order"):
        if field in changes and changes[field] is None:
            raise BadRequestError(f"{field} cannot be null")
    if changes.get("priority", "x") is None:
        changes["priority"] = "normal"
    for field in ("labels", "checklist", "links"):
        if field in changes and changes[field] is None:
            changes[field] = []
    if changes.keys() & {"columnId", "assignee", "labels"}:
        _validate_refs(Snapshot(bid), changes)
    return _update_card_fields(bid, card_id, changes)


@router.delete("/boards/<bid>/cards/<card_id>")
def delete_card(bid: str, card_id: str) -> dict[str, Any]:
    _authorize(bid, "edit")
    if table().get_item(Key={"PK": _pk(bid), "SK": f"CARD#{card_id}"}).get("Item") is None:
        raise NotFoundError("card not found")
    table().delete_item(Key={"PK": _pk(bid), "SK": f"CARD#{card_id}"})
    return {"deleted": card_id}
