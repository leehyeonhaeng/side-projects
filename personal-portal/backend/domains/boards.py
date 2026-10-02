"""작업 보드 (DESIGN.md 6.6, 7.2: BOARD#<id> / META, MEMBER#<sub>, COL#<id>, CARD#<id>, CARD#<id>#CMT#<ts>, ACT#<ts>,
GSI1 USER#<sub> / BOARD#<id>, 7.1: USER#<sub> / BOARDTPL#<id>).

권한 (DESIGN.md 4.2, 6.6 구현 결정)
- 모듈 PERM은 미들웨어가 확인하고, 여기서는 보드 멤버 여부와 역할을 확인한다
- 실제 역할은 모듈 권한과 보드 역할 중 낮은 쪽 (모듈 view면 보드 편집자라도 열람만)
- 만든 사람이 소유자: 멤버 관리·보드 삭제는 소유자만. 멤버가 아니면 보드가 없는 것처럼 404
"""

from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Any, Literal
from uuid import uuid4

from aws_lambda_powertools.event_handler.api_gateway import Router
from aws_lambda_powertools.event_handler.exceptions import BadRequestError, ForbiddenError, NotFoundError
from boto3.dynamodb.conditions import Attr, Key
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
MAX_CARDS = 500  # 보관하지 않은 카드 기준
MAX_TEMPLATES = 20
ACTIVITY_LIMIT = 50
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
    templateId: str | None = Field(default=None, pattern=ID)


class BoardPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=60)
    labels: list[Label] | None = Field(default=None, max_length=20)


class TemplateCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=40)
    boardId: str = Field(pattern=ID)  # 이 보드의 컬럼 구성·라벨을 저장


class FavoriteBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    favorite: bool


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
    done: bool | None = None  # 완료 컬럼: 진행률 계산·일괄 보관에 쓴다


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


class CardPatch(CardFields):
    archived: bool | None = None  # true 보관, false 복구


class CommentBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=2000)


# ── 저장소 ───────────────────────────────────────────

def _pk(bid: str) -> str:
    return f"BOARD#{bid}"


def _strip(item: dict[str, Any]) -> dict[str, Any]:
    return to_plain({k: v for k, v in item.items() if k not in ("PK", "SK", "GSI1PK", "GSI1SK")})


def _query_all(**kwargs: Any) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    start: dict[str, Any] | None = None
    while True:
        page = table().query(**kwargs, **({"ExclusiveStartKey": start} if start else {}))
        items.extend(page["Items"])
        start = page.get("LastEvaluatedKey")
        if not start:
            return items


class Snapshot:
    """보드 파티션 조회 한 번으로 META·멤버·컬럼·카드를 나눈다 (활동 기록 ACT#은 정렬상 앞이라 건너뜀)"""

    def __init__(self, bid: str) -> None:
        self.meta: dict[str, Any] | None = None
        self.members: dict[str, dict[str, Any]] = {}
        self.columns: list[dict[str, Any]] = []
        self.cards: list[dict[str, Any]] = []
        self.archived: list[dict[str, Any]] = []
        for item in _query_all(KeyConditionExpression=Key("PK").eq(_pk(bid)) & Key("SK").gt("B")):
            sk: str = item["SK"]
            if sk == "META":
                self.meta = _strip(item)
            elif sk.startswith("MEMBER#"):
                self.members[item["sub"]] = _strip(item)
            elif sk.startswith("COL#"):
                self.columns.append(_strip(item))
            elif sk.startswith("CARD#") and "#" not in sk.removeprefix("CARD#"):
                card = _strip(item)
                (self.archived if card.get("archived") else self.cards).append(card)
        self.columns.sort(key=lambda c: c["order"])
        self.cards.sort(key=lambda c: c["order"])
        self.archived.sort(key=lambda c: c.get("archivedAt", ""), reverse=True)

    @property
    def done_columns(self) -> set[str]:
        return {c["id"] for c in self.columns if c.get("done")}

    def progress(self) -> dict[str, int]:
        done = self.done_columns
        return {"done": sum(1 for c in self.cards if c["columnId"] in done), "total": len(self.cards)}

    def find_card(self, card_id: str) -> dict[str, Any]:
        card = next((c for c in self.cards + self.archived if c["id"] == card_id), None)
        if card is None:
            raise NotFoundError("card not found")
        return card


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


