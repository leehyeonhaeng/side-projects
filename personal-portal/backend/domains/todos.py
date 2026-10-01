"""할 일 (DESIGN.md 6.2, 7장: USER#<sub> / TODO#<id>, TODOLIST#<id>, GSI1 USER#<sub>#DUE)."""

import time
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Any, Literal
from uuid import uuid4

from aws_lambda_powertools.event_handler.api_gateway import Router
from aws_lambda_powertools.event_handler.exceptions import BadRequestError, NotFoundError
from boto3.dynamodb.conditions import Attr, Key
from pydantic import BaseModel, ConfigDict, Field, model_validator

from common.access import current_sub
from common.aws import table
from common.http import parse_body
from common.serialize import to_dynamo, to_plain
from common.users import now_iso, user_pk
from domains.recurrence import next_todo_due

router = Router()

TIME = r"^([01]\d|2[0-3]):[0-5]\d$"
Priority = Literal["high", "normal", "low"]
Text = Annotated[str, Field(max_length=2000)]


class Repeat(BaseModel):
    model_config = ConfigDict(extra="forbid")

    freq: Literal["daily", "weekly", "monthly", "weekdays"]
    weekdays: list[Annotated[int, Field(ge=1, le=7)]] | None = None  # ISO 요일, 매주일 때만
    monthDay: int | None = Field(default=None, ge=1, le=31)  # 매월: 원래 날짜 (짧은 달에서 당겨진 뒤 복귀용)

    @model_validator(mode="after")
    def check(self) -> "Repeat":
        if self.freq == "weekly":
            if not self.weekdays:
                raise ValueError("weekly repeat needs weekdays")
            self.weekdays = sorted(set(self.weekdays))
        else:
            self.weekdays = None
        if self.freq != "monthly":
            self.monthDay = None
        return self


class Subtask(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,40}$")
    text: str = Field(min_length=1, max_length=200)
    done: bool = False


