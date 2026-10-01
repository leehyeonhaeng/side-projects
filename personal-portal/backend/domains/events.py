"""캘린더 일정 (DESIGN.md 6.1, 7장).

- 단일 일정: USER#<sub> / EVENT#<startDate>#<id>
- 반복 일정: USER#<sub> / EVENTR#<id>  (규칙만 저장하고 조회 기간에 맞춰 펼친다)
  - "이 일정만 삭제": 시리즈의 exdates에 날짜 추가
  - "이 일정만 수정": exdates에 추가 + 그 날짜로 단일 일정 생성(seriesId 기록)
  - "전체 수정·삭제": 시리즈 자체를 바꾸거나 지운다 (전체 삭제는 떨어져 나온 단일 일정도 같이)
"""

from datetime import date, timedelta
from typing import Any, Literal
from uuid import uuid4

from aws_lambda_powertools.event_handler.api_gateway import Router
from aws_lambda_powertools.event_handler.exceptions import BadRequestError, NotFoundError
from boto3.dynamodb.conditions import Key
from pydantic import BaseModel, ConfigDict, Field, model_validator

from common.access import current_sub
from common.aws import table
from common.http import parse_body
from common.serialize import to_dynamo, to_plain
from common.users import now_iso, user_pk
from domains.recurrence import event_occurrences

router = Router()

TIME = r"^([01]\d|2[0-3]):[0-5]\d$"
MAX_SPAN_DAYS = 62  # 여러 날 일정 최대 길이 (기간 조회 시 이만큼 앞에서부터 읽는다)
MAX_RANGE_DAYS = 62
COLORS = Literal["blue", "green", "red", "orange", "purple", "pink", "teal", "gray"]


class EventRepeat(BaseModel):
    model_config = ConfigDict(extra="forbid")

    freq: Literal["daily", "weekly", "monthly", "yearly"]
    until: date | None = None


class EventFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=100)
    allDay: bool | None = None
    start: date | None = None
    startTime: str | None = Field(default=None, pattern=TIME)
    end: date | None = None
    endTime: str | None = Field(default=None, pattern=TIME)
    location: str | None = Field(default=None, max_length=100)
    color: COLORS | None = None
    memo: str | None = Field(default=None, max_length=2000)


class EventCreate(EventFields):
    title: str = Field(min_length=1, max_length=100)
    start: date
    repeat: EventRepeat | None = None


class SeriesUpdate(EventFields):
    repeat: EventRepeat | None = None


def normalize(ev: dict[str, Any]) -> dict[str, Any]:
    """기본값 채우기 + 날짜·시간 조합 검증 (생성·수정 공통)"""
    ev.setdefault("allDay", True)
    ev.setdefault("end", ev["start"])
    ev.setdefault("location", "")
    ev.setdefault("color", "blue")
    ev.setdefault("memo", "")
    start, end = date.fromisoformat(str(ev["start"])), date.fromisoformat(str(ev["end"]))
    if end < start:
        raise BadRequestError("end must be on or after start")
    if (end - start).days > MAX_SPAN_DAYS:
        raise BadRequestError(f"event can span at most {MAX_SPAN_DAYS} days")
    if ev["allDay"]:
        ev.pop("startTime", None)
        ev.pop("endTime", None)
    else:
        if not ev.get("startTime"):
            raise BadRequestError("startTime required unless allDay")
        ev.setdefault("endTime", ev["startTime"])
        if start == end and ev["endTime"] < ev["startTime"]:
            raise BadRequestError("endTime must be after startTime")
    repeat = ev.get("repeat")
    if repeat and repeat.get("until") and date.fromisoformat(str(repeat["until"])) < start:
        raise BadRequestError("repeat.until must be on or after start")
    return ev