def _new_column(bid: str, name: str, order: float, done: bool) -> dict[str, Any]:
    cid = uuid4().hex[:12]
    return {"PK": _pk(bid), "SK": f"COL#{cid}", "id": cid, "name": name, "order": to_dynamo(order), "done": done}


# ── 활동 기록 (카드별 변경 이력) ─────────────────────

_last_ts = datetime.min.replace(tzinfo=UTC)


def _sort_ts() -> str:
    """정렬 키용 시각 (마이크로초, 프로세스 안에서 항상 증가).
    시계 해상도가 낮으면(Windows 약 15ms) 연달아 쓴 항목이 같은 시각이 되어 순서가 뒤섞이므로 직전 값보다 크게 만든다"""
    global _last_ts
    now = datetime.now(UTC)
    _last_ts = now if now > _last_ts else _last_ts + timedelta(microseconds=1)
    return _last_ts.isoformat(timespec="microseconds")


def _act(bid: str, actor: str, card: dict[str, Any], action: str, seq: int = 0, **detail: Any) -> dict[str, Any]:
    """seq: 한 요청에서 여러 개를 남길 때 같은 시각 안의 순서"""
    at = now_iso()
    return {"PK": _pk(bid), "SK": f"ACT#{_sort_ts()}#{seq:02d}{uuid4().hex[:6]}", "actor": actor, "cardId": card["id"], "cardTitle": card["title"], "action": action, "at": at, **detail}


def _write(items: list[dict[str, Any]]) -> None:
    if len(items) == 1:
        table().put_item(Item=items[0])
    elif items:
        with table().batch_writer() as batch:
            for item in items:
                batch.put_item(Item=item)


def _changes(bid: str, actor: str, old: dict[str, Any], new: dict[str, Any], snap: Snapshot) -> list[dict[str, Any]]:
    """수정 전후를 비교해 활동 기록 항목을 만든다. 같은 컬럼 안 순서 변경은 기록하지 않는다"""
    acts: list[dict[str, Any]] = []
    col_name = {c["id"]: c["name"] for c in snap.columns}
    was, now_ = bool(old.get("archived")), bool(new.get("archived"))
    if was != now_:
        acts.append(_act(bid, actor, new, seq=len(acts), action="archived" if now_ else "restored"))
    elif old["columnId"] != new["columnId"]:
        acts.append(_act(bid, actor, new, seq=len(acts), action="moved", **{"from": col_name.get(old["columnId"], ""), "to": col_name.get(new["columnId"], "")}))
    if old["title"] != new["title"]:
        acts.append(_act(bid, actor, new, seq=len(acts), action="renamed", **{"from": old["title"]}))
    for field, action in (("assignee", "assigned"), ("due", "due"), ("priority", "priority")):
        if old.get(field) != new.get(field):
            acts.append(_act(bid, actor, new, seq=len(acts), action=action, to=new.get(field, "")))
    for field in ("labels", "description", "links"):
        if old.get(field) != new.get(field):
            acts.append(_act(bid, actor, new, seq=len(acts), action=field))
    if old.get("checklist") != new.get("checklist"):
        items = new.get("checklist", [])
        acts.append(_act(bid, actor, new, seq=len(acts), action="checklist", to=f"{sum(1 for i in items if i['done'])}/{len(items)}"))
    return acts


# ── 보드 ─────────────────────────────────────────────

@router.get("/boards")
def list_boards() -> dict[str, Any]:
    """내 보드 목록 + 홈 위젯용 내 담당 카드(완료 컬럼·보관 제외)"""
    access = current_access(router)
    sub = access.identity.sub
    res = table().query(IndexName="GSI1", KeyConditionExpression=Key("GSI1PK").eq(user_pk(sub)) & Key("GSI1SK").begins_with("BOARD#"))
    boards = []
    my_cards = []
    for m in res["Items"]:
        bid = m["GSI1SK"].removeprefix("BOARD#")
        snap = Snapshot(bid)
        if snap.meta is None:
            continue
        done = snap.done_columns
        col_name = {c["id"]: c["name"] for c in snap.columns}
        active = [c for c in snap.cards if c["columnId"] not in done]
        boards.append(
            {
                **snap.meta,
                "role": _effective(m["role"], access.level),
                "favorite": bool(m.get("favorite")),
                "progress": snap.progress(),
                "memberCount": len(snap.members),
                "activeCount": len(active),
            }
        )
        for c in active:
            if c.get("assignee") == sub:
                my_cards.append({k: c[k] for k in ("id", "title", "due", "priority") if k in c} | {"boardId": bid, "boardName": snap.meta["name"], "columnName": col_name.get(c["columnId"], "")})
    boards.sort(key=lambda b: b["createdAt"])
    my_cards.sort(key=lambda c: (c.get("due", "9999-99-99"), c["title"]))
    return {"boards": boards, "myCards": my_cards}