class TodoFields(BaseModel):
    """생성·수정 공통 필드. 수정은 보낸 필드만 바뀐다."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=200)
    note: Text | None = None
    due: date | None = None
    dueTime: str | None = Field(default=None, pattern=TIME)
    priority: Priority | None = None
    listId: str | None = Field(default=None, max_length=40)
    repeat: Repeat | None = None
    subtasks: list[Subtask] | None = Field(default=None, max_length=50)
    order: float | None = None
    done: bool | None = None


class TodoCreate(TodoFields):
    title: str = Field(min_length=1, max_length=200)


class ListBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=40)
    order: float | None = None


# ── 저장소 ───────────────────────────────────────────

def _key(sub: str, todo_id: str) -> dict[str, str]:
    return {"PK": user_pk(sub), "SK": f"TODO#{todo_id}"}


def _with_index(sub: str, item: dict[str, Any]) -> dict[str, Any]:
    """마감일이 있으면 GSI1(USER#<sub>#DUE / <dueDate>#<id>)에 올린다 (캘린더 기간 조회용)"""
    item = {k: v for k, v in item.items() if k not in ("GSI1PK", "GSI1SK")}
    if item.get("due"):
        item["GSI1PK"] = f"{user_pk(sub)}#DUE"
        item["GSI1SK"] = f"{item['due']}#{item['id']}"
    return item


def view(item: dict[str, Any]) -> dict[str, Any]:
    return to_plain({k: v for k, v in item.items() if k not in ("PK", "SK", "GSI1PK", "GSI1SK")})


def get_todo(sub: str, todo_id: str) -> dict[str, Any]:
    item = table().get_item(Key=_key(sub, todo_id)).get("Item")
    if item is None:
        raise NotFoundError("todo not found")
    return to_plain(item)


def list_todos(sub: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    start: dict[str, Any] | None = None
    while True:
        page = table().query(
            KeyConditionExpression=Key("PK").eq(user_pk(sub)) & Key("SK").begins_with("TODO#"),
            **({"ExclusiveStartKey": start} if start else {}),
        )
        items.extend(page["Items"])
        start = page.get("LastEvaluatedKey")
        if not start:
            return items


def todos_due_between(sub: str, frm: date, to: date) -> list[dict[str, Any]]:
    res = table().query(
        IndexName="GSI1",
        KeyConditionExpression=Key("GSI1PK").eq(f"{user_pk(sub)}#DUE") & Key("GSI1SK").between(f"{frm}", f"{to}#￿"),
    )
    return list(res["Items"])


def _validate_combo(item: dict[str, Any]) -> None:
    if item.get("dueTime") and not item.get("due"):
        raise BadRequestError("dueTime needs due")
    if item.get("repeat") and not item.get("due"):
        raise BadRequestError("repeat needs due")


def create_todo(sub: str, body: TodoCreate) -> dict[str, Any]:
    now = now_iso()
    data = body.model_dump(exclude_none=True)
    data.pop("done", None)
    item = {
        "PK": user_pk(sub),
        "SK": "",
        "id": uuid4().hex[:12],
        "title": body.title.strip(),
        "note": "",
        "priority": "normal",
        "subtasks": [],
        "done": False,
        # 직접 순서 정렬값. 새 항목은 뒤로 (드래그하면 앞뒤 값의 중간으로 바뀐다)
        "order": time.time(),
        "createdAt": now,
        "updatedAt": now,
        **{k: v for k, v in data.items() if k != "title"},
    }
    item["SK"] = f"TODO#{item['id']}"
    if item.get("repeat") and item["repeat"]["freq"] == "monthly" and not item["repeat"].get("monthDay"):
        item["repeat"]["monthDay"] = date.fromisoformat(str(item["due"])).day
    _validate_combo(item)
    item = _with_index(sub, to_dynamo(item))
    table().put_item(Item=item)
    return item


def update_todo(sub: str, todo_id: str, body: TodoFields) -> dict[str, Any]:
    """PATCH: 보낸 필드만 바꾼다. null을 보내면 그 필드를 비운다 (due·dueTime·listId·repeat)."""
    current = get_todo(sub, todo_id)
    was_done = bool(current.get("done"))
    sent = body.model_dump(exclude_unset=True)
    nullable = {"due", "dueTime", "listId", "repeat"}
    for k, v in sent.items():
        if v is None:
            if k in nullable:
                current.pop(k, None)
            continue
        current[k] = v
    if "title" in sent and sent["title"]:
        current["title"] = sent["title"].strip()

    created_next: dict[str, Any] | None = None
    if sent.get("done") is True and not was_done:
        current["doneAt"] = now_iso()
        repeat = current.get("repeat")
        if repeat and current.get("due"):
            # 반복 할 일: 완료하면 다음 회차를 만들고, 반복 규칙은 다음 회차로 넘긴다
            nxt = next_todo_due(date.fromisoformat(str(current["due"])), repeat["freq"], repeat.get("weekdays"), repeat.get("monthDay"))
            created_next = create_todo(
                sub,
                TodoCreate(
                    title=current["title"],
                    note=current.get("note") or None,
                    due=nxt,
                    dueTime=current.get("dueTime"),
                    priority=current.get("priority"),
                    listId=current.get("listId"),
                    repeat=Repeat.model_validate(repeat),
                    subtasks=[Subtask(id=s["id"], text=s["text"], done=False) for s in current.get("subtasks", [])],
                ),
            )
            current.pop("repeat", None)
            current["nextId"] = created_next["id"]
    elif sent.get("done") is False:
        current.pop("doneAt", None)

    current["updatedAt"] = now_iso()
    _validate_combo(current)
    current = _with_index(sub, to_dynamo(current))
    table().put_item(Item=current)
    return {"todo": view(current), "next": view(created_next) if created_next else None}


KST = timezone(timedelta(hours=9))  # 한국은 서머타임이 없어 고정 오프셋으로 충분


def kst_today() -> date:
    return datetime.now(KST).date()


def projected_between(todos: list[dict[str, Any]], frm: date, to: date, today: date) -> list[dict[str, Any]]:
    """반복 할 일의 앞으로 회차 미리보기 (실제 항목은 완료해야 생긴다).

    오늘 이전 날짜는 보여주지 않는다 (완료 기반이라 지난 회차는 존재하지 않음).
    """
    out: list[dict[str, Any]] = []
    start = max(frm, today)
    for t in todos:
        repeat = t.get("repeat")
        if t.get("done") or not repeat or not t.get("due"):
            continue
        d = date.fromisoformat(t["due"])
        for _ in range(1000):  # 매일 반복이 오래 밀려 있어도 끝나도록 상한
            d = next_todo_due(d, repeat["freq"], repeat.get("weekdays"), repeat.get("monthDay"))
            if d > to:
                break
            if d >= start:
                out.append({"todoId": t["id"], "title": t["title"], "due": d.isoformat(), "dueTime": t.get("dueTime"), "priority": t.get("priority", "normal")})
    return sorted(out, key=lambda p: (p["due"], p.get("dueTime") or ""))


# ── 라우트 ───────────────────────────────────────────

@router.get("/todos")
def list_route() -> dict[str, Any]:
    status = router.current_event.get_query_string_value("status") or "open"
    items = [view(i) for i in list_todos(current_sub(router))]
    if status == "open":
        items = [i for i in items if not i.get("done")]
    elif status == "done":
        items = sorted((i for i in items if i.get("done")), key=lambda i: i.get("doneAt", ""), reverse=True)[:200]
    elif status != "all":
        raise BadRequestError("status must be open, done or all")
    return {"todos": items}


@router.get("/todos/due")
def due_route() -> dict[str, Any]:
    """캘린더 겹쳐 보기용: 마감일이 기간 안에 있는 할 일"""
    try:
        frm = date.fromisoformat(router.current_event.get_query_string_value("from") or "")
        to = date.fromisoformat(router.current_event.get_query_string_value("to") or "")
    except ValueError as exc:
        raise BadRequestError("from, to must be YYYY-MM-DD") from exc
    if (to - frm).days > 62 or to < frm:
        raise BadRequestError("range must be 0~62 days")
    sub = current_sub(router)
    return {
        "todos": [view(i) for i in todos_due_between(sub, frm, to)],
        "projected": projected_between([to_plain(i) for i in list_todos(sub)], frm, to, kst_today()),
    }


@router.post("/todos")
def create_route() -> dict[str, Any]:
    return view(create_todo(current_sub(router), parse_body(router, TodoCreate)))


@router.patch("/todos/<todo_id>")
def update_route(todo_id: str) -> dict[str, Any]:
    return update_todo(current_sub(router), todo_id, parse_body(router, TodoFields))


@router.delete("/todos/<todo_id>")
def delete_route(todo_id: str) -> dict[str, Any]:
    sub = current_sub(router)
    get_todo(sub, todo_id)
    table().delete_item(Key=_key(sub, todo_id))
    return {"ok": True}


# ── 목록(리스트) ─────────────────────────────────────

@router.get("/todo-lists")
def lists_route() -> dict[str, Any]:
    res = table().query(KeyConditionExpression=Key("PK").eq(user_pk(current_sub(router))) & Key("SK").begins_with("TODOLIST#"))
    lists = [{"id": i["id"], "name": i["name"], "order": float(i.get("order", 0))} for i in res["Items"]]
    return {"lists": sorted(lists, key=lambda x: x["order"])}


@router.post("/todo-lists")
def create_list_route() -> dict[str, Any]:
    body = parse_body(router, ListBody)
    list_id = uuid4().hex[:12]
    item = to_dynamo({"PK": user_pk(current_sub(router)), "SK": f"TODOLIST#{list_id}", "id": list_id, "name": body.name.strip(), "order": body.order or 0.0})
    table().put_item(Item=item)
    return {"id": list_id, "name": item["name"], "order": float(item["order"])}


@router.patch("/todo-lists/<list_id>")
def update_list_route(list_id: str) -> dict[str, Any]:
    body = parse_body(router, ListBody)
    sub = current_sub(router)
    try:
        table().update_item(
            Key={"PK": user_pk(sub), "SK": f"TODOLIST#{list_id}"},
            UpdateExpression="SET #n = :n" + (", #o = :o" if body.order is not None else ""),
            ConditionExpression=Attr("PK").exists(),
            ExpressionAttributeNames={"#n": "name", **({"#o": "order"} if body.order is not None else {})},
            ExpressionAttributeValues={":n": body.name.strip(), **(to_dynamo({":o": body.order}) if body.order is not None else {})},
        )
    except table().meta.client.exceptions.ConditionalCheckFailedException as exc:
        raise NotFoundError("list not found") from exc
    return {"ok": True}


@router.delete("/todo-lists/<list_id>")
def delete_list_route(list_id: str) -> dict[str, Any]:
    """목록을 지우면 그 안의 할 일은 '목록 없음'으로 남는다"""
    sub = current_sub(router)
    for item in list_todos(sub):
        if item.get("listId") == list_id:
            item.pop("listId")
            table().put_item(Item=item)
    table().delete_item(Key={"PK": user_pk(sub), "SK": f"TODOLIST#{list_id}"})
    return {"ok": True}