def apply_patch(current: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    """PATCH 적용: null은 필드 삭제. 시작일만 옮기면 종료일도 같이 옮겨 기간을 유지한다."""
    merged = dict(current)
    for k, v in patch.items():
        if v is None:
            merged.pop(k, None)
        else:
            merged[k] = v
    if "start" in patch and "end" not in patch and current.get("end"):
        span = date.fromisoformat(str(current["end"])) - date.fromisoformat(str(current["start"]))
        merged["end"] = (date.fromisoformat(str(merged["start"])) + span).isoformat()
    if "startTime" in patch and "endTime" not in patch and current.get("startTime") and current.get("endTime") and merged.get("startTime"):
        # 시작 시간만 옮기면 종료 시간도 같이 옮긴다 (같은 날 안에서, 23:59까지)
        delta = _minutes(merged["startTime"]) - _minutes(current["startTime"])
        merged["endTime"] = _hhmm(min(_minutes(current["endTime"]) + delta, 23 * 60 + 59))
    return normalize(merged)


def _minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def _hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


PUBLIC_FIELDS = ("title", "allDay", "start", "startTime", "end", "endTime", "location", "color", "memo")


def view_single(item: dict[str, Any]) -> dict[str, Any]:
    out = {k: item.get(k) for k in PUBLIC_FIELDS if k in item}
    out["id"] = item["id"]
    if item.get("seriesId"):
        out["seriesId"] = item["seriesId"]
    return to_plain(out)


def view_series(item: dict[str, Any]) -> dict[str, Any]:
    out = {k: item.get(k) for k in PUBLIC_FIELDS if k in item}
    return to_plain({**out, "id": item["id"], "repeat": item["repeat"], "exdates": item.get("exdates", [])})


def occurrence_view(series: dict[str, Any], day: date) -> dict[str, Any]:
    span = (date.fromisoformat(series["end"]) - date.fromisoformat(series["start"])).days
    base = view_series(series)
    return {
        **{k: v for k, v in base.items() if k not in ("exdates",)},
        "id": f"{series['id']}@{day.isoformat()}",
        "seriesId": series["id"],
        "occurrenceDate": day.isoformat(),
        "start": day.isoformat(),
        "end": (day + timedelta(days=span)).isoformat(),
    }


# ── 저장소 ───────────────────────────────────────────

def _query(sub: str, **kwargs: Any) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    start: dict[str, Any] | None = None
    while True:
        page = table().query(KeyConditionExpression=kwargs["cond"], **({"ExclusiveStartKey": start} if start else {}))
        items.extend(page["Items"])
        start = page.get("LastEvaluatedKey")
        if not start:
            return [to_plain(i) for i in items]


def all_singles(sub: str) -> list[dict[str, Any]]:
    return _query(sub, cond=Key("PK").eq(user_pk(sub)) & Key("SK").begins_with("EVENT#"))


def all_series(sub: str) -> list[dict[str, Any]]:
    return _query(sub, cond=Key("PK").eq(user_pk(sub)) & Key("SK").begins_with("EVENTR#"))


def get_single(sub: str, event_id: str, start: str) -> dict[str, Any]:
    item = table().get_item(Key={"PK": user_pk(sub), "SK": f"EVENT#{start}#{event_id}"}).get("Item")
    if item is None:
        raise NotFoundError("event not found")
    return to_plain(item)


def get_series(sub: str, series_id: str) -> dict[str, Any]:
    item = table().get_item(Key={"PK": user_pk(sub), "SK": f"EVENTR#{series_id}"}).get("Item")
    if item is None:
        raise NotFoundError("series not found")
    return to_plain(item)


def put_single(sub: str, ev: dict[str, Any]) -> dict[str, Any]:
    item = to_dynamo({**ev, "PK": user_pk(sub), "SK": f"EVENT#{ev['start']}#{ev['id']}", "updatedAt": now_iso()})
    table().put_item(Item=item)
    return to_plain(item)


def put_series(sub: str, ev: dict[str, Any]) -> dict[str, Any]:
    item = to_dynamo({**ev, "PK": user_pk(sub), "SK": f"EVENTR#{ev['id']}", "updatedAt": now_iso()})
    table().put_item(Item=item)
    return to_plain(item)


def events_between(sub: str, frm: date, to: date) -> list[dict[str, Any]]:
    """기간 [frm, to]와 겹치는 일정 (단일 + 반복 회차 펼침), 시작일 순"""
    lookback = frm - timedelta(days=MAX_SPAN_DAYS)
    res = table().query(
        KeyConditionExpression=Key("PK").eq(user_pk(sub)) & Key("SK").between(f"EVENT#{lookback}", f"EVENT#{to}#￿")
    )
    out = [view_single(to_plain(i)) for i in res["Items"] if str(i["end"]) >= frm.isoformat()]
    for series in all_series(sub):
        span = (date.fromisoformat(series["end"]) - date.fromisoformat(series["start"])).days
        until = date.fromisoformat(series["repeat"]["until"]) if series["repeat"].get("until") else None
        skip = set(series.get("exdates", []))
        for day in event_occurrences(date.fromisoformat(series["start"]), series["repeat"]["freq"], until, frm - timedelta(days=span), to):
            if day.isoformat() not in skip:
                out.append(occurrence_view(series, day))
    return sorted(out, key=lambda e: (e["start"], e.get("startTime") or ""))


# ── 라우트 ───────────────────────────────────────────

def _range() -> tuple[date, date]:
    try:
        frm = date.fromisoformat(router.current_event.get_query_string_value("from") or "")
        to = date.fromisoformat(router.current_event.get_query_string_value("to") or "")
    except ValueError as exc:
        raise BadRequestError("from, to must be YYYY-MM-DD") from exc
    if to < frm or (to - frm).days > MAX_RANGE_DAYS:
        raise BadRequestError(f"range must be 0~{MAX_RANGE_DAYS} days")
    return frm, to


def _occurrence_date(series: dict[str, Any], raw: str) -> str:
    try:
        day = date.fromisoformat(raw)
    except ValueError as exc:
        raise BadRequestError("date must be YYYY-MM-DD") from exc
    until = date.fromisoformat(series["repeat"]["until"]) if series["repeat"].get("until") else None
    if day not in set(event_occurrences(date.fromisoformat(series["start"]), series["repeat"]["freq"], until, day, day)):
        raise NotFoundError("no occurrence on that date")
    return day.isoformat()


@router.get("/events")
def list_route() -> dict[str, Any]:
    frm, to = _range()
    return {"events": events_between(current_sub(router), frm, to)}


@router.get("/events/search")
def search_route() -> dict[str, Any]:
    """제목·메모 검색 (DESIGN.md 6.1). 반복 일정은 시리즈 하나로 돌려준다."""
    q = (router.current_event.get_query_string_value("q") or "").strip().lower()
    if not q:
        raise BadRequestError("q is required")
    sub = current_sub(router)
    hit = lambda e: q in str(e.get("title", "")).lower() or q in str(e.get("memo", "")).lower()  # noqa: E731
    singles = [view_single(e) for e in all_singles(sub) if hit(e)]
    series = [view_series(e) for e in all_series(sub) if hit(e)]
    results = sorted(singles + series, key=lambda e: e["start"], reverse=True)
    return {"events": results[:100]}


@router.post("/events")
def create_route() -> dict[str, Any]:
    body = parse_body(router, EventCreate)
    sub = current_sub(router)
    ev = normalize({**body.model_dump(exclude_none=True, mode="json"), "id": uuid4().hex[:12], "createdAt": now_iso()})
    if ev.get("repeat"):
        return view_series(put_series(sub, {**ev, "exdates": []}))
    return view_single(put_single(sub, ev))


@router.patch("/events/<event_id>")
def update_single_route(event_id: str) -> dict[str, Any]:
    """단일 일정 수정. 현재 시작일을 ?start= 로 받아 키를 찾는다 (시작일이 바뀌면 키도 바뀜)"""
    sub = current_sub(router)
    current = get_single(sub, event_id, router.current_event.get_query_string_value("start") or "")
    patch = parse_body(router, EventFields).model_dump(exclude_unset=True, mode="json")
    updated = apply_patch(current, patch)
    if updated["start"] != current["start"]:
        table().delete_item(Key={"PK": user_pk(sub), "SK": f"EVENT#{current['start']}#{event_id}"})
    return view_single(put_single(sub, updated))


@router.delete("/events/<event_id>")
def delete_single_route(event_id: str) -> dict[str, Any]:
    sub = current_sub(router)
    current = get_single(sub, event_id, router.current_event.get_query_string_value("start") or "")
    table().delete_item(Key={"PK": user_pk(sub), "SK": f"EVENT#{current['start']}#{event_id}"})
    return {"ok": True}


@router.patch("/event-series/<series_id>")
def update_series_route(series_id: str) -> dict[str, Any]:
    """반복 일정 전체 수정 (이미 빠진 날짜 exdates는 유지)"""
    sub = current_sub(router)
    current = get_series(sub, series_id)
    patch = parse_body(router, SeriesUpdate).model_dump(exclude_unset=True, mode="json")
    if "repeat" in patch and patch["repeat"] is None:
        raise BadRequestError("cannot remove repeat from a series")
    return view_series(put_series(sub, apply_patch(current, patch)))


@router.delete("/event-series/<series_id>")
def delete_series_route(series_id: str) -> dict[str, Any]:
    """반복 일정 전체 삭제 (이 일정만 수정해서 떨어져 나온 일정도 같이)"""
    sub = current_sub(router)
    get_series(sub, series_id)
    with table().batch_writer() as batch:
        batch.delete_item(Key={"PK": user_pk(sub), "SK": f"EVENTR#{series_id}"})
        for e in all_singles(sub):
            if e.get("seriesId") == series_id:
                batch.delete_item(Key={"PK": user_pk(sub), "SK": e["SK"]})
    return {"ok": True}


@router.patch("/event-series/<series_id>/occurrences/<day>")
def update_occurrence_route(series_id: str, day: str) -> dict[str, Any]:
    """이 일정만 수정: 그 날짜를 시리즈에서 빼고 단일 일정으로 만든다"""
    sub = current_sub(router)
    series = get_series(sub, series_id)
    occ_day = _occurrence_date(series, day)
    patch = parse_body(router, EventFields).model_dump(exclude_unset=True, mode="json")
    base = occurrence_view(series, date.fromisoformat(occ_day))
    single = apply_patch({k: base[k] for k in PUBLIC_FIELDS if k in base}, patch)
    single = {**single, "id": uuid4().hex[:12], "seriesId": series_id, "createdAt": now_iso()}
    created = put_single(sub, single)
    put_series(sub, {**series, "exdates": sorted({*series.get("exdates", []), occ_day})})
    return view_single(created)


@router.delete("/event-series/<series_id>/occurrences/<day>")
def delete_occurrence_route(series_id: str, day: str) -> dict[str, Any]:
    """이 일정만 삭제"""
    sub = current_sub(router)
    series = get_series(sub, series_id)
    occ_day = _occurrence_date(series, day)
    put_series(sub, {**series, "exdates": sorted({*series.get("exdates", []), occ_day})})
    return {"ok": True}
