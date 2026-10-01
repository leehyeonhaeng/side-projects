"""운동 (DESIGN.md 6.5, 7장).

- 러닝:      USER#<sub> / RUN#<date>#<id>
- 헬스 세션: USER#<sub> / GYM#<date>#<id>
- 헬스 루틴: USER#<sub> / ROUTINE#<id>
- 훈련 프로그램: USER#<sub> / PROGRAM#<id>
"""

from datetime import date
from typing import Annotated, Any, Literal
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

router = Router()

Day = date  # 필드 이름이 date라서 타입을 가리지 않게 별칭 (meals.py와 같은 이유)
RunType = Literal["easy", "interval", "tempo", "long"]
KCAL_PER_KG_KM = 1.036  # 러닝 소모 칼로리 근사: 체중(kg) × 거리(km) × 1.036
MAX_RANGE_DAYS = 400


# ── 공통 ────────────────────────────────────────────

def _query(sub: str, cond: Any) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    start: dict[str, Any] | None = None
    while True:
        page = table().query(KeyConditionExpression=cond, **({"ExclusiveStartKey": start} if start else {}))
        items.extend(page["Items"])
        start = page.get("LastEvaluatedKey")
        if not start:
            return [to_plain(i) for i in items]


def _between(sub: str, prefix: str, frm: date, to: date) -> list[dict[str, Any]]:
    return _query(sub, Key("PK").eq(user_pk(sub)) & Key("SK").between(f"{prefix}#{frm}", f"{prefix}#{to}#￿"))


def _all(sub: str, prefix: str) -> list[dict[str, Any]]:
    return _query(sub, Key("PK").eq(user_pk(sub)) & Key("SK").begins_with(f"{prefix}#"))


def _range() -> tuple[date, date]:
    q = router.current_event.get_query_string_value
    try:
        frm, to = date.fromisoformat(q("from") or ""), date.fromisoformat(q("to") or "")
    except ValueError as exc:
        raise BadRequestError("from, to must be YYYY-MM-DD") from exc
    if to < frm or (to - frm).days > MAX_RANGE_DAYS:
        raise BadRequestError(f"range must be 0~{MAX_RANGE_DAYS} days")
    return frm, to


def _strip(item: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in item.items() if k not in ("PK", "SK", "updatedAt")}


def _put(sub: str, sk: str, data: dict[str, Any]) -> dict[str, Any]:
    item = {**data, "PK": user_pk(sub), "SK": sk, "updatedAt": now_iso()}
    table().put_item(Item=to_dynamo(item))
    return _strip(to_plain(to_dynamo(item)))


def _get(sub: str, sk: str) -> dict[str, Any]:
    item = table().get_item(Key={"PK": user_pk(sub), "SK": sk}).get("Item")
    if item is None:
        raise NotFoundError("not found")
    return to_plain(item)


def _day_param() -> str:
    raw = router.current_event.get_query_string_value("date") or ""
    try:
        return date.fromisoformat(raw).isoformat()
    except ValueError as exc:
        raise BadRequestError("date must be YYYY-MM-DD") from exc


def weight_on(sub: str, day: str) -> float | None:
    """그날 또는 그 이전 가장 가까운 체중 기록"""
    res = table().query(
        KeyConditionExpression=Key("PK").eq(user_pk(sub)) & Key("SK").between("WEIGHT#0000", f"WEIGHT#{day}"),
        ScanIndexForward=False,
        Limit=1,
    )
    return float(res["Items"][0]["weight"]) if res["Items"] else None


# ── 러닝 ────────────────────────────────────────────

class RunBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date: Day
    distanceKm: Annotated[float, Field(gt=0, le=300)]
    durationSec: Annotated[int, Field(gt=0, le=48 * 3600)]
    type: RunType = "easy"
    effort: Annotated[int, Field(ge=1, le=10)] | None = None  # 체감 강도
    kcal: Annotated[float, Field(ge=0, le=20000)] | None = None  # 직접 입력하면 추정 대신 사용
    memo: str = Field(default="", max_length=500)


def run_view(item: dict[str, Any]) -> dict[str, Any]:
    out = _strip(item)
    out["paceSecPerKm"] = round(out["durationSec"] / out["distanceKm"])
    return out


def _save_run(sub: str, run_id: str, body: RunBody) -> dict[str, Any]:
    data = body.model_dump(mode="json")
    if data.get("kcal") is None:
        # 소모 칼로리 추정: 그날(또는 직전) 체중 기록 기준. 체중 기록이 없으면 비워둔다
        kg = weight_on(sub, data["date"])
        data["kcal"] = round(kg * data["distanceKm"] * KCAL_PER_KG_KM, 1) if kg else None
        data["kcalEstimated"] = kg is not None
    else:
        data["kcalEstimated"] = False
    data = {k: v for k, v in data.items() if v is not None}
    return run_view(_put(sub, f"RUN#{data['date']}#{run_id}", {"id": run_id, **data}))


