"""식단 (DESIGN.md 6.3, 7장).

- 식단 항목: USER#<sub> / MEAL#<date>#<meal>#<id>
- 내 음식:   USER#<sub> / FOOD#<id>      (100g당 또는 1회 제공량당 영양정보)
- 끼니 조합: USER#<sub> / MEALSET#<id>   (자주 먹는 끼니 묶음)
"""

from datetime import date, timedelta
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

# 필드 이름이 date라서, 클래스 안에서 date 타입을 가리지 않게 별칭을 쓴다
Day = date
MealType = Literal["breakfast", "lunch", "dinner", "snack"]
Method = Literal["ai", "manual", "food"]
Amount = Annotated[float, Field(ge=0, le=100000)]
MAX_RANGE_DAYS = 62
MAX_BATCH = 30


class Nutrition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    grams: Amount | None = None
    kcal: Amount
    carb: Amount = 0
    protein: Amount = 0
    fat: Amount = 0


class MealCreate(Nutrition):
    date: Day
    meal: MealType
    method: Method = "manual"
    note: str = Field(default="", max_length=500)


class MealBatch(BaseModel):
    """AI 추정 확인 카드처럼 여러 항목을 한 번에 저장"""

    model_config = ConfigDict(extra="forbid")

    date: Day
    meal: MealType
    method: Method = "manual"
    items: list[Nutrition] = Field(min_length=1, max_length=MAX_BATCH)


class MealPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=100)
    grams: Amount | None = None
    kcal: Amount | None = None
    carb: Amount | None = None
    protein: Amount | None = None
    fat: Amount | None = None
    date: Day | None = None
    meal: MealType | None = None
    note: str | None = Field(default=None, max_length=500)


class CopyBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fromDate: date
    toDate: date
    meal: MealType | None = None  # 없으면 하루 전체


class FoodBody(BaseModel):
    """내 음식. basis가 100g이면 영양정보는 100g당, serving이면 1회 제공량(servingGrams)당"""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    basis: Literal["100g", "serving"] = "100g"
    servingGrams: Amount | None = None
    kcal: Amount
    carb: Amount = 0
    protein: Amount = 0
    fat: Amount = 0


class MealSetBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=40)
    items: list[Nutrition] = Field(min_length=1, max_length=MAX_BATCH)


NUTRIENTS = ("kcal", "carb", "protein", "fat")
PUBLIC = ("id", "date", "meal", "name", "grams", "kcal", "carb", "protein", "fat", "method", "note", "createdAt")


def _sk(day: str, meal: str, meal_id: str) -> str:
    return f"MEAL#{day}#{meal}#{meal_id}"


def _round(item: dict[str, Any]) -> dict[str, Any]:
    """영양 수치는 소수 첫째 자리까지만 저장 (AI 추정치의 과도한 소수점 정리)"""
    for k in (*NUTRIENTS, "grams"):
        if item.get(k) is not None:
            item[k] = round(float(item[k]), 1)
    return item


def view(item: dict[str, Any]) -> dict[str, Any]:
    return to_plain({k: item[k] for k in PUBLIC if k in item})


def put_meal(sub: str, data: dict[str, Any]) -> dict[str, Any]:
    item = _round({**data, "PK": user_pk(sub), "SK": _sk(str(data["date"]), data["meal"], data["id"])})
    table().put_item(Item=to_dynamo(item))
    return view(to_plain(to_dynamo(item)))


def new_meal(fields: dict[str, Any]) -> dict[str, Any]:
    return {"id": uuid4().hex[:12], "note": "", "createdAt": now_iso(), "grams": None, **fields}


def meals_between(sub: str, frm: date, to: date) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    start: dict[str, Any] | None = None
    while True:
        page = table().query(
            KeyConditionExpression=Key("PK").eq(user_pk(sub)) & Key("SK").between(f"MEAL#{frm}", f"MEAL#{to}#￿"),
            **({"ExclusiveStartKey": start} if start else {}),
        )
        items.extend(page["Items"])
        start = page.get("LastEvaluatedKey")
        if not start:
            return [view(to_plain(i)) for i in items]


