"""메모 (DESIGN.md 6.7, 7장: USER#<sub> / NOTE#<id>).

휴지통: 삭제하면 deletedAt + ttl(30일 뒤). DynamoDB TTL이 실제로 지우기까지 늦을 수 있어 30일이 지난 항목은 숨긴다.
"""

import time
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any
from uuid import uuid4

from aws_lambda_powertools.event_handler.api_gateway import Router
from aws_lambda_powertools.event_handler.exceptions import BadRequestError, NotFoundError
from boto3.dynamodb.conditions import Key
from pydantic import BaseModel, ConfigDict, Field

from common.access import current_sub
from common.aws import table
from common.http import parse_body
from common.serialize import to_plain
from common.users import now_iso, user_pk

router = Router()

TRASH_DAYS = 30
Tag = Annotated[str, Field(min_length=1, max_length=30)]


class NoteFields(BaseModel):
    """생성·수정 공통. 수정은 보낸 필드만 바뀐다"""

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, max_length=200)
    body: str | None = Field(default=None, max_length=50000)  # 마크다운
    tags: list[Tag] | None = Field(default=None, max_length=20)
    pinned: bool | None = None


def _key(sub: str, note_id: str) -> dict[str, str]:
    return {"PK": user_pk(sub), "SK": f"NOTE#{note_id}"}


def _view(item: dict[str, Any]) -> dict[str, Any]:
    return to_plain({k: v for k, v in item.items() if k not in ("PK", "SK", "ttl")})


def _expired(item: dict[str, Any]) -> bool:
    deleted = item.get("deletedAt")
    return bool(deleted) and datetime.fromisoformat(deleted) < datetime.now(UTC) - timedelta(days=TRASH_DAYS)


def _normalize(data: dict[str, Any]) -> dict[str, Any]:
    if "tags" in data and data["tags"] is not None:
        data["tags"] = list(dict.fromkeys(t.strip() for t in data["tags"] if t.strip()))
    return data


def _get(sub: str, note_id: str) -> dict[str, Any]:
    item = table().get_item(Key=_key(sub, note_id)).get("Item")
    if item is None or _expired(item):
        raise NotFoundError("note not found")
    return item


@router.get("/notes")
def list_notes() -> dict[str, Any]:
    """?trash=true 면 휴지통, 아니면 일반 메모"""
    sub = current_sub(router)
    trash = (router.current_event.query_string_parameters or {}).get("trash") == "true"
    items: list[dict[str, Any]] = []
    start: dict[str, Any] | None = None
    while True:
        page = table().query(
            KeyConditionExpression=Key("PK").eq(user_pk(sub)) & Key("SK").begins_with("NOTE#"),
            **({"ExclusiveStartKey": start} if start else {}),
        )
        items.extend(page["Items"])
        start = page.get("LastEvaluatedKey")
        if not start:
            break
    notes = [_view(i) for i in items if bool(i.get("deletedAt")) == trash and not _expired(i)]
    notes.sort(key=lambda n: n.get("deletedAt" if trash else "updatedAt", ""), reverse=True)
    return {"notes": notes}


@router.get("/notes/<note_id>")
def get_note(note_id: str) -> dict[str, Any]:
    return _view(_get(current_sub(router), note_id))


@router.post("/notes")
def create_note() -> dict[str, Any]:
    sub = current_sub(router)
    data = _normalize(parse_body(router, NoteFields).model_dump(exclude_none=True))
    if not (data.get("title", "").strip() or data.get("body", "").strip()):
        raise BadRequestError("title or body is required")
    now = now_iso()
    note_id = uuid4().hex[:12]
    item = {**_key(sub, note_id), "id": note_id, "title": "", "body": "", "tags": [], "pinned": False, **data, "createdAt": now, "updatedAt": now}
    table().put_item(Item=item)
    return _view(item)


@router.patch("/notes/<note_id>")
def patch_note(note_id: str) -> dict[str, Any]:
    sub = current_sub(router)
    changes = _normalize(parse_body(router, NoteFields).model_dump(exclude_none=True))
    if not changes:
        raise BadRequestError("nothing to update")
    item = _get(sub, note_id)
    if item.get("deletedAt"):
        raise BadRequestError("restore the note before editing")
    item = {**item, **changes, "updatedAt": now_iso()}
    table().put_item(Item=item)
    return _view(item)


@router.delete("/notes/<note_id>")
def delete_note(note_id: str) -> dict[str, Any]:
    """휴지통으로. 이미 휴지통이거나 ?permanent=true 면 영구 삭제"""
    sub = current_sub(router)
    item = _get(sub, note_id)
    permanent = (router.current_event.query_string_parameters or {}).get("permanent") == "true"
    if permanent or item.get("deletedAt"):
        table().delete_item(Key=_key(sub, note_id))
        return {"deleted": note_id, "permanent": True}
    table().put_item(Item={**item, "deletedAt": now_iso(), "ttl": int(time.time()) + TRASH_DAYS * 86400})
    return {"deleted": note_id, "permanent": False}


@router.post("/notes/<note_id>/restore")
def restore_note(note_id: str) -> dict[str, Any]:
    sub = current_sub(router)
    item = _get(sub, note_id)
    if not item.get("deletedAt"):
        raise BadRequestError("note is not in the trash")
    restored = {k: v for k, v in item.items() if k not in ("deletedAt", "ttl")}
    table().put_item(Item=restored)
    return _view(restored)