@router.get("/runs")
def runs_route() -> dict[str, Any]:
    frm, to = _range()
    return {"runs": [run_view(r) for r in _between(current_sub(router), "RUN", frm, to)]}


@router.get("/runs/records")
def run_records_route() -> dict[str, Any]:
    """5K·10K 최고 페이스: 5km·10km 이상 뛴 기록 중 가장 빠른 페이스 (DESIGN.md 6.5)"""
    runs = [run_view(r) for r in _all(current_sub(router), "RUN")]

    def best(min_km: float) -> dict[str, Any] | None:
        eligible = [r for r in runs if r["distanceKm"] >= min_km]
        return min(eligible, key=lambda r: r["paceSecPerKm"]) if eligible else None

    return {"best5k": best(5), "best10k": best(10)}


@router.post("/runs")
def create_run_route() -> dict[str, Any]:
    return _save_run(current_sub(router), uuid4().hex[:12], parse_body(router, RunBody))


@router.put("/runs/<run_id>")
def update_run_route(run_id: str) -> dict[str, Any]:
    """전체 교체. 현재 날짜를 ?date= 로 받아 키를 찾는다"""
    sub = current_sub(router)
    old_day = _day_param()
    _get(sub, f"RUN#{old_day}#{run_id}")
    body = parse_body(router, RunBody)
    if body.date.isoformat() != old_day:
        table().delete_item(Key={"PK": user_pk(sub), "SK": f"RUN#{old_day}#{run_id}"})
    return _save_run(sub, run_id, body)


@router.delete("/runs/<run_id>")
def delete_run_route(run_id: str) -> dict[str, Any]:
    sub = current_sub(router)
    sk = f"RUN#{_day_param()}#{run_id}"
    _get(sub, sk)
    table().delete_item(Key={"PK": user_pk(sub), "SK": sk})
    return {"ok": True}


# ── 헬스 ────────────────────────────────────────────

class GymSet(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reps: Annotated[int, Field(ge=0, le=1000)]
    weight: Annotated[float, Field(ge=0, le=1000)] = 0  # kg, 맨몸은 0


class GymExercise(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=60)
    sets: list[GymSet] = Field(min_length=1, max_length=30)


class GymBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date: Day
    title: str = Field(min_length=1, max_length=60)  # 보통 루틴 이름
    routineId: str | None = Field(default=None, max_length=40)
    exercises: list[GymExercise] = Field(min_length=1, max_length=30)
    kcal: Annotated[float, Field(ge=0, le=20000)] | None = None  # 선택 입력 (DESIGN.md 6.5)
    memo: str = Field(default="", max_length=500)


def _save_gym(sub: str, gym_id: str, body: GymBody) -> dict[str, Any]:
    data = {k: v for k, v in body.model_dump(mode="json").items() if v is not None}
    return _put(sub, f"GYM#{data['date']}#{gym_id}", {"id": gym_id, **data})


@router.get("/gym")
def gym_route() -> dict[str, Any]:
    frm, to = _range()
    return {"sessions": [_strip(s) for s in _between(current_sub(router), "GYM", frm, to)]}


@router.get("/gym/last")
def gym_last_route() -> dict[str, Any]:
    """운동별 지난 기록 자동 채우기: 가장 최근 세션의 세트 (?names=벤치프레스,스쿼트)"""
    names = [n for n in (router.current_event.get_query_string_value("names") or "").split(",") if n]
    sessions = sorted(_all(current_sub(router), "GYM"), key=lambda s: (s["date"], s.get("updatedAt", "")), reverse=True)
    last: dict[str, Any] = {}
    for name in names:
        for s in sessions:
            ex = next((e for e in s["exercises"] if e["name"] == name), None)
            if ex:
                last[name] = {"date": s["date"], "sets": ex["sets"]}
                break
    return {"last": last}


@router.get("/gym/progress")
def gym_progress_route() -> dict[str, Any]:
    """운동별 무게 추이: 세션마다 그 운동의 최고 무게 (?name=벤치프레스)"""
    name = (router.current_event.get_query_string_value("name") or "").strip()
    if not name:
        raise BadRequestError("name is required")
    points = []
    for s in sorted(_all(current_sub(router), "GYM"), key=lambda s: s["date"]):
        ex = next((e for e in s["exercises"] if e["name"] == name), None)
        if ex:
            points.append({"date": s["date"], "maxWeight": max(st["weight"] for st in ex["sets"]), "volume": sum(st["weight"] * st["reps"] for st in ex["sets"])})
    return {"name": name, "points": points}


@router.post("/gym")
def create_gym_route() -> dict[str, Any]:
    return _save_gym(current_sub(router), uuid4().hex[:12], parse_body(router, GymBody))


@router.put("/gym/<gym_id>")
def update_gym_route(gym_id: str) -> dict[str, Any]:
    sub = current_sub(router)
    old_day = _day_param()
    _get(sub, f"GYM#{old_day}#{gym_id}")
    body = parse_body(router, GymBody)
    if body.date.isoformat() != old_day:
        table().delete_item(Key={"PK": user_pk(sub), "SK": f"GYM#{old_day}#{gym_id}"})
    return _save_gym(sub, gym_id, body)


@router.delete("/gym/<gym_id>")
def delete_gym_route(gym_id: str) -> dict[str, Any]:
    sub = current_sub(router)
    sk = f"GYM#{_day_param()}#{gym_id}"
    _get(sub, sk)
    table().delete_item(Key={"PK": user_pk(sub), "SK": sk})
    return {"ok": True}


# ── 헬스 루틴 (템플릿) ───────────────────────────────

class RoutineExercise(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=60)
    sets: Annotated[int, Field(ge=1, le=30)] = 3


class RoutineBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=40)
    exercises: list[RoutineExercise] = Field(min_length=1, max_length=30)