def daily_totals(meals: list[dict[str, Any]]) -> dict[str, dict[str, float]]:
    out: dict[str, dict[str, float]] = {}
    for m in meals:
        day = out.setdefault(m["date"], {k: 0.0 for k in NUTRIENTS})
        for k in NUTRIENTS:
            day[k] = round(day[k] + float(m.get(k) or 0), 1)
    return out


def _date_param(name: str) -> date:
    try:
        return date.fromisoformat(router.current_event.get_query_string_value(name) or "")
    except ValueError as exc:
        raise BadRequestError(f"{name} must be YYYY-MM-DD") from exc


def _get_meal(sub: str, meal_id: str) -> dict[str, Any]:
    """PATCH·DELETE: 현재 날짜·끼니를 ?date=&meal= 로 받아 키를 찾는다 (일정과 같은 방식)"""
    day = _date_param("date")
    meal = router.current_event.get_query_string_value("meal") or ""
    item = table().get_item(Key={"PK": user_pk(sub), "SK": _sk(day.isoformat(), meal, meal_id)}).get("Item")
    if item is None:
        raise NotFoundError("meal not found")
    return to_plain(item)


# ── 식단 항목 ────────────────────────────────────────

@router.get("/meals")
def list_route() -> dict[str, Any]:
    frm, to = _date_param("from"), _date_param("to")
    if to < frm or (to - frm).days > MAX_RANGE_DAYS:
        raise BadRequestError(f"range must be 0~{MAX_RANGE_DAYS} days")
    meals = meals_between(current_sub(router), frm, to)
    return {"meals": meals, "totals": daily_totals(meals)}


@router.post("/meals")
def create_route() -> dict[str, Any]:
    body = parse_body(router, MealCreate)
    return put_meal(current_sub(router), new_meal(body.model_dump(mode="json")))


@router.post("/meals/batch")
def batch_route() -> dict[str, Any]:
    body = parse_body(router, MealBatch)
    sub = current_sub(router)
    base = {"date": body.date.isoformat(), "meal": body.meal, "method": body.method}
    return {"meals": [put_meal(sub, new_meal({**base, **i.model_dump()})) for i in body.items]}


@router.patch("/meals/<meal_id>")
def update_route(meal_id: str) -> dict[str, Any]:
    sub = current_sub(router)
    current = _get_meal(sub, meal_id)
    patch = parse_body(router, MealPatch).model_dump(exclude_unset=True, mode="json")
    if any(patch.get(k, 0) is None for k in ("name", "kcal", "date", "meal")):
        raise BadRequestError("name, kcal, date, meal cannot be null")
    updated = {**current, **patch}
    if (updated["date"], updated["meal"]) != (current["date"], current["meal"]):
        table().delete_item(Key={"PK": user_pk(sub), "SK": _sk(current["date"], current["meal"], meal_id)})
    return put_meal(sub, {k: v for k, v in updated.items() if k not in ("PK", "SK")})


@router.delete("/meals/<meal_id>")
def delete_route(meal_id: str) -> dict[str, Any]:
    sub = current_sub(router)
    current = _get_meal(sub, meal_id)
    table().delete_item(Key={"PK": user_pk(sub), "SK": _sk(current["date"], current["meal"], meal_id)})
    return {"ok": True}


@router.post("/meals/copy")
def copy_route() -> dict[str, Any]:
    """어제 식단 복사 (DESIGN.md 6.3 부가 기능). 날짜·끼니만 바꿔 새 항목으로 만든다"""
    body = parse_body(router, CopyBody)
    sub = current_sub(router)
    source = [m for m in meals_between(sub, body.fromDate, body.fromDate) if body.meal is None or m["meal"] == body.meal]
    if not source:
        raise BadRequestError("nothing to copy")
    keep = ("meal", "name", "grams", "kcal", "carb", "protein", "fat", "method", "note")
    return {"meals": [put_meal(sub, new_meal({**{k: m.get(k) for k in keep}, "date": body.toDate.isoformat()})) for m in source]}