@router.post("/boards")
def create_board() -> dict[str, Any]:
    sub = current_access(router).identity.sub
    body = parse_body(router, BoardCreate)
    columns = [{"name": n, "done": d} for n, d in DEFAULT_COLUMNS]
    labels: list[dict[str, Any]] = []
    if body.templateId:
        tpl = table().get_item(Key={"PK": user_pk(sub), "SK": f"BOARDTPL#{body.templateId}"}).get("Item")
        if tpl is None:
            raise NotFoundError("template not found")
        columns, labels = tpl["columns"], tpl["labels"]
    bid = uuid4().hex[:12]
    meta = {"PK": _pk(bid), "SK": "META", "id": bid, "name": body.name, "ownerSub": sub, "labels": labels, "createdAt": now_iso()}
    with table().batch_writer() as batch:
        batch.put_item(Item=meta)
        batch.put_item(Item=_member_item(bid, sub, "owner"))
        for i, col in enumerate(columns, start=1):
            batch.put_item(Item=_new_column(bid, col["name"], i, bool(col["done"])))
    return _strip(meta)


# 템플릿 경로는 /boards/<bid> 보다 먼저 등록해야 "templates"가 보드 id로 잡히지 않는다
@router.get("/boards/templates")
def list_templates() -> dict[str, Any]:
    sub = current_access(router).identity.sub
    items = _query_all(KeyConditionExpression=Key("PK").eq(user_pk(sub)) & Key("SK").begins_with("BOARDTPL#"))
    return {"templates": sorted((_strip(i) for i in items), key=lambda t: t["createdAt"])}


@router.post("/boards/templates")
def create_template() -> dict[str, Any]:
    sub = current_access(router).identity.sub
    body = parse_body(router, TemplateCreate)
    _authorize(body.boardId, "view")
    existing = table().query(KeyConditionExpression=Key("PK").eq(user_pk(sub)) & Key("SK").begins_with("BOARDTPL#"), Select="COUNT")
    if existing["Count"] >= MAX_TEMPLATES:
        raise BadRequestError(f"up to {MAX_TEMPLATES} templates")
    snap = Snapshot(body.boardId)
    tid = uuid4().hex[:12]
    item = {
        "PK": user_pk(sub),
        "SK": f"BOARDTPL#{tid}",
        "id": tid,
        "name": body.name,
        "columns": [{"name": c["name"], "done": bool(c.get("done"))} for c in snap.columns],
        "labels": (snap.meta or {}).get("labels", []),
        "createdAt": now_iso(),
    }
    table().put_item(Item=to_dynamo(item))
    return _strip(item)


@router.delete("/boards/templates/<tid>")
def delete_template(tid: str) -> dict[str, Any]:
    sub = current_access(router).identity.sub
    key = {"PK": user_pk(sub), "SK": f"BOARDTPL#{tid}"}
    if table().get_item(Key=key).get("Item") is None:
        raise NotFoundError("template not found")
    table().delete_item(Key=key)
    return {"deleted": tid}


@router.get("/boards/<bid>")
def get_board(bid: str) -> dict[str, Any]:
    sub, role = _authorize(bid, "view")
    snap = Snapshot(bid)
    if snap.meta is None:
        raise NotFoundError("board not found")
    profiles = _profiles(list(snap.members))
    members = [{**_person(profiles.get(s), s), "role": m["role"]} for s, m in snap.members.items()]
    members.sort(key=lambda m: (m["role"] != "owner", m["name"]))
    return {
        "board": snap.meta,
        "role": role,
        "favorite": bool(snap.members[sub].get("favorite")),
        "columns": snap.columns,
        "cards": snap.cards,
        "archivedCount": len(snap.archived),
        "members": members,
        "progress": snap.progress(),
    }


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
        # 지운 라벨은 카드(보관 포함)에서도 뺀다
        keep = {lb["id"] for lb in changes["labels"]}
        snap = Snapshot(bid)
        for card in snap.cards + snap.archived:
            labels = card.get("labels", [])
            if any(lb not in keep for lb in labels):
                _update_card_fields(bid, card["id"], {"labels": [lb for lb in labels if lb in keep]})
    return _strip(item)


