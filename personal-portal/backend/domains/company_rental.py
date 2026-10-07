"""행컴퍼니 임대 계약·정기 청구·카운터 검침 (COMPANY.md 5장, C4).

계약 CONTRACT#<id>: 거래처 + 기기들(machines, 기기 id → 기기별 요금) + 청구일.
- 기기별 요금: 월 기본료(monthly), 카운터 과금이면 기본 매수(freeMono·freeColor)와 초과 단가(overMono·overColor)
- 계약 출고·기기 추가·수거는 임대 출고/수거 거래(company_txn 엔진)와 계약 변경을 한 트랜잭션으로 쓴다
- 정기 청구: 달마다 한 번. billedThrough = 마지막으로 청구한 달. 청구일이 지난 다음 달이 "청구 대기"에 뜨고,
  사람이 금액을 확인·수정해서 발행하면 청구 거래가 만들어진다 (자동 발행 없음)
- 일할 계산: 그 달 중간에 출고·수거한 기기는 사용 일수만큼 나눈 금액을 제안
- 초과 매수: (최근 검침 − 지난 청구 때 카운터) − 기본 매수. 검침이 없으면 경고만 하고 기본료만 제안

검침: 기기의 lastReading {date, mono, color} + 기기 이력(reading). 카운터는 줄어들 수 없다 (정정은 fix=true)
"""

import calendar
from datetime import date
from typing import Annotated, Any, Literal
from uuid import uuid4

from aws_lambda_powertools.event_handler.api_gateway import Router
from aws_lambda_powertools.event_handler.exceptions import BadRequestError, ForbiddenError, NotFoundError
from boto3.dynamodb.conditions import Key
from pydantic import BaseModel, ConfigDict, Field

from common.aws import table
from common.http import parse_body
from common.users import now_iso
from domains.company_core import CompanyCtx, company_audit, company_ctx, pk
from domains.company_master import asset_log, next_seq
from domains.company_notify import notify
from domains.company_txn import ID, LineIn, Tx, TxnCreate, _get, _partner_txns, _strip, _view, build_txn, finish_txn
from domains.sharing import query_all

router = Router()

MAX_MACHINES = 30
TERM_MONEY = ("monthly", "overMono", "overColor")
Count = Annotated[int, Field(ge=0, le=100_000_000)]
Won = Annotated[int, Field(ge=0, le=100_000_000)]


# ── 요청 본문 ────────────────────────────────────────

class Terms(BaseModel):
    """기기 한 대의 요금"""

    model_config = ConfigDict(extra="forbid")

    monthly: Won = 0  # 월 기본료
    counter: bool = False  # 카운터 과금 (기본 매수 + 초과)
    freeMono: Count = 0
    freeColor: Count = 0
    overMono: Won = 0  # 초과 1매당
    overColor: Won = 0


class Machine(Terms):
    assetId: str = Field(pattern=ID)
    startMono: Count | None = None  # 설치할 때 카운터
    startColor: Count | None = None


class TermsPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    monthly: Won | None = None
    counter: bool | None = None
    freeMono: Count | None = None
    freeColor: Count | None = None
    overMono: Won | None = None
    overColor: Won | None = None


class ContractCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    partnerId: str = Field(pattern=ID)
    date: date  # 출고일 = 계약 시작
    billingDay: int = Field(default=25, ge=1, le=31)  # 31 = 말일
    vatMode: Literal["included", "excluded", "exempt"] = "excluded"
    termEnd: date | None = None  # 계약 만료 예정일
    machines: list[Machine] = Field(min_length=1, max_length=MAX_MACHINES)
    lines: list[LineIn] = Field(default_factory=list, max_length=10)  # 설치비 등 같이 청구
    memo: str = Field(default="", max_length=500)


