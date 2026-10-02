"""가계부 (DESIGN.md 6.8, 7장: USER#<sub> / TXN#<date>#<id>, CAT#<id>, RECUR#<id>, BUDGET#<yyyy-mm>).

- 금액은 원 단위 정수
- 카테고리: 하나도 없으면 기본 카테고리를 만든다. 유형(수입·지출)별 마지막 하나는 지울 수 없다
- 고정 지출: 가계부를 열 때(POST /recurring/apply) 오늘까지 빠진 회차를 만든다. 회차 id가 정해져 있어 두 번 만들지 않는다
- 예산: BUDGET#<달>은 "이 달부터 적용"하는 카테고리별 금액. 어떤 달의 예산은 그 달 이전(포함) 가장 최근 값
"""

import calendar
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Any, Literal
from uuid import uuid4

from aws_lambda_powertools.event_handler.api_gateway import Router
from aws_lambda_powertools.event_handler.exceptions import BadRequestError, NotFoundError
from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError
from pydantic import BaseModel, ConfigDict, Field

from common.access import current_sub
from common.aws import table
from common.http import parse_body
from common.serialize import to_dynamo, to_plain
from common.users import now_iso, user_pk

router = Router()

KST = timezone(timedelta(hours=9))
MONTH = r"^\d{4}-(0[1-9]|1[0-2])$"
MAX_RANGE_DAYS = 400
SEARCH_LIMIT = 200
Day = date
TxnType = Literal["income", "expense"]
Amount = Annotated[int, Field(ge=1, le=10_000_000_000)]

DEFAULT_CATEGORIES: list[tuple[TxnType, str]] = [
    *[("expense", n) for n in ("식비", "카페·간식", "교통", "주거·통신", "생활용품", "쇼핑", "의료", "문화·여가", "경조사", "기타")],
    *[("income", n) for n in ("급여", "부수입", "기타")],
]


def today() -> date:
    """KST 오늘 (테스트에서 바꿔 끼운다)"""
    return datetime.now(KST).date()


class TxnBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date: Day
    type: TxnType
    amount: Amount
    categoryId: str = Field(pattern=r"^[A-Za-z0-9_-]{1,40}$")
    method: str = Field(default="", max_length=30)  # 결제 수단 (직접 입력)
    memo: str = Field(default="", max_length=200)


class CategoryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: TxnType
    name: str = Field(min_length=1, max_length=20)


class CategoryPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=20)
    order: float | None = None


class RecurBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: TxnType = "expense"
    amount: Amount
    categoryId: str = Field(pattern=r"^[A-Za-z0-9_-]{1,40}$")
    method: str = Field(default="", max_length=30)
    memo: str = Field(default="", max_length=200)
    day: int = Field(ge=1, le=31)  # 매월 n일 (짧은 달은 말일)
    startMonth: str = Field(pattern=MONTH)
    endMonth: str | None = Field(default=None, pattern=MONTH)


class BudgetBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    amounts: dict[Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,40}$")], Annotated[int, Field(ge=0, le=10_000_000_000)]] = Field(max_length=50)


# ── 저장소 ───────────────────────────────────────────

def _query(sub: str, cond: Any, **kwargs: Any) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    start: dict[str, Any] | None = None
    while True:
        page = table().query(KeyConditionExpression=Key("PK").eq(user_pk(sub)) & cond, **kwargs, **({"ExclusiveStartKey": start} if start else {}))
        items.extend(page["Items"])
        start = page.get("LastEvaluatedKey")
        if not start:
            return items


def _strip(item: dict[str, Any]) -> dict[str, Any]:
    return to_plain({k: v for k, v in item.items() if k not in ("PK", "SK")})


def _q(name: str) -> str | None:
    return router.current_event.get_query_string_value(name)


def _month_range(month: str) -> tuple[date, date]:
    y, m = int(month[:4]), int(month[5:])
    return date(y, m, 1), date(y, m, calendar.monthrange(y, m)[1])


def _add_months(month: str, n: int) -> str:
    y, m = divmod(int(month[:4]) * 12 + int(month[5:]) - 1 + n, 12)
    return f"{y:04d}-{m + 1:02d}"


def _txns_between(sub: str, frm: date, to: date) -> list[dict[str, Any]]:
    items = _query(sub, Key("SK").between(f"TXN#{frm}", f"TXN#{to}#￿"))
    return [_strip(i) for i in items]