@router.get("/meals/stats")
def stats_route() -> dict[str, Any]:
    """기록 그래프용 일별 합계 (주간·월간 평균은 프론트에서 계산)"""
    frm, to = _date_param("from"), _date_param("to")
    if to < frm or (to - frm).days > 366:
        raise BadRequestError("range must be 0~366 days")
    # 62일씩 끊어 읽는다
    totals: dict[str, dict[str, float]] = {}
    cur = frm
    while cur <= to:
        end = min(cur + timedelta(days=MAX_RANGE_DAYS), to)
        totals.update(daily_totals(meals_between(current_sub(router), cur, end)))
        cur = end + timedelta(days=1)
    return {"totals": totals}


# ── 내 음식 ──────────────────────────────────────────

def _list(sub: str, prefix: str) -> list[dict[str, Any]]:
    res = table().query(KeyConditionExpression=Key("PK").eq(user_pk(sub)) & Key("SK").begins_with(prefix))
    return [to_plain({k: v for k, v in i.items() if k not in ("PK", "SK")}) for i in res["Items"]]


def _put(sub: str, prefix: str, item_id: str, data: dict[str, Any]) -> dict[str, Any]:
    item = {"id": item_id, **data, "updatedAt": now_iso()}
    table().put_item(Item=to_dynamo({**item, "PK": user_pk(sub), "SK": f"{prefix}{item_id}"}))
    return to_plain(to_dynamo(item))


def _require(sub: str, prefix: str, item_id: str) -> None:
    if "Item" not in table().get_item(Key={"PK": user_pk(sub), "SK": f"{prefix}{item_id}"}):
        raise NotFoundError("not found")


@router.get("/foods")
def foods_route() -> dict[str, Any]:
    q = (router.current_event.get_query_string_value("q") or "").strip().lower()
    foods = [f for f in _list(current_sub(router), "FOOD#") if not q or q in f["name"].lower()]
    return {"foods": sorted(foods, key=lambda f: f["name"])}


@router.post("/foods")
def create_food_route() -> dict[str, Any]:
    body = parse_body(router, FoodBody)
    return _put(current_sub(router), "FOOD#", uuid4().hex[:12], _round(body.model_dump()))


@router.put("/foods/<food_id>")
def update_food_route(food_id: str) -> dict[str, Any]:
    sub = current_sub(router)
    _require(sub, "FOOD#", food_id)
    return _put(sub, "FOOD#", food_id, _round(parse_body(router, FoodBody).model_dump()))


@router.delete("/foods/<food_id>")
def delete_food_route(food_id: str) -> dict[str, Any]:
    sub = current_sub(router)
    _require(sub, "FOOD#", food_id)
    table().delete_item(Key={"PK": user_pk(sub), "SK": f"FOOD#{food_id}"})
    return {"ok": True}


# ── 끼니 조합 ────────────────────────────────────────

@router.get("/meal-sets")
def sets_route() -> dict[str, Any]:
    return {"sets": sorted(_list(current_sub(router), "MEALSET#"), key=lambda s: s["name"])}


@router.post("/meal-sets")
def create_set_route() -> dict[str, Any]:
    body = parse_body(router, MealSetBody)
    items = [_round(i.model_dump()) for i in body.items]
    return _put(current_sub(router), "MEALSET#", uuid4().hex[:12], {"name": body.name.strip(), "items": items})


@router.delete("/meal-sets/<set_id>")
def delete_set_route(set_id: str) -> dict[str, Any]:
    sub = current_sub(router)
    _require(sub, "MEALSET#", set_id)
    table().delete_item(Key={"PK": user_pk(sub), "SK": f"MEALSET#{set_id}"})
    return {"ok": True}