@router.delete("/boards/<bid>")
def delete_board(bid: str) -> dict[str, Any]:
    _authorize(bid, "owner")
    items = _query_all(KeyConditionExpression=Key("PK").eq(_pk(bid)))
    with table().batch_writer() as batch:
        for i in items:
            batch.delete_item(Key={"PK": i["PK"], "SK": i["SK"]})
    return {"deleted": len(items)}


@router.put("/boards/<bid>/favorite")
def set_favorite(bid: str) -> dict[str, Any]:
    """즐겨찾기는 내 멤버 항목에 저장 (사람마다 다름)"""
    sub, _ = _authorize(bid, "view")
    favorite = parse_body(router, FavoriteBody).favorite
    table().update_item(
        Key={"PK": _pk(bid), "SK": f"MEMBER#{sub}"},
        UpdateExpression="SET favorite = :f",
        ExpressionAttributeValues={":f": favorite},
    )
    return {"favorite": favorite}


@router.get("/boards/<bid>/activity")
def activity(bid: str) -> dict[str, Any]:
    """최근 활동 (?cardId= 면 그 카드만), 최신순 최대 50개"""
    _authorize(bid, "view")
    card_id = (router.current_event.query_string_parameters or {}).get("cardId")
    out: list[dict[str, Any]] = []
    start: dict[str, Any] | None = None
    while len(out) < ACTIVITY_LIMIT:
        kwargs: dict[str, Any] = {
            "KeyConditionExpression": Key("PK").eq(_pk(bid)) & Key("SK").begins_with("ACT#"),
            "ScanIndexForward": False,
            "Limit": 200,
        }
        if card_id:
            kwargs["FilterExpression"] = Attr("cardId").eq(card_id)
        if start:
            kwargs["ExclusiveStartKey"] = start
        page = table().query(**kwargs)
        out.extend(page["Items"])
        start = page.get("LastEvaluatedKey")
        if not start:
            break
    return {"activity": [_strip(i) for i in out[:ACTIVITY_LIMIT]]}


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
    return _query_all(IndexName="GSI1", KeyConditionExpression=Key("GSI1PK").eq(f"STATUS#{Status.ACTIVE}"))


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
    for card in snap.cards + snap.archived:
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
    item = _new_column(bid, body.name, _next_order(snap.columns), body.done)
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
    """보관된 카드는 막지 않는다 (복구하면 첫 컬럼으로)"""
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
    _write([item, _act(bid, sub, item, "created", to=next(c["name"] for c in snap.columns if c["id"] == data["columnId"]))])
    return _strip(item)


@router.patch("/boards/<bid>/cards/<card_id>")
def patch_card(bid: str, card_id: str) -> dict[str, Any]:
    sub, _ = _authorize(bid, "edit")
    changes = parse_body(router, CardPatch).model_dump(exclude_unset=True)
    if not changes:
        raise BadRequestError("nothing to update")
    for field in ("title", "columnId", "order", "archived"):
        if field in changes and changes[field] is None:
            raise BadRequestError(f"{field} cannot be null")
    if changes.get("priority", "x") is None:
        changes["priority"] = "normal"
    for field in ("labels", "checklist", "links"):
        if field in changes and changes[field] is None:
            changes[field] = []
    snap = Snapshot(bid)
    old = snap.find_card(card_id)
    if changes.keys() & {"columnId", "assignee", "labels"}:
        _validate_refs(snap, changes)
    if "archived" in changes:
        archive = changes.pop("archived")
        if archive and not old.get("archived"):
            changes |= {"archived": True, "archivedAt": now_iso()}
        elif not archive and old.get("archived"):
            if len(snap.cards) >= MAX_CARDS:
                raise BadRequestError(f"up to {MAX_CARDS} cards per board")
            # 복구: 원래 컬럼(없어졌으면 첫 컬럼)의 맨 아래로
            col = old["columnId"] if any(c["id"] == old["columnId"] for c in snap.columns) else snap.columns[0]["id"]
            changes.setdefault("columnId", col)
            changes.setdefault("order", _next_order([c for c in snap.cards if c["columnId"] == changes["columnId"]]))
            changes |= {"archived": None, "archivedAt": None}
    new = _update_card_fields(bid, card_id, changes)
    _write(_changes(bid, sub, old, new, snap))
    return new