@router.get("/routines")
def routines_route() -> dict[str, Any]:
    return {"routines": sorted((_strip(r) for r in _all(current_sub(router), "ROUTINE")), key=lambda r: r["name"])}


@router.post("/routines")
def create_routine_route() -> dict[str, Any]:
    rid = uuid4().hex[:12]
    return _put(current_sub(router), f"ROUTINE#{rid}", {"id": rid, **parse_body(router, RoutineBody).model_dump()})


@router.put("/routines/<rid>")
def update_routine_route(rid: str) -> dict[str, Any]:
    sub = current_sub(router)
    _get(sub, f"ROUTINE#{rid}")
    return _put(sub, f"ROUTINE#{rid}", {"id": rid, **parse_body(router, RoutineBody).model_dump()})


@router.delete("/routines/<rid>")
def delete_routine_route(rid: str) -> dict[str, Any]:
    sub = current_sub(router)
    _get(sub, f"ROUTINE#{rid}")
    table().delete_item(Key={"PK": user_pk(sub), "SK": f"ROUTINE#{rid}"})
    return {"ok": True}


# ── 훈련 프로그램 ────────────────────────────────────

class PlanItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    week: Annotated[int, Field(ge=1, le=52)]
    weekday: Annotated[int, Field(ge=1, le=7)]  # ISO 요일 (월=1)
    kind: Literal["run", "gym", "other"]
    title: str = Field(min_length=1, max_length=80)


class ProgramBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=40)
    startDate: Day  # 이 날이 속한 주의 월요일부터 1주차
    weeks: Annotated[int, Field(ge=1, le=52)]
    items: list[PlanItem] = Field(max_length=400)
    active: bool = True

    @model_validator(mode="after")
    def check_weeks(self) -> "ProgramBody":
        if any(i.week > self.weeks for i in self.items):
            raise ValueError("item week exceeds program weeks")
        return self


class DoneBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date: Day
    done: bool


def _save_program(sub: str, pid: str, body: ProgramBody, manual_done: list[str]) -> dict[str, Any]:
    if body.active:
        # 진행 중인 프로그램은 하나만
        for p in _all(sub, "PROGRAM"):
            if p["id"] != pid and p.get("active"):
                _put(sub, f"PROGRAM#{p['id']}", {**_strip(p), "active": False})
    return _put(sub, f"PROGRAM#{pid}", {"id": pid, **body.model_dump(mode="json"), "manualDone": manual_done})


@router.get("/programs")
def programs_route() -> dict[str, Any]:
    return {"programs": [_strip(p) for p in _all(current_sub(router), "PROGRAM")]}


@router.post("/programs")
def create_program_route() -> dict[str, Any]:
    return _save_program(current_sub(router), uuid4().hex[:12], parse_body(router, ProgramBody), [])


@router.put("/programs/<pid>")
def update_program_route(pid: str) -> dict[str, Any]:
    sub = current_sub(router)
    current = _get(sub, f"PROGRAM#{pid}")
    return _save_program(sub, pid, parse_body(router, ProgramBody), current.get("manualDone", []))


@router.patch("/programs/<pid>/done")
def program_done_route(pid: str) -> dict[str, Any]:
    """기타 계획(러닝·헬스 기록으로 자동 완료되지 않는 것)을 직접 완료 체크"""
    sub = current_sub(router)
    current = _strip(_get(sub, f"PROGRAM#{pid}"))
    body = parse_body(router, DoneBody)
    day = body.date.isoformat()
    done = set(current.get("manualDone", []))
    done = done | {day} if body.done else done - {day}
    return _put(sub, f"PROGRAM#{pid}", {**current, "manualDone": sorted(done)})


@router.delete("/programs/<pid>")
def delete_program_route(pid: str) -> dict[str, Any]:
    sub = current_sub(router)
    _get(sub, f"PROGRAM#{pid}")
    table().delete_item(Key={"PK": user_pk(sub), "SK": f"PROGRAM#{pid}"})
    return {"ok": True}