def _categories(sub: str) -> list[dict[str, Any]]:
    items = [_strip(i) for i in _query(sub, Key("SK").begins_with("CAT#"))]
    if not items:
        # 처음 쓰는 사용자: 기본 카테고리 (DESIGN.md 6.8 구현 결정)
        with table().batch_writer() as batch:
            for i, (kind, name) in enumerate(DEFAULT_CATEGORIES, start=1):
                cid = uuid4().hex[:12]
                item = {"PK": user_pk(sub), "SK": f"CAT#{cid}", "id": cid, "type": kind, "name": name, "order": i}
                batch.put_item(Item=item)
                items.append(_strip(item))
    return sorted(items, key=lambda c: (c["type"] != "expense", c["order"]))


def _check_category(sub: str, category_id: str, kind: TxnType) -> None:
    cat = table().get_item(Key={"PK": user_pk(sub), "SK": f"CAT#{category_id}"}).get("Item")
    if cat is None:
        raise BadRequestError("category not found")
    if cat["type"] != kind:
        raise BadRequestError("category type does not match")


# ── 내역 ─────────────────────────────────────────────

@router.get("/txns")
def list_txns() -> dict[str, Any]:
    """?month=YYYY-MM 또는 ?from&to (400일 이내)"""
    sub = current_sub(router)
    month = _q("month")
    if month:
        frm, to = _month_range(_check_month(month))
    else:
        try:
            frm, to = date.fromisoformat(_q("from") or ""), date.fromisoformat(_q("to") or "")
        except ValueError as exc:
            raise BadRequestError("month or from, to is required") from exc
        if to < frm or (to - frm).days > MAX_RANGE_DAYS:
            raise BadRequestError(f"range must be 0~{MAX_RANGE_DAYS} days")
    return {"txns": _txns_between(sub, frm, to)}


@router.get("/txns/summary")
def summary() -> dict[str, Any]:
    """월별 추이: 최근 n개월(기본 6, 최대 12) 수입·지출 합계 + 최근 쓴 결제 수단 (자동완성)"""
    sub = current_sub(router)
    try:
        months = max(1, min(12, int(_q("months") or 6)))
    except ValueError as exc:
        raise BadRequestError("months must be a number") from exc
    end = today().strftime("%Y-%m")
    first = _add_months(end, -(months - 1))
    txns = _txns_between(sub, _month_range(first)[0], _month_range(end)[1])
    totals = {_add_months(first, i): {"month": _add_months(first, i), "income": 0, "expense": 0} for i in range(months)}
    for t in txns:
        totals[t["date"][:7]][t["type"]] += t["amount"]
    methods: list[str] = []
    for t in sorted(txns, key=lambda t: t["date"], reverse=True):
        if t.get("method") and t["method"] not in methods:
            methods.append(t["method"])
    return {"months": list(totals.values()), "methods": methods[:20]}


@router.get("/txns/search")
def search() -> dict[str, Any]:
    """메모·결제 수단·카테고리 이름에 검색어가 들어간 내역 (최신 200개)"""
    sub = current_sub(router)
    q = (_q("q") or "").strip()
    if not q:
        raise BadRequestError("q is required")
    cat_ids = [c["id"] for c in _categories(sub) if q in c["name"]]
    cond = Attr("memo").contains(q) | Attr("method").contains(q)
    for cid in cat_ids:
        cond = cond | Attr("categoryId").eq(cid)
    items = _query(sub, Key("SK").begins_with("TXN#"), FilterExpression=cond, ScanIndexForward=False)
    return {"txns": [_strip(i) for i in items[:SEARCH_LIMIT]]}