@router.post("/boards/<bid>/archive-done")
def archive_done(bid: str) -> dict[str, Any]:
    """완료 컬럼의 카드를 한 번에 보관"""
    sub, _ = _authorize(bid, "edit")
    snap = Snapshot(bid)
    done = snap.done_columns
    targets = [c for c in snap.cards if c["columnId"] in done]
    at = now_iso()
    items = []
    for card in targets:
        items.append({"PK": _pk(bid), "SK": f"CARD#{card['id']}", **to_dynamo(card), "archived": True, "archivedAt": at, "updatedAt": at})
        items.append(_act(bid, sub, card, "archived"))
    _write(items)
    return {"archived": len(targets)}


@router.get("/boards/<bid>/archived")
def archived_cards(bid: str) -> dict[str, Any]:
    _authorize(bid, "view")
    return {"cards": Snapshot(bid).archived}


@router.delete("/boards/<bid>/cards/<card_id>")
def delete_card(bid: str, card_id: str) -> dict[str, Any]:
    """카드와 댓글을 지운다. 활동 기록에는 삭제가 남는다"""
    sub, _ = _authorize(bid, "edit")
    card = table().get_item(Key={"PK": _pk(bid), "SK": f"CARD#{card_id}"}).get("Item")
    if card is None:
        raise NotFoundError("card not found")
    items = _query_all(KeyConditionExpression=Key("PK").eq(_pk(bid)) & Key("SK").begins_with(f"CARD#{card_id}"))
    with table().batch_writer() as batch:
        for i in items:
            if i["SK"] == f"CARD#{card_id}" or i["SK"].startswith(f"CARD#{card_id}#"):
                batch.delete_item(Key={"PK": i["PK"], "SK": i["SK"]})
        batch.put_item(Item=_act(bid, sub, card, "deleted"))
    return {"deleted": card_id}


# ── 댓글 ─────────────────────────────────────────────

def _comment_prefix(card_id: str) -> str:
    return f"CARD#{card_id}#CMT#"


@router.get("/boards/<bid>/cards/<card_id>/comments")
def list_comments(bid: str, card_id: str) -> dict[str, Any]:
    _authorize(bid, "view")
    items = _query_all(KeyConditionExpression=Key("PK").eq(_pk(bid)) & Key("SK").begins_with(_comment_prefix(card_id)))
    return {"comments": [_strip(i) for i in items]}


@router.post("/boards/<bid>/cards/<card_id>/comments")
def add_comment(bid: str, card_id: str) -> dict[str, Any]:
    sub, _ = _authorize(bid, "edit")
    text = parse_body(router, CommentBody).text.strip()
    if not text:
        raise BadRequestError("text is empty")
    if table().get_item(Key={"PK": _pk(bid), "SK": f"CARD#{card_id}"}).get("Item") is None:
        raise NotFoundError("card not found")
    at = now_iso()
    cmt_id = uuid4().hex[:12]
    item = {"PK": _pk(bid), "SK": f"{_comment_prefix(card_id)}{_sort_ts()}#{cmt_id}", "id": cmt_id, "author": sub, "text": text, "createdAt": at}
    table().put_item(Item=item)
    return _strip(item)


@router.delete("/boards/<bid>/cards/<card_id>/comments/<comment_id>")
def delete_comment(bid: str, card_id: str, comment_id: str) -> dict[str, Any]:
    """내 댓글은 내가, 남의 댓글은 소유자만 지운다"""
    sub, role = _authorize(bid, "edit")
    items = _query_all(KeyConditionExpression=Key("PK").eq(_pk(bid)) & Key("SK").begins_with(_comment_prefix(card_id)))
    comment = next((i for i in items if i["id"] == comment_id), None)
    if comment is None:
        raise NotFoundError("comment not found")
    if comment["author"] != sub and role != "owner":
        raise ForbiddenError("only the author or the board owner can delete this comment")
    table().delete_item(Key={"PK": comment["PK"], "SK": comment["SK"]})
    return {"deleted": comment_id}