class MachinesAdd(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date: date
    machines: list[Machine] = Field(min_length=1, max_length=MAX_MACHINES)
    lines: list[LineIn] = Field(default_factory=list, max_length=10)
    memo: str = Field(default="", max_length=500)


class Reading(BaseModel):
    model_config = ConfigDict(extra="forbid")

    assetId: str = Field(pattern=ID)
    mono: Count
    color: Count | None = None


class ReturnBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date: date
    assetIds: list[Annotated[str, Field(pattern=ID)]] = Field(min_length=1, max_length=MAX_MACHINES)
    readings: list[Reading] = Field(default_factory=list, max_length=MAX_MACHINES)  # 수거할 때 카운터
    returnLocation: str = Field(default="", max_length=60)
    lines: list[LineIn] = Field(default_factory=list, max_length=10)  # 수거비 등
    memo: str = Field(default="", max_length=500)


class ContractPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    billingDay: int | None = Field(default=None, ge=1, le=31)
    vatMode: Literal["included", "excluded", "exempt"] | None = None
    termEnd: date | None = None
    memo: str | None = Field(default=None, max_length=500)
    machines: dict[str, TermsPatch] | None = None  # 기기 id → 바꿀 요금 (다음 청구부터)


class BillIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contractId: str = Field(pattern=ID)
    month: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    date: date  # 청구 거래 날짜
    lines: list[LineIn] = Field(max_length=60)


class BillIssue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[BillIn] = Field(min_length=1, max_length=50)


class ReadingIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date: date
    mono: Count
    color: Count | None = None
    fix: bool = False  # 잘못 넣은 값 정정 (줄어드는 값 허용)
    memo: str = Field(default="", max_length=200)


# ── 달 계산 ──────────────────────────────────────────

def month_add(ym: str, n: int) -> str:
    y, m = int(ym[:4]), int(ym[5:7]) + n
    while m > 12:
        y, m = y + 1, m - 12
    while m < 1:
        y, m = y - 1, m + 12
    return f"{y:04d}-{m:02d}"


def days_in(ym: str) -> int:
    return calendar.monthrange(int(ym[:4]), int(ym[5:7]))[1]


def bill_date(ym: str, billing_day: int) -> str:
    return f"{ym}-{min(billing_day, days_in(ym)):02d}"


def month_label(ym: str) -> str:
    return f"{int(ym[5:7])}월"


# ── 보기 ─────────────────────────────────────────────

def _contract_view(ctx: CompanyCtx, c: dict[str, Any]) -> dict[str, Any]:
    out = _strip(c)
    if not ctx.show_amounts:
        out["machines"] = {k: {f: v for f, v in m.items() if f not in TERM_MONEY} for k, m in out.get("machines", {}).items()}
    return out


def _contracts(cid: str) -> list[dict[str, Any]]:
    return [_strip(c) for c in query_all(KeyConditionExpression=Key("PK").eq(pk(cid)) & Key("SK").begins_with("CONTRACT#"))]


def _check_money(ctx: CompanyCtx, machines: list[Terms] | list[TermsPatch], lines: list[LineIn]) -> None:
    if ctx.show_amounts:
        return
    if any(any(getattr(m, f) for f in TERM_MONEY) for m in machines) or any(ln.unitPrice or ln.total or ln.supply for ln in lines):
        raise ForbiddenError("this needs amount permission")


def _machine_row(m: Machine, day: str, code: str, item_name: str) -> dict[str, Any]:
    row = m.model_dump(exclude={"startMono", "startColor"})
    start_mono, start_color = m.startMono or 0, m.startColor or 0
    return row | {"code": code, "itemName": item_name, "startedAt": day, "startMono": start_mono, "startColor": start_color, "billedMono": start_mono, "billedColor": start_color, "billedReadAt": day}


def _rows_and_readings(cid: str, machines: list[Machine], day: str) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    """계약에 들어갈 기기 줄 + 출고할 때 기기에 같이 쓸 값(계약 id는 나중에, 설치 카운터)"""
    if len({m.assetId for m in machines}) != len(machines):
        raise BadRequestError("duplicate assets")
    rows, sets = {}, {}
    for m in machines:
        a = _get(cid, f"ASSET#{m.assetId}", "asset")
        it = _get(cid, f"ITEM#{a['itemId']}", "item")
        rows[m.assetId] = _machine_row(m, day, a["code"], it["name"])
        sets[m.assetId] = {"lastReading": {"date": day, "mono": m.startMono or 0, "color": m.startColor or 0, "note": "설치"}} if m.counter and m.startMono is not None else {}
    return rows, sets


# ── 계약 ─────────────────────────────────────────────

@router.get("/company/<cid>/contracts")
def list_contracts(cid: str) -> dict[str, Any]:
    """?partnerId, ?status=active|ended|canceled"""
    ctx = company_ctx(router, cid, "contracts")
    q = router.current_event.get_query_string_value
    items = [c for c in _contracts(cid) if (not q("partnerId") or c["partnerId"] == q("partnerId")) and (not q("status") or c["status"] == q("status"))]
    items.sort(key=lambda c: c["no"], reverse=True)
    return {"contracts": [_contract_view(ctx, c) for c in items]}


@router.get("/company/<cid>/contracts/<kid>")
def get_contract(cid: str, kid: str) -> dict[str, Any]:
    """계약 + 이 계약의 거래(출고·추가·수거·정기 청구) + 다음 청구 대기"""
    ctx = company_ctx(router, cid, "contracts")
    c = _strip(_get(cid, f"CONTRACT#{kid}", "contract"))
    txns = [t for t in _partner_txns(cid)(c["partnerId"]) if t.get("contractId") == kid]
    txns.sort(key=lambda t: (t["date"], t["createdAt"]), reverse=True)
    pending = None
    if ctx.show_amounts:
        pending = _pending(c, _assets(cid), date.today().isoformat(), due_only=False)
    return {"contract": _contract_view(ctx, c), "txns": [_view(ctx, t) for t in txns], "pending": pending}


@router.post("/company/<cid>/contracts")
def create_contract(cid: str) -> dict[str, Any]:
    """새 계약 + 기기 출고 (+ 설치비 청구)를 한 번에"""
    ctx = company_ctx(router, cid, "contracts", "edit")
    body = parse_body(router, ContractCreate)
    _check_money(ctx, body.machines, body.lines)
    day = body.date.isoformat()
    if body.termEnd and body.termEnd < body.date:
        raise BadRequestError("termEnd is before start")
    rows, sets = _rows_and_readings(cid, body.machines, day)
    kid = uuid4().hex[:10]
    no = f"C-{day[:4]}-{next_seq(cid, f'contract#{day[:4]}'):04d}"
    for s in sets.values():
        s["contractId"] = kid
    b = build_txn(ctx, cid, TxnCreate(type="rental_out", date=body.date, partnerId=body.partnerId, assetIds=[m.assetId for m in body.machines], lines=body.lines, memo=body.memo or f"계약 {no}"), extra={"contractId": kid, "contractNo": no, "contractOp": "create"}, asset_set=sets)
    partner = b.partner or {}
    contract = {
        "PK": pk(cid),
        "SK": f"CONTRACT#{kid}",
        "id": kid,
        "no": no,
        "partnerId": partner["id"],
        "partnerName": partner["name"],
        "status": "active",
        "startDate": day,
        "billingDay": body.billingDay,
        "vatMode": body.vatMode,
        "memo": body.memo,
        "machines": rows,
        "billedThrough": "",
        "createdBy": ctx.sub,
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
        "ver": 1,
        **({"termEnd": body.termEnd.isoformat()} if body.termEnd else {}),
    }
    b.tx.put(contract, "attribute_not_exists(PK)")
    res = finish_txn(b)
    table().put_item(Item=company_audit(cid, ctx.sub, "contract_create", no, {"partner": partner["name"], "machines": len(rows)}))
    _rental_notify(cid, ctx.sub, "임대 출고", partner["name"], kid, b.txn)
    return {"contract": _contract_view(ctx, contract), **res}


@router.post("/company/<cid>/contracts/<kid>/machines")
def add_machines(cid: str, kid: str) -> dict[str, Any]:
    """진행 중 계약에 기기 추가 출고"""
    ctx = company_ctx(router, cid, "contracts", "edit")
    body = parse_body(router, MachinesAdd)
    _check_money(ctx, body.machines, body.lines)
    c = _get(cid, f"CONTRACT#{kid}", "contract")
    if c["status"] != "active":
        raise BadRequestError("contract is not active")
    day = body.date.isoformat()
    if day < c["startDate"]:
        raise BadRequestError("date is before the contract start")
    if any(m.assetId in c["machines"] for m in body.machines):
        raise BadRequestError("asset was already on this contract; make a new contract")
    rows, sets = _rows_and_readings(cid, body.machines, day)
    for s in sets.values():
        s["contractId"] = kid
    b = build_txn(ctx, cid, TxnCreate(type="rental_out", date=body.date, partnerId=c["partnerId"], assetIds=[m.assetId for m in body.machines], lines=body.lines, memo=body.memo or f"계약 {c['no']} 기기 추가"), extra={"contractId": kid, "contractNo": c["no"], "contractOp": "add"}, asset_set=sets)
    names = {f"#a{i}": aid for i, aid in enumerate(rows)}
    vals: dict[str, Any] = {f":r{i}": row for i, row in enumerate(rows.values())}
    sets_expr = ", ".join(f"machines.#a{i} = :r{i}" for i in range(len(rows)))
    b.tx.update({"PK": pk(cid), "SK": f"CONTRACT#{kid}"}, f"SET {sets_expr}, ver = ver + :one, updatedAt = :now", names | {"#st": "status"}, vals | {":one": 1, ":now": now_iso(), ":v": c["ver"], ":a": "active"}, "ver = :v AND #st = :a", "계약이 바뀌었습니다. 새로 고친 뒤 다시 시도하세요")
    res = finish_txn(b)
    _rental_notify(cid, ctx.sub, "임대 출고(추가)", c["partnerName"], kid, b.txn)
    return res


@router.post("/company/<cid>/contracts/<kid>/return")
def return_machines(cid: str, kid: str) -> dict[str, Any]:
    """계약 기기 수거 (+ 수거할 때 카운터). 마지막 기기를 수거하면 계약 종료. 정산 청구는 청구 대기에 뜬다"""
    ctx = company_ctx(router, cid, "contracts", "edit")
    body = parse_body(router, ReturnBody)
    _check_money(ctx, [], body.lines)
    c = _get(cid, f"CONTRACT#{kid}", "contract")
    day = body.date.isoformat()
    readings = {r.assetId: r for r in body.readings}
    if len(set(body.assetIds)) != len(body.assetIds):
        raise BadRequestError("duplicate assets")
    for aid in body.assetIds:
        row = c["machines"].get(aid)
        if row is None or row.get("endedAt"):
            raise BadRequestError("asset is not active on this contract")
        if day < row["startedAt"]:
            raise BadRequestError("return date is before the start")
        r = readings.get(aid)
        if r and (r.mono < row["billedMono"] or (r.color or 0) < row["billedColor"]):
            raise BadRequestError(f"counter is lower than the last billed value: {row['code']}")
    sets = {aid: {"lastReading": {"date": day, "mono": readings[aid].mono, "color": readings[aid].color or 0, "note": "수거"}} for aid in body.assetIds if aid in readings}
    b = build_txn(ctx, cid, TxnCreate(type="rental_return", date=body.date, partnerId=c["partnerId"], assetIds=body.assetIds, lines=body.lines, returnLocation=body.returnLocation, memo=body.memo or f"계약 {c['no']} 수거"), extra={"contractId": kid, "contractNo": c["no"], "contractOp": "return"}, asset_set=sets)
    remaining = [aid for aid, row in c["machines"].items() if not row.get("endedAt") and aid not in body.assetIds]
    names = {f"#a{i}": aid for i, aid in enumerate(body.assetIds)}
    vals: dict[str, Any] = {":d": day, ":one": 1, ":now": now_iso(), ":v": c["ver"]}
    parts = []
    for i, aid in enumerate(body.assetIds):
        r = readings.get(aid)
        row = c["machines"][aid]
        vals |= {f":m{i}": r.mono if r else row["billedMono"], f":c{i}": (r.color or 0) if r else row["billedColor"]}
        parts += [f"machines.#a{i}.endedAt = :d", f"machines.#a{i}.endMono = :m{i}", f"machines.#a{i}.endColor = :c{i}"]
    if not remaining:
        parts += ["#st = :e", "endedAt = :d"]
        names["#st"] = "status"
        vals[":e"] = "ended"
    b.txn["returnAll"] = not remaining
    b.tx.update({"PK": pk(cid), "SK": f"CONTRACT#{kid}"}, "SET " + ", ".join(parts) + ", ver = ver + :one, updatedAt = :now", names, vals, "ver = :v", "계약이 바뀌었습니다. 새로 고친 뒤 다시 시도하세요")
    for aid in sets:
        b.tx.put(asset_log(cid, aid, ctx.sub, "reading", mono=readings[aid].mono, color=readings[aid].color or 0, date=day, note="수거"))
    res = finish_txn(b)
    _rental_notify(cid, ctx.sub, "수거" + (" · 계약 종료" if not remaining else ""), c["partnerName"], kid, b.txn)
    return res


def _rental_notify(cid: str, actor: str, what: str, partner: str, kid: str, txn: dict[str, Any]) -> None:
    notify(cid, "rental", f"{what}: {partner}", ", ".join(txn.get("assetCodes", []))[:120], f"/company/{cid}/contracts/{kid}", exclude=actor)


@router.patch("/company/<cid>/contracts/<kid>")
def patch_contract(cid: str, kid: str) -> dict[str, Any]:
    """청구일·부가세·만료일·메모·기기별 요금 (다음 청구부터 적용)"""
    ctx = company_ctx(router, cid, "contracts", "edit")
    body = parse_body(router, ContractPatch)
    c = _get(cid, f"CONTRACT#{kid}", "contract")
    if c["status"] == "canceled":
        raise BadRequestError("contract is canceled")
    changes = body.model_dump(exclude_unset=True, exclude={"machines"}, mode="json")
    machines = c["machines"]
    for aid, tp in (body.machines or {}).items():
        if aid not in machines:
            raise BadRequestError("asset is not on this contract")
        _check_money(ctx, [tp], [])
        machines[aid] |= tp.model_dump(exclude_unset=True, exclude_none=True)
    if not changes and not body.machines:
        raise BadRequestError("nothing to update")
    merged = {**c, **{k: v for k, v in changes.items() if v is not None}, "machines": machines, "updatedAt": now_iso(), "ver": c["ver"] + 1}
    if "termEnd" in changes and changes["termEnd"] is None:
        merged.pop("termEnd", None)
    tx = Tx()
    tx.put({**merged, "PK": pk(cid), "SK": f"CONTRACT#{kid}"}, "ver = :v", values={":v": c["ver"]}, fail="계약이 바뀌었습니다. 새로 고친 뒤 다시 시도하세요")
    tx.put(company_audit(cid, ctx.sub, "contract_change", c["no"], {"fields": sorted([*changes, *(["machines"] if body.machines else [])])}))
    tx.run()
    return {"contract": _contract_view(ctx, merged)}


# ── 정기 청구 ────────────────────────────────────────

def _pending(c: dict[str, Any], assets: dict[str, dict[str, Any]], today: str, due_only: bool = True) -> dict[str, Any] | None:
    """계약의 다음 청구할 달과 제안 금액 줄. 진행 중 계약은 청구일이 지나야, 종료된 계약은 종료한 달까지 바로"""
    if c["status"] == "canceled":
        return None
    month = month_add(c["billedThrough"], 1) if c["billedThrough"] else c["startDate"][:7]
    ended = c["status"] == "ended"
    if ended and month > c["endedAt"][:7]:
        return None
    due_on = bill_date(month, int(c["billingDay"]))
    if not ended and due_on > today and due_only:
        return None
    first, last = f"{month}-01", f"{month}-{days_in(month):02d}"
    dim = days_in(month)
    lines: list[dict[str, Any]] = []
    counters: list[dict[str, Any]] = []
    warnings: list[str] = []
    vat = c.get("vatMode", "excluded")
    for aid, m in sorted(c["machines"].items(), key=lambda kv: kv[1]["code"]):
        start, end = m["startedAt"], m.get("endedAt")
        if start > last or (end and end < first):
            continue
        used_from, used_to = max(start, first), min(end or last, last)
        days = (date.fromisoformat(used_to) - date.fromisoformat(used_from)).days + 1
        label = f"{m['code']} {m['itemName']}"
        if m.get("monthly"):
            full = days >= dim
            amount = int(m["monthly"]) if full else round(int(m["monthly"]) * days / dim)
            lines.append({"name": f"{month_label(month)} 임대료 {label}", "qty": 1, "unitPrice": amount, "vatMode": vat, "memo": "" if full else f"일할 {days}/{dim}일 (월 {int(m['monthly']):,}원)"})
        if not m.get("counter"):
            continue
        read = {"date": end, "mono": m.get("endMono"), "color": m.get("endColor")} if end else assets.get(aid, {}).get("lastReading")
        from_mono, from_color = int(m["billedMono"]), int(m["billedColor"])
        if not read or read.get("mono") is None or read["date"] <= m.get("billedReadAt", "") and not end:
            warnings.append(f"검침 없음: {m['code']} (지난 청구 이후)")
            continue
        to_mono, to_color = max(int(read["mono"]), from_mono), max(int(read.get("color") or 0), from_color)
        counters.append({"assetId": aid, "code": m["code"], "fromMono": from_mono, "toMono": to_mono, "fromColor": from_color, "toColor": to_color, "fromReadAt": m.get("billedReadAt", ""), "readAt": read["date"]})
        for kind, used, free, price in (("흑백", to_mono - from_mono, int(m.get("freeMono", 0)), int(m.get("overMono", 0))), ("컬러", to_color - from_color, int(m.get("freeColor", 0)), int(m.get("overColor", 0)))):
            over = used - free
            if over > 0 and price > 0:
                lines.append({"name": f"{m['code']} {kind} 초과 {over:,}매", "qty": over, "unitPrice": price, "vatMode": vat, "memo": f"사용 {used:,}매 − 기본 {free:,}매"})
    behind = 0
    if not ended:
        cur = today[:7]
        behind = sum(1 for k in range(0, 36) if month_add(month, k) <= cur and bill_date(month_add(month, k), int(c["billingDay"])) <= today)
    return {"contractId": c["id"], "contractNo": c["no"], "partnerId": c["partnerId"], "partnerName": c["partnerName"], "month": month, "dueOn": due_on, "final": ended, "behind": behind, "lines": lines, "counters": counters, "warnings": warnings}


def _assets(cid: str) -> dict[str, dict[str, Any]]:
    return {a["id"]: _strip(a) for a in query_all(KeyConditionExpression=Key("PK").eq(pk(cid)) & Key("SK").begins_with("ASSET#")) if "#LOG#" not in a["SK"]}


@router.get("/company/<cid>/billing")
def billing_pending(cid: str) -> dict[str, Any]:
    """청구 대기: 청구일이 지난 계약마다 다음 한 달 (밀린 달은 하나씩 차례로)"""
    ctx = company_ctx(router, cid, "contracts")
    if not ctx.show_amounts:
        raise ForbiddenError("needs amount permission")
    today = date.today().isoformat()
    assets = _assets(cid)
    rows = [p for c in _contracts(cid) if (p := _pending(c, assets, today))]
    rows.sort(key=lambda p: (p["dueOn"], p["partnerName"]))
    return {"pending": rows}


def _issue(ctx: CompanyCtx, cid: str, bill: BillIn, assets: dict[str, dict[str, Any]]) -> dict[str, Any]:
    c = _strip(_get(cid, f"CONTRACT#{bill.contractId}", "contract"))
    p = _pending(c, assets, date.today().isoformat())
    if p is None or p["month"] != bill.month:
        raise BadRequestError(f"{c['no']}: {bill.month} is not the next month to bill")
    lines = bill.lines or [LineIn(name=f"{month_label(bill.month)} 청구 없음", qty=1, unitPrice=0)]
    b = build_txn(
        ctx,
        cid,
        TxnCreate(type="charge", date=bill.date, partnerId=c["partnerId"], lines=lines, memo=f"계약 {c['no']} {month_label(bill.month)} 청구"),
        extra={"contractId": c["id"], "contractNo": c["no"], "billMonth": bill.month, "billPrev": c["billedThrough"], "billCounters": p["counters"]},
    )
    names: dict[str, str] = {}
    vals: dict[str, Any] = {":m": bill.month, ":prev": c["billedThrough"], ":one": 1, ":now": now_iso()}
    sets = ["billedThrough = :m", "updatedAt = :now"]
    for i, k in enumerate(p["counters"]):
        names[f"#a{i}"] = k["assetId"]
        vals |= {f":bm{i}": k["toMono"], f":bc{i}": k["toColor"], f":br{i}": k["readAt"]}
        sets += [f"machines.#a{i}.billedMono = :bm{i}", f"machines.#a{i}.billedColor = :bc{i}", f"machines.#a{i}.billedReadAt = :br{i}"]
    b.tx.update({"PK": pk(cid), "SK": f"CONTRACT#{c['id']}"}, "SET " + ", ".join(sets) + ", ver = ver + :one", names or None, vals, "billedThrough = :prev", f"{c['no']}: 이미 청구했습니다")
    return finish_txn(b)["txn"]


@router.post("/company/<cid>/billing")
def issue_bills(cid: str) -> dict[str, Any]:
    """확인한 청구를 발행. 계약마다 따로 저장해서 하나가 실패해도 나머지는 발행된다"""
    ctx = company_ctx(router, cid, "contracts", "edit")
    body = parse_body(router, BillIssue)
    assets = _assets(cid)
    results = []
    for bill in body.items:
        try:
            t = _issue(ctx, cid, bill, assets)
            results.append({"contractId": bill.contractId, "month": bill.month, "ok": True, "txn": {"id": t["id"], "no": t["no"], "date": t["date"], "total": t.get("total")}})
        except (BadRequestError, ForbiddenError) as exc:
            results.append({"contractId": bill.contractId, "month": bill.month, "ok": False, "error": str(exc.msg)})
        except NotFoundError:
            results.append({"contractId": bill.contractId, "month": bill.month, "ok": False, "error": "contract not found"})
    return {"results": results}


# ── 검침 ─────────────────────────────────────────────

@router.get("/company/<cid>/readings")
def readings_due(cid: str) -> dict[str, Any]:
    """검침할 기기: 진행 중 계약의 카운터 과금 기기 (거래처순). 마지막 검침과 지난 청구 카운터"""
    company_ctx(router, cid, "assets")
    assets = _assets(cid)
    rows = []
    for c in _contracts(cid):
        if c["status"] != "active":
            continue
        for aid, m in c["machines"].items():
            if not m.get("counter") or m.get("endedAt"):
                continue
            a = assets.get(aid, {})
            rows.append({
                "contractId": c["id"], "contractNo": c["no"], "partnerId": c["partnerId"], "partnerName": c["partnerName"], "billingDay": c["billingDay"],
                "assetId": aid, "code": m["code"], "itemName": m["itemName"], "color": bool(m.get("freeColor") or m.get("overColor") or m.get("startColor")),
                "lastReading": a.get("lastReading"), "billedMono": m["billedMono"], "billedColor": m["billedColor"], "billedReadAt": m.get("billedReadAt", ""),
            })
    rows.sort(key=lambda r: (r["partnerName"], r["code"]))
    return {"rows": rows}


@router.post("/company/<cid>/assets/<aid>/readings")
def add_reading(cid: str, aid: str) -> dict[str, Any]:
    ctx = company_ctx(router, cid, "assets", "edit")
    body = parse_body(router, ReadingIn)
    a = _get(cid, f"ASSET#{aid}", "asset")
    prev = a.get("lastReading")
    day = body.date.isoformat()
    color = body.color or 0
    if prev and not body.fix:
        if body.mono < int(prev["mono"]) or color < int(prev.get("color") or 0):
            raise BadRequestError(f"counter is lower than the last reading ({int(prev['mono']):,} / {int(prev.get('color') or 0):,}). Use fix to correct")
        if day < prev["date"]:
            raise BadRequestError("date is before the last reading")
    reading = {"date": day, "mono": body.mono, "color": color, "note": body.memo}
    tx = Tx()
    if prev:
        tx.update({"PK": pk(cid), "SK": f"ASSET#{aid}"}, "SET lastReading = :r, updatedAt = :now", {"#d": "date"}, {":r": reading, ":now": now_iso(), ":pd": prev["date"], ":pm": prev["mono"]}, "lastReading.#d = :pd AND lastReading.mono = :pm", "다른 검침이 먼저 들어왔습니다. 새로 고친 뒤 다시 시도하세요")
    else:
        tx.update({"PK": pk(cid), "SK": f"ASSET#{aid}"}, "SET lastReading = :r, updatedAt = :now", None, {":r": reading, ":now": now_iso()}, "attribute_exists(PK) AND attribute_not_exists(lastReading)", "다른 검침이 먼저 들어왔습니다. 새로 고친 뒤 다시 시도하세요")
    tx.put(asset_log(cid, aid, ctx.sub, "reading", mono=body.mono, color=color, date=day, note=("정정 " if body.fix else "") + body.memo))
    tx.run()
    return {"lastReading": reading}