def _txn_item(sub: str, txn_id: str, body: TxnBody, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    data = body.model_dump(mode="json")
    return {"PK": user_pk(sub), "SK": f"TXN#{data['date']}#{txn_id}", "id": txn_id, **data, **(extra or {}), "updatedAt": now_iso()}


@router.post("/txns")
def create_txn() -> dict[str, Any]:
    sub = current_sub(router)
    body = parse_body(router, TxnBody)
    _check_category(sub, body.categoryId, body.type)
    item = _txn_item(sub, uuid4().hex[:12], body)
    table().put_item(Item=item)
    return _strip(item)


def _day_param() -> str:
    raw = _q("date") or ""
    try:
        return date.fromisoformat(raw).isoformat()
    except ValueError as exc:
        raise BadRequestError("date query must be YYYY-MM-DD") from exc


@router.put("/txns/<txn_id>")
def update_txn(txn_id: str) -> dict[str, Any]:
    """?date=원래 날짜. 날짜를 바꾸면 키가 바뀌므로 옮겨 저장한다"""
    sub = current_sub(router)
    old_key = {"PK": user_pk(sub), "SK": f"TXN#{_day_param()}#{txn_id}"}
    old = table().get_item(Key=old_key).get("Item")
    if old is None:
        raise NotFoundError("txn not found")
    body = parse_body(router, TxnBody)
    _check_category(sub, body.categoryId, body.type)
    item = _txn_item(sub, txn_id, body, {"recurId": old["recurId"]} if "recurId" in old else None)
    table().put_item(Item=item)
    if item["SK"] != old_key["SK"]:
        table().delete_item(Key=old_key)
    return _strip(item)


@router.delete("/txns/<txn_id>")
def delete_txn(txn_id: str) -> dict[str, Any]:
    sub = current_sub(router)
    key = {"PK": user_pk(sub), "SK": f"TXN#{_day_param()}#{txn_id}"}
    if table().get_item(Key=key).get("Item") is None:
        raise NotFoundError("txn not found")
    table().delete_item(Key=key)
    return {"deleted": txn_id}


# ── 카테고리 ─────────────────────────────────────────

@router.get("/categories")
def list_categories() -> dict[str, Any]:
    return {"categories": _categories(current_sub(router))}


@router.post("/categories")
def create_category() -> dict[str, Any]:
    sub = current_sub(router)
    body = parse_body(router, CategoryCreate)
    cats = _categories(sub)
    if len(cats) >= 50:
        raise BadRequestError("up to 50 categories")
    cid = uuid4().hex[:12]
    order = max((c["order"] for c in cats if c["type"] == body.type), default=0) + 1
    item = {"PK": user_pk(sub), "SK": f"CAT#{cid}", "id": cid, "type": body.type, "name": body.name, "order": to_dynamo(float(order))}
    table().put_item(Item=item)
    return _strip(item)


@router.patch("/categories/<cid>")
def patch_category(cid: str) -> dict[str, Any]:
    sub = current_sub(router)
    changes = parse_body(router, CategoryPatch).model_dump(exclude_none=True)
    if not changes:
        raise BadRequestError("nothing to update")
    item = table().get_item(Key={"PK": user_pk(sub), "SK": f"CAT#{cid}"}).get("Item")
    if item is None:
        raise NotFoundError("category not found")
    item = {**item, **to_dynamo(changes)}
    table().put_item(Item=item)
    return _strip(item)


@router.delete("/categories/<cid>")
def delete_category(cid: str) -> dict[str, Any]:
    """내역은 그대로 두고 화면에서 "삭제된 카테고리"로 보인다"""
    sub = current_sub(router)
    cats = _categories(sub)
    cat = next((c for c in cats if c["id"] == cid), None)
    if cat is None:
        raise NotFoundError("category not found")
    if sum(1 for c in cats if c["type"] == cat["type"]) == 1:
        raise BadRequestError("keep at least one category of each type")
    table().delete_item(Key={"PK": user_pk(sub), "SK": f"CAT#{cid}"})
    return {"deleted": cid}


# ── 고정 지출 ────────────────────────────────────────

def _validate_recur(sub: str, body: RecurBody) -> None:
    _check_category(sub, body.categoryId, body.type)
    if body.endMonth and body.endMonth < body.startMonth:
        raise BadRequestError("endMonth must be after startMonth")


@router.get("/recurring")
def list_recurring() -> dict[str, Any]:
    items = [_strip(i) for i in _query(current_sub(router), Key("SK").begins_with("RECUR#"))]
    return {"recurring": sorted(items, key=lambda r: (r["day"], r["memo"]))}


@router.post("/recurring")
def create_recurring() -> dict[str, Any]:
    sub = current_sub(router)
    body = parse_body(router, RecurBody)
    _validate_recur(sub, body)
    rid = uuid4().hex[:12]
    item = {"PK": user_pk(sub), "SK": f"RECUR#{rid}", "id": rid, **body.model_dump(exclude_none=True), "createdAt": now_iso()}
    table().put_item(Item=item)
    return _strip(item)


@router.put("/recurring/<rid>")
def update_recurring(rid: str) -> dict[str, Any]:
    """이미 만든 회차는 그대로 두고, 다음 회차부터 바뀐 값으로 만든다"""
    sub = current_sub(router)
    old = table().get_item(Key={"PK": user_pk(sub), "SK": f"RECUR#{rid}"}).get("Item")
    if old is None:
        raise NotFoundError("recurring not found")
    body = parse_body(router, RecurBody)
    _validate_recur(sub, body)
    keep = {k: old[k] for k in ("createdAt", "lastMonth") if k in old}
    item = {"PK": user_pk(sub), "SK": f"RECUR#{rid}", "id": rid, **body.model_dump(exclude_none=True), **keep}
    table().put_item(Item=item)
    return _strip(item)


@router.delete("/recurring/<rid>")
def delete_recurring(rid: str) -> dict[str, Any]:
    """이미 만든 내역은 남긴다"""
    sub = current_sub(router)
    key = {"PK": user_pk(sub), "SK": f"RECUR#{rid}"}
    if table().get_item(Key=key).get("Item") is None:
        raise NotFoundError("recurring not found")
    table().delete_item(Key=key)
    return {"deleted": rid}


def _occurrence(month: str, day: int) -> date:
    first, last = _month_range(month)
    return first.replace(day=min(day, last.day))


@router.post("/recurring/apply")
def apply_recurring() -> dict[str, Any]:
    """오늘까지 빠진 회차를 만든다. 회차 내역 id = r<고정id>-<YYYYMM> (조건부 저장으로 중복 방지).
    lastMonth(마지막으로 처리한 달) 이후만 보므로 사용자가 지운 회차는 다시 만들지 않는다"""
    sub = current_sub(router)
    now = today()
    this_month = now.strftime("%Y-%m")
    created = []
    for r in _query(sub, Key("SK").begins_with("RECUR#")):
        month = _add_months(r["lastMonth"], 1) if r.get("lastMonth") else r["startMonth"]
        last_done = r.get("lastMonth")
        while month <= this_month and (not r.get("endMonth") or month <= r["endMonth"]):
            day = _occurrence(month, int(r["day"]))
            if day > now:
                break
            body = TxnBody(date=day, type=r["type"], amount=int(r["amount"]), categoryId=r["categoryId"], method=r.get("method", ""), memo=r.get("memo", ""))
            item = _txn_item(sub, f"r{r['id']}-{month.replace('-', '')}", body, {"recurId": r["id"]})
            try:
                table().put_item(Item=item, ConditionExpression="attribute_not_exists(PK)")
                created.append(_strip(item))
            except ClientError as exc:
                if exc.response["Error"]["Code"] != "ConditionalCheckFailedException":
                    raise
            last_done = month
            month = _add_months(month, 1)
        if last_done != r.get("lastMonth"):
            table().update_item(Key={"PK": r["PK"], "SK": r["SK"]}, UpdateExpression="SET lastMonth = :m", ExpressionAttributeValues={":m": last_done})
    return {"created": created}


# ── 예산 ─────────────────────────────────────────────

def _check_month(month: str) -> str:
    try:
        datetime.strptime(month, "%Y-%m")
    except ValueError as exc:
        raise BadRequestError("month must be YYYY-MM") from exc
    if len(month) != 7:
        raise BadRequestError("month must be YYYY-MM")
    return month


@router.get("/budgets/<month>")
def get_budget(month: str) -> dict[str, Any]:
    """그 달에 적용되는 예산 (그 달 이전 가장 최근 설정). from = 설정한 달, 없으면 null"""
    sub = current_sub(router)
    _check_month(month)
    items = table().query(
        KeyConditionExpression=Key("PK").eq(user_pk(sub)) & Key("SK").between("BUDGET#0000-00", f"BUDGET#{month}"),
        ScanIndexForward=False,
        Limit=1,
    )["Items"]
    if not items:
        return {"month": month, "from": None, "amounts": {}}
    return {"month": month, "from": items[0]["SK"].removeprefix("BUDGET#"), "amounts": to_plain(items[0]["amounts"])}


@router.put("/budgets/<month>")
def put_budget(month: str) -> dict[str, Any]:
    """이 달부터 적용. 금액 0인 카테고리는 예산 없음으로 저장하지 않는다"""
    sub = current_sub(router)
    _check_month(month)
    amounts = {k: v for k, v in parse_body(router, BudgetBody).amounts.items() if v > 0}
    table().put_item(Item={"PK": user_pk(sub), "SK": f"BUDGET#{month}", "month": month, "amounts": amounts, "updatedAt": now_iso()})
    return {"month": month, "from": month, "amounts": amounts}
