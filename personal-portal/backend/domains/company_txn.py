"""행컴퍼니 거래 엔진 (COMPANY.md 3·5·6장, C3).

거래 하나(TXN#<date>#<id>)가 바꾸는 모든 것 — 재고 수량, 기기 상태, 거래처 잔액, 계좌 잔액, 청구↔입금 배분 —
을 파이썬에서 먼저 계산하고 DynamoDB 트랜잭션 한 번으로 쓴다. 조건(재고 부족, 이미 임대 중 등)이 하나라도 안 맞으면 전부 취소.
같은 항목은 한 트랜잭션에 한 번만 쓸 수 있어서 거래처·계좌·품목 변경은 합쳐서 한 번에 쓴다.

잔액 (거래처)
- receivable 미수 = 청구성 거래(판매·청구·임대 출고/수거의 금액) 합 − 입금 배분 합
- advance 선수 = 배분되지 않은 입금 (새 청구가 생기면 자동 상계)
- payable 미지급 = 매입 합 − 지급 배분 합, prepaid 선급 = 배분되지 않은 지급
청구성 거래: total·paid·paidBy[], 입금·지급: amount·unallocated·allocations[]

취소: 지우지 않고 status=canceled + 모든 효과를 되돌린다. 배분된 돈은 선수(선급)로 돌아간다. 마감된 달은 생성·취소 불가
"""

from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Annotated, Any, Literal
from uuid import uuid4

from aws_lambda_powertools.event_handler.api_gateway import Router
from aws_lambda_powertools.event_handler.exceptions import BadRequestError, ForbiddenError, NotFoundError
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError
from pydantic import BaseModel, ConfigDict, Field, model_validator

from common.aws import dynamodb, table
from common.http import parse_body
from common.serialize import to_dynamo, to_plain
from common.users import now_iso
from domains.company_core import CompanyCtx, company_audit, company_ctx, pk, redact
from domains.company_master import asset_log, asset_prefix, next_seq
from domains.company_notify import notify
from domains.sharing import query_all

router = Router()

Day = date
ID = r"^[A-Za-z0-9_-]{1,40}$"
VatMode = Literal["included", "excluded", "exempt"]
TxnType = Literal["sale", "charge", "purchase", "rental_out", "rental_return", "receipt", "payment", "expense", "adjust", "service"]
CHARGE_TYPES = {"sale", "charge", "rental_out", "rental_return", "service"}  # 미수가 생기는 거래
STOCK_SIGN = {"sale": -1, "purchase": 1, "adjust": 1, "service": -1}  # 거래가 재고를 바꾸는 방향 (service = A/S 부품 사용)
INTERNAL_TYPES = {"service"}  # 다른 화면(A/S 완료)에서만 만드는 거래
PAYABLE_TYPES = {"purchase"}  # 미지급이 생기는 거래
MONEY_TYPES = {"sale", "charge", "purchase", "receipt", "payment", "expense"}  # 금액 보기 필요
MAX_LINES = 30
MAX_ASSETS = 30
MAX_RANGE_DAYS = 400
TXN_MONEY = ("supply", "vat", "total", "paid", "paidBy", "amount", "allocated", "unallocated", "allocations")
LINE_MONEY = ("unitPrice", "supply", "vat", "total", "manual")

TYPE_LABEL = {
    "sale": "판매",
    "charge": "청구",
    "purchase": "매입",
    "rental_out": "임대 출고",
    "rental_return": "수거",
    "receipt": "입금",
    "payment": "지급",
    "expense": "경비",
    "adjust": "재고 조정",
    "service": "A/S",
}


# ── 요청 본문 ────────────────────────────────────────

class LineIn(BaseModel):
    """금액 줄. supply·vat·total을 비우면 수량×단가와 부가세 방식으로 계산, 직접 넣으면 그 값을 쓴다"""

    model_config = ConfigDict(extra="forbid")

    itemId: str | None = Field(default=None, pattern=ID)
    name: str = Field(default="", max_length=100)
    qty: Annotated[float, Field(ge=-1_000_000, le=1_000_000)] = 1
    unitPrice: Annotated[int, Field(ge=0, le=10_000_000_000)] = 0
    vatMode: VatMode = "excluded"
    supply: int | None = Field(default=None, ge=-10_000_000_000, le=10_000_000_000)
    vat: int | None = Field(default=None, ge=-10_000_000_000, le=10_000_000_000)
    total: int | None = Field(default=None, ge=-10_000_000_000, le=10_000_000_000)
    memo: str = Field(default="", max_length=200)


class Allocation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    txnId: str = Field(pattern=ID)
    date: Day
    amount: Annotated[int, Field(ge=1, le=10_000_000_000)]


class PayNow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    accountId: str = Field(pattern=ID)


class TxnCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: TxnType
    date: Day
    partnerId: str | None = Field(default=None, pattern=ID)
    accountId: str | None = Field(default=None, pattern=ID)
    lines: list[LineIn] = Field(default_factory=list, max_length=MAX_LINES)
    assetIds: list[Annotated[str, Field(pattern=ID)]] = Field(default_factory=list, max_length=MAX_ASSETS)
    returnLocation: str = Field(default="", max_length=60)
    amount: Annotated[int, Field(ge=1, le=10_000_000_000)] | None = None  # 입금·지급·경비
    allocations: list[Allocation] | None = Field(default=None, max_length=50)  # 입금·지급: 비우면 오래된 것부터 자동
    payNow: PayNow | None = None  # 판매·매입·청구를 바로 결제
    category: str = Field(default="", max_length=30)  # 경비 항목
    serviceId: str | None = Field(default=None, pattern=ID)  # 청구: 완료된 A/S를 나중에 청구
    memo: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def check(self) -> "TxnCreate":
        t = self.type
        if t in {"sale", "charge", "purchase", "rental_out", "rental_return", "receipt", "payment", "service"} and not self.partnerId:
            raise ValueError("partnerId is required")
        if t in {"receipt", "payment", "expense"}:
            if not self.accountId or not self.amount:
                raise ValueError("accountId and amount are required")
            if self.lines:
                raise ValueError("lines are not used for this type")
        if t in {"sale", "charge", "purchase", "adjust", "service"} and not self.lines:
            raise ValueError("lines are required")
        if t in {"rental_out", "rental_return"} and not self.assetIds:
            raise ValueError("assetIds are required")
        if len(set(self.assetIds)) != len(self.assetIds):
            raise ValueError("duplicate assets")
        if self.serviceId and t != "charge":
            raise ValueError("serviceId is for charge")
        if self.payNow and t not in {"sale", "charge", "purchase"}:
            raise ValueError("payNow is for sale, charge, purchase")
        if t == "adjust" and any(not ln.itemId or ln.qty == 0 for ln in self.lines):
            raise ValueError("adjust lines need itemId and non-zero qty")
        if t != "adjust" and any(ln.qty <= 0 for ln in self.lines):
            raise ValueError("qty must be positive")
        return self


class CancelBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(default="", max_length=200)


class CloseBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    month: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")


# ── 금액 계산 (COMPANY.md 6장) ───────────────────────

def price_line(ln: LineIn) -> dict[str, Any]:
    base = round(ln.qty * ln.unitPrice)
    given = (ln.supply is not None, ln.vat is not None, ln.total is not None)
    if given == (False, False, False):
        if ln.vatMode == "included":
            total = base
            supply = round(total / 1.1)
            vat = total - supply
        elif ln.vatMode == "excluded":
            supply, vat = base, round(base * 0.1)
            total = supply + vat
        else:
            supply, vat, total = base, 0, base
        manual = False
    elif given == (False, False, True):
        total = ln.total  # type: ignore[assignment]
        supply = total if ln.vatMode == "exempt" else round(total / 1.1)
        vat = total - supply
        manual = True
    elif given == (True, True, False):
        supply, vat = ln.supply, ln.vat  # type: ignore[assignment]
        total = supply + vat
        manual = True
    elif given == (True, True, True):
        supply, vat, total = ln.supply, ln.vat, ln.total  # type: ignore[assignment]
        if supply + vat != total:
            raise BadRequestError("supply + vat must equal total")
        manual = True
    else:
        raise BadRequestError("give total only, supply+vat, or all three")
    return {
        "itemId": ln.itemId,
        "name": ln.name,
        "qty": ln.qty,
        "unitPrice": ln.unitPrice,
        "vatMode": ln.vatMode,
        "supply": supply,
        "vat": vat,
        "total": total,
        "manual": manual,
        "memo": ln.memo,
    }


# ── 트랜잭션 쓰기 ────────────────────────────────────

def _av(v: dict[str, Any]) -> dict[str, Any]:
    """resource의 client(dynamodb().meta.client)는 파이썬 값을 알아서 직렬화한다 → Decimal 변환만"""
    return {k: to_dynamo(x) for k, x in v.items()}


class Tx:
    """DynamoDB TransactWriteItems 모음. fail: 조건이 깨졌을 때 보여 줄 이유"""

    def __init__(self) -> None:
        self.ops: list[dict[str, Any]] = []
        self.fails: list[str] = []
        self.keys: set[tuple[str, str]] = set()

    def _key(self, key: dict[str, str]) -> None:
        k = (key["PK"], key["SK"])
        if k in self.keys:
            raise RuntimeError(f"same item twice in a transaction: {k}")
        self.keys.add(k)

    def put(self, item: dict[str, Any], cond: str | None = None, names: dict[str, str] | None = None, values: dict[str, Any] | None = None, fail: str = "conflict") -> None:
        self._key({"PK": item["PK"], "SK": item["SK"]})
        op: dict[str, Any] = {"TableName": table().name, "Item": _av(item)}
        if cond:
            op["ConditionExpression"] = cond
            if names:
                op["ExpressionAttributeNames"] = names
            if values:
                op["ExpressionAttributeValues"] = _av(values)
        self.ops.append({"Put": op})
        self.fails.append(fail)

    def update(self, key: dict[str, str], expr: str, names: dict[str, str] | None = None, values: dict[str, Any] | None = None, cond: str | None = None, fail: str = "conflict") -> None:
        self._key(key)
        op: dict[str, Any] = {"TableName": table().name, "Key": _av(key), "UpdateExpression": expr}
        if names:
            op["ExpressionAttributeNames"] = names
        if values:
            op["ExpressionAttributeValues"] = _av(values)
        if cond:
            op["ConditionExpression"] = cond
        self.ops.append({"Update": op})
        self.fails.append(fail)

    def run(self) -> None:
        if len(self.ops) > 100:
            raise BadRequestError("too many changes in one transaction")
        try:
            dynamodb().meta.client.transact_write_items(TransactItems=self.ops)
        except ClientError as exc:
            if exc.response["Error"]["Code"] != "TransactionCanceledException":
                raise
            reasons = exc.response.get("CancellationReasons", [])
            failed = [self.fails[i] for i, r in enumerate(reasons) if r.get("Code") == "ConditionalCheckFailed" and i < len(self.fails)]
            raise BadRequestError(failed[0] if failed else "conflict, try again") from exc


class Deltas:
    """같은 항목에 대한 숫자 변경을 모아 한 번에 쓴다 (거래처 잔액, 계좌 잔액, 품목 재고)"""

    def __init__(self) -> None:
        self.data: dict[tuple[str, str], dict[str, float]] = {}
        self.floor: dict[tuple[str, str], dict[str, float]] = {}  # 결과가 0 아래로 가면 안 되는 필드 (재고)
        self.flags: dict[tuple[str, str], dict[str, Any]] = {}

    def add(self, sk: str, field: str, amount: float, cid: str, nonneg: bool = False) -> None:
        k = (pk(cid), sk)
        self.data.setdefault(k, {})
        self.data[k][field] = self.data[k].get(field, 0) + amount
        if nonneg:
            self.floor.setdefault(k, {})[field] = 0

    def set(self, sk: str, cid: str, **attrs: Any) -> None:
        k = (pk(cid), sk)
        self.data.setdefault(k, {})
        self.flags.setdefault(k, {}).update(attrs)

    def emit(self, tx: Tx, fails: dict[str, str]) -> None:
        for (p, s), fields in self.data.items():
            names: dict[str, str] = {}
            values: dict[str, Any] = {}
            adds = []
            conds = ["attribute_exists(PK)"]
            for i, (f, amt) in enumerate(fields.items()):
                if amt == 0:
                    continue
                names[f"#f{i}"] = f
                values[f":v{i}"] = amt
                adds.append(f"#f{i} :v{i}")
                if f in self.floor.get((p, s), {}) and amt < 0:
                    values[f":m{i}"] = -amt
                    conds.append(f"#f{i} >= :m{i}")
            sets = []
            for j, (f, v) in enumerate(self.flags.get((p, s), {}).items()):
                names[f"#s{j}"] = f
                values[f":s{j}"] = v
                sets.append(f"#s{j} = :s{j}")
            parts = []
            if adds:
                parts.append("ADD " + ", ".join(adds))
            if sets:
                parts.append("SET " + ", ".join(sets))
            if not parts:
                continue
            tx.update({"PK": p, "SK": s}, " ".join(parts), names or None, values or None, " AND ".join(conds), fails.get(s, "not enough stock or record missing"))


# ── 읽기 도우미 ──────────────────────────────────────

def _strip(item: dict[str, Any]) -> dict[str, Any]:
    return to_plain({k: v for k, v in item.items() if k not in ("PK", "SK", "GSI1PK", "GSI1SK")})


def _get(cid: str, sk: str, what: str) -> dict[str, Any]:
    item = table().get_item(Key={"PK": pk(cid), "SK": sk}).get("Item")
    if item is None:
        raise NotFoundError(f"{what} not found")
    return to_plain(item)


def _txn_sk(day: str, tid: str) -> str:
    return f"TXN#{day}#{tid}"


def _partner_index(cid: str, pid: str) -> str:
    return f"COMPANY#{cid}#PARTNER#{pid}"


def _partner_txns(cid: str) -> Any:
    def q(pid: str) -> list[dict[str, Any]]:
        return [to_plain(i) for i in query_all(IndexName="GSI1", KeyConditionExpression=Key("GSI1PK").eq(_partner_index(cid, pid)))]

    return q


def _closed(cid: str, day: str) -> bool:
    return table().get_item(Key={"PK": pk(cid), "SK": f"CLOSE#{day[:7]}"}).get("Item") is not None


def _check_perms(ctx: CompanyCtx, t: str, has_money_lines: bool) -> None:
    area = "money" if t in {"receipt", "payment", "expense"} else "assets" if t == "service" else "txns"
    if not ctx.can(area, "edit"):
        raise ForbiddenError(f"no permission: {area}")
    if t == "adjust" and not ctx.can("items", "edit"):
        raise ForbiddenError("no permission: items")
    if t in {"rental_out", "rental_return"} and not ctx.can("assets", "edit"):
        raise ForbiddenError("no permission: assets")
    if (t in MONEY_TYPES or has_money_lines) and not ctx.show_amounts:
        raise ForbiddenError("this transaction needs amount permission")


def _view(ctx: CompanyCtx, t: dict[str, Any]) -> dict[str, Any]:
    out = _strip(t)
    if not ctx.show_amounts:
        out = redact(ctx, out, TXN_MONEY)
        out["lines"] = [redact(ctx, ln, LINE_MONEY) for ln in out.get("lines", [])]
    return out


def _open_charges(cid: str, pid: str, payable: bool) -> list[dict[str, Any]]:
    kinds = PAYABLE_TYPES if payable else CHARGE_TYPES
    items = [t for t in _partner_txns(cid)(pid) if t.get("type") in kinds and t.get("status") == "confirmed" and t.get("total", 0) > t.get("paid", 0)]
    return sorted(items, key=lambda t: (t["date"], t["createdAt"]))


def _open_credits(cid: str, pid: str, payable: bool) -> list[dict[str, Any]]:
    """배분되지 않은 입금(선수) / 지급(선급)"""
    kind = "payment" if payable else "receipt"
    items = [t for t in _partner_txns(cid)(pid) if t.get("type") == kind and t.get("status") == "confirmed" and t.get("unallocated", 0) > 0]
    return sorted(items, key=lambda t: (t["date"], t["createdAt"]))


# ── 거래 만들기 ──────────────────────────────────────

def _new_txn(cid: str, t: str, day: str, sub: str, partner: dict[str, Any] | None, **fields: Any) -> dict[str, Any]:
    tid = uuid4().hex[:10]
    year = day[:4]
    no = f"T-{year}-{next_seq(cid, f'txn#{year}'):05d}"
    item: dict[str, Any] = {
        "PK": pk(cid),
        "SK": _txn_sk(day, tid),
        "id": tid,
        "no": no,
        "type": t,
        "date": day,
        "status": "confirmed",
        "createdBy": sub,
        "createdAt": now_iso(),
        "ver": 1,
        **fields,
    }
    if partner:
        item |= {"partnerId": partner["id"], "partnerName": partner["name"], "GSI1PK": _partner_index(cid, partner["id"]), "GSI1SK": f"{day}#{tid}"}
    return item


@dataclass
class Build:
    """거래 하나가 쓸 것 모음. 계약·A/S처럼 다른 화면이 같은 트랜잭션에 자기 변경을 더한 뒤 finish_txn으로 쓴다"""

    ctx: CompanyCtx
    cid: str
    txn: dict[str, Any]
    tx: Tx
    deltas: Deltas
    fails: dict[str, str]
    partner: dict[str, Any] | None
    receipts: list[dict[str, Any]] = field(default_factory=list)  # 바로 결제로 같이 만드는 입금·지급
    created_assets: list[dict[str, Any]] = field(default_factory=list)
    low_stock: list[str] = field(default_factory=list)  # 이 거래로 최소 재고 아래로 떨어지는 품목 (알림)


def build_txn(ctx: CompanyCtx, cid: str, body: TxnCreate, extra: dict[str, Any] | None = None, asset_set: dict[str, dict[str, Any]] | None = None) -> Build:
    """거래를 계산해 쓸 것을 모은다 (아직 쓰지 않음).
    extra: 거래 기록에 더할 필드 (contractId 등), asset_set: 임대 출고·수거 때 기기에 같이 쓸 필드 (계약, 검침값)"""
    t = body.type
    lines = [price_line(ln) for ln in body.lines] if t != "adjust" else [{"itemId": ln.itemId, "name": ln.name, "qty": ln.qty, "memo": ln.memo} for ln in body.lines]
    has_money = t not in {"adjust"} and any(ln.get("total") for ln in lines)
    _check_perms(ctx, t, has_money)
    day = body.date.isoformat()
    if _closed(cid, day):
        raise BadRequestError(f"{day[:7]} is closed")

    partner = _get(cid, f"PARTNER#{body.partnerId}", "partner") if body.partnerId else None
    account = _get(cid, f"ACCOUNT#{body.accountId}", "account") if body.accountId else None
    if partner and not partner.get("active", True):
        raise BadRequestError("partner is not active")

    tx = Tx()
    deltas = Deltas()
    fails: dict[str, str] = {}
    created_assets: list[dict[str, Any]] = []
    items_cache: dict[str, dict[str, Any]] = {}
    low_stock: list[str] = []

    def item_of(iid: str) -> dict[str, Any]:
        if iid not in items_cache:
            items_cache[iid] = _get(cid, f"ITEM#{iid}", "item")
        return items_cache[iid]

    # 줄의 품목 이름 채우기 + 재고 효과
    for ln in lines:
        if ln.get("itemId"):
            it = item_of(ln["itemId"])
            ln["name"] = ln["name"] or it["name"]
            ln["unit"] = it.get("unit", "")
            deltas.set(f"ITEM#{it['id']}", cid, used=True)
            if it["tracking"] == "stock":
                sign = STOCK_SIGN.get(t, 0)
                if sign:
                    deltas.add(f"ITEM#{it['id']}", "qty", sign * ln["qty"], cid, nonneg=True)
                    fails[f"ITEM#{it['id']}"] = f"재고가 부족합니다: {it['name']}"
                    before, low = float(it.get("qty", 0)), float(it.get("minStock") or 0)
                    if sign < 0 and low and before >= low > before - ln["qty"] and it["name"] not in low_stock:
                        low_stock.append(it["name"])
            elif t == "purchase":
                # 기기 모델 매입: 대수만큼 기기 자동 등록
                if ln["qty"] != int(ln["qty"]) or ln["qty"] > 50:
                    raise BadRequestError("asset purchase qty must be a whole number up to 50")
                ln["assetIds"] = []
                n = int(ln["qty"])
                last = next_seq(cid, "asset", n)
                prefix = asset_prefix(cid)
                for k in range(last - n + 1, last + 1):
                    aid = uuid4().hex[:10]
                    asset = {"PK": pk(cid), "SK": f"ASSET#{aid}", "id": aid, "code": f"{prefix}-{k:06d}", "itemId": it["id"], "serial": "", "status": "in_stock", "location": "", "memo": "", "acquiredAt": day, "cost": round(ln["supply"] / n) if n else 0, "createdAt": now_iso(), "updatedAt": now_iso()}
                    created_assets.append(asset)
                    ln["assetIds"].append(aid)
            elif t in {"sale", "adjust", "service"}:
                raise BadRequestError("asset-tracked items are rented, not sold or adjusted here")
        elif not ln["name"]:
            raise BadRequestError("line needs itemId or name")

    supply = sum(ln.get("supply", 0) for ln in lines)
    vat = sum(ln.get("vat", 0) for ln in lines)
    total = sum(ln.get("total", 0) for ln in lines)

    txn = _new_txn(cid, t, day, ctx.sub, partner, lines=lines, supply=supply, vat=vat, total=total, memo=body.memo, **(extra or {}))
    b = Build(ctx, cid, txn, tx, deltas, fails, partner, created_assets=created_assets, low_stock=low_stock)

    # 기기 효과
    if t in {"rental_out", "rental_return"}:
        assets = [_get(cid, f"ASSET#{a}", "asset") for a in body.assetIds]
        txn["assetIds"] = body.assetIds
        txn["assetCodes"] = [a["code"] for a in assets]
        txn["assetNames"] = [item_of(a["itemId"])["name"] for a in assets]
        for a in assets:
            key = {"PK": pk(cid), "SK": f"ASSET#{a['id']}"}
            more = (asset_set or {}).get(a["id"], {})
            names = {"#st": "status"} | {f"#x{i}": k for i, k in enumerate(more)}
            vals = {f":x{i}": v for i, v in enumerate(more.values())}
            sets = "".join(f", #x{i} = :x{i}" for i in range(len(more)))
            if t == "rental_out":
                tx.update(key, f"SET #st = :r, partnerId = :p, updatedAt = :now{sets}", names, {":r": "rented", ":p": partner["id"], ":now": now_iso(), ":s": "in_stock", **vals}, "#st = :s", f"창고에 있는 기기가 아닙니다: {a['code']}")  # type: ignore[index]
                tx.put(asset_log(cid, a["id"], ctx.sub, "rental_out", partnerId=partner["id"], partnerName=partner["name"], txnNo=txn["no"], contractNo=txn.get("contractNo", "")))  # type: ignore[index]
            else:
                names["#loc"] = "location"
                tx.update(key, f"SET #st = :s, #loc = :loc, updatedAt = :now{sets} REMOVE partnerId, contractId", names, {":s": "in_stock", ":loc": body.returnLocation, ":now": now_iso(), ":r": "rented", ":p": partner["id"], **vals}, "#st = :r AND partnerId = :p", f"이 거래처에 임대 중인 기기가 아닙니다: {a['code']}")  # type: ignore[index]
                tx.put(asset_log(cid, a["id"], ctx.sub, "rental_return", partnerId=partner["id"], partnerName=partner["name"], txnNo=txn["no"], contractNo=txn.get("contractNo", "")))  # type: ignore[index]

    # 청구성 거래: 미수 + 선수 자동 상계 (+ 바로 결제)
    if t in CHARGE_TYPES | PAYABLE_TYPES and total != 0:
        if total < 0:
            raise BadRequestError("total must be positive")
        payable = t in PAYABLE_TYPES
        bal, credit = ("payable", "prepaid") if payable else ("receivable", "advance")
        psk = f"PARTNER#{partner['id']}"  # type: ignore[index]
        deltas.add(psk, bal, total, cid)
        deltas.set(psk, cid, used=True)
        txn |= {"paid": 0, "paidBy": []}
        remaining = total
        if partner.get(credit, 0) > 0:  # type: ignore[union-attr]
            for c in _open_credits(cid, partner["id"], payable):  # type: ignore[index]
                if remaining == 0:
                    break
                x = min(remaining, int(c["unallocated"]))
                entry = {"txnId": txn["id"], "date": day, "amount": x, "no": txn["no"]}
                tx.update(
                    {"PK": pk(cid), "SK": _txn_sk(c["date"], c["id"])},
                    "SET unallocated = unallocated - :x, allocated = allocated + :x, allocations = list_append(allocations, :e), ver = ver + :one",
                    values={":x": x, ":e": [entry], ":one": 1},
                    cond="unallocated >= :x",
                    fail="선수(선급)금이 바뀌었습니다. 다시 시도하세요",
                )
                txn["paid"] += x
                txn["paidBy"].append({"txnId": c["id"], "date": c["date"], "amount": x, "no": c["no"]})
                deltas.add(psk, bal, -x, cid)
                deltas.add(psk, credit, -x, cid)
                remaining -= x
        if body.payNow and remaining > 0:
            acc = _get(cid, f"ACCOUNT#{body.payNow.accountId}", "account")
            kind = "payment" if payable else "receipt"
            r = _new_txn(cid, kind, day, ctx.sub, partner, accountId=acc["id"], accountName=acc["name"], amount=remaining, allocated=remaining, unallocated=0, allocations=[{"txnId": txn["id"], "date": day, "amount": remaining, "no": txn["no"]}], memo=f"{txn['no']} 바로 결제", lines=[])
            txn["paid"] += remaining
            txn["paidBy"].append({"txnId": r["id"], "date": day, "amount": remaining, "no": r["no"]})
            deltas.add(psk, bal, -remaining, cid)
            deltas.add(f"ACCOUNT#{acc['id']}", "balance", -remaining if payable else remaining, cid)
            b.receipts.append(r)

    # 입금·지급: 청구에 배분, 남으면 선수(선급)
    if t in {"receipt", "payment"}:
        payable = t == "payment"
        bal, credit = ("payable", "prepaid") if payable else ("receivable", "advance")
        psk = f"PARTNER#{partner['id']}"  # type: ignore[index]
        amount = int(body.amount)  # type: ignore[arg-type]
        opens = {c["id"]: c for c in _open_charges(cid, partner["id"], payable)}  # type: ignore[index]
        if body.allocations is not None:
            plan = []
            for al in body.allocations:
                c = opens.get(al.txnId)
                if c is None:
                    raise BadRequestError("allocation target is not an open charge of this partner")
                if al.amount > c["total"] - c["paid"]:
                    raise BadRequestError(f"allocation exceeds the open amount of {c['no']}")
                plan.append((c, al.amount))
        else:
            plan, left = [], amount
            for c in opens.values():
                if left == 0:
                    break
                x = min(left, int(c["total"] - c["paid"]))
                plan.append((c, x))
                left -= x
        allocated = sum(x for _, x in plan)
        if allocated > amount:
            raise BadRequestError("allocations exceed amount")
        allocs = []
        for c, x in plan:
            tx.update(
                {"PK": pk(cid), "SK": _txn_sk(c["date"], c["id"])},
                "SET paid = paid + :x, paidBy = list_append(paidBy, :e), ver = ver + :one",
                values={":x": x, ":e": [{"txnId": txn["id"], "date": day, "amount": x, "no": txn["no"]}], ":one": 1, ":max": int(c["total"]) - x, ":ok": "confirmed"},
                cond="paid <= :max AND #st = :ok",
                names={"#st": "status"},
                fail=f"청구 {c['no']}의 남은 금액이 바뀌었습니다. 다시 시도하세요",
            )
            allocs.append({"txnId": c["id"], "date": c["date"], "amount": x, "no": c["no"]})
        txn |= {"accountId": account["id"], "accountName": account["name"], "amount": amount, "allocated": allocated, "unallocated": amount - allocated, "allocations": allocs}  # type: ignore[index]
        deltas.add(psk, bal, -allocated, cid)
        deltas.add(psk, credit, amount - allocated, cid)
        deltas.set(psk, cid, used=True)
        deltas.add(f"ACCOUNT#{account['id']}", "balance", -amount if payable else amount, cid)  # type: ignore[index]

    if t == "expense":
        amount = int(body.amount)  # type: ignore[arg-type]
        txn |= {"accountId": account["id"], "accountName": account["name"], "amount": amount, "category": body.category}  # type: ignore[index]
        deltas.add(f"ACCOUNT#{account['id']}", "balance", -amount, cid)  # type: ignore[index]
        if partner:
            deltas.set(f"PARTNER#{partner['id']}", cid, used=True)

    # 완료된 A/S를 나중에 청구
    if body.serviceId:
        svc = _get(cid, f"SERVICE#{body.serviceId}", "service")
        if svc["partnerId"] != partner["id"]:  # type: ignore[index]
            raise BadRequestError("service belongs to another partner")
        txn |= {"serviceId": svc["id"], "serviceNo": svc["no"]}
        tx.update({"PK": pk(cid), "SK": f"SERVICE#{svc['id']}"}, "SET chargeTxn = :c, needsBilling = :f", {"#st": "status"}, {":c": {"id": txn["id"], "date": day, "no": txn["no"]}, ":f": False, ":d": "done"}, "#st = :d AND attribute_not_exists(chargeTxn)", "이미 청구했거나 완료되지 않은 A/S입니다")
    return b


def finish_txn(b: Build) -> dict[str, Any]:
    """모은 변경 쓰기: 새 기기 → 거래 → 바로 결제 → 합친 잔액·재고 → 활동 기록"""
    cid, ctx, txn = b.cid, b.ctx, b.txn
    for a in b.created_assets:
        b.tx.put(a)
        b.tx.put(asset_log(cid, a["id"], ctx.sub, "registered", note=f"매입 {txn['no']}"))
    b.tx.put(txn, "attribute_not_exists(PK)")
    for r in b.receipts:
        b.tx.put(r, "attribute_not_exists(PK)")
    b.deltas.emit(b.tx, b.fails)
    b.tx.put(company_audit(cid, ctx.sub, "txn_create", txn["no"], {"type": TYPE_LABEL[txn["type"]], "partner": (b.partner or {}).get("name", ""), "total": txn.get("total") or txn.get("amount", 0)}))
    b.tx.run()
    base = f"/company/{cid}"
    if txn["type"] == "receipt":
        notify(cid, "receipt_new", f"입금 {int(txn['amount']):,}원", f"{txn.get('partnerName', '')} · {txn.get('accountName', '')}", f"{base}/txns/{txn['date']}/{txn['id']}", exclude=ctx.sub)
    if b.low_stock:
        notify(cid, "stock_low", f"재고 부족: {b.low_stock[0]}{f' 외 {len(b.low_stock) - 1}개' if len(b.low_stock) > 1 else ''}", f"{txn['no']} 이후 최소 재고보다 적습니다", f"{base}/items")
    return {"txn": _view(ctx, txn), "related": [_view(ctx, r) for r in b.receipts], "createdAssets": [_strip(a) for a in b.created_assets]}


@router.post("/company/<cid>/txns")
def create_txn(cid: str) -> dict[str, Any]:
    body = parse_body(router, TxnCreate)
    ctx = company_ctx(router, cid)
    if body.type in INTERNAL_TYPES:
        raise BadRequestError("A/S transactions are made by completing an A/S")
    if body.type == "rental_return":
        # 계약에 묶인 기기는 계약 화면에서 수거 (계약 기기 목록·정산이 같이 바뀌어야 함)
        for aid in body.assetIds:
            if _get(cid, f"ASSET#{aid}", "asset").get("contractId"):
                raise BadRequestError("this asset is on a contract; return it from the contract")
    return finish_txn(build_txn(ctx, cid, body))


# ── 취소 ─────────────────────────────────────────────

def _cancel_contract(cid: str, txn: dict[str, Any], tx: Tx) -> None:
    """계약에 걸린 거래 취소: 정기 청구면 청구한 달·카운터 되돌리기, 출고·추가·수거면 계약 기기 목록 되돌리기"""
    key = {"PK": pk(cid), "SK": f"CONTRACT#{txn['contractId']}"}
    if txn.get("billMonth"):
        names: dict[str, str] = {}
        vals: dict[str, Any] = {":m": txn["billMonth"], ":prev": txn.get("billPrev", ""), ":one": 1}
        sets = ["billedThrough = :prev"]
        for i, c in enumerate(txn.get("billCounters", [])):
            names[f"#a{i}"] = c["assetId"]
            vals |= {f":bm{i}": c["fromMono"], f":bc{i}": c["fromColor"], f":br{i}": c.get("fromReadAt", "")}
            sets += [f"machines.#a{i}.billedMono = :bm{i}", f"machines.#a{i}.billedColor = :bc{i}", f"machines.#a{i}.billedReadAt = :br{i}"]
        tx.update(key, "SET " + ", ".join(sets) + ", ver = ver + :one", names or None, vals, "billedThrough = :m", "이후 달 청구를 먼저 취소하세요")
        return
    op = txn.get("contractOp")
    names = {f"#a{i}": a for i, a in enumerate(txn.get("assetIds", []))}
    if op == "create":
        tx.update(key, "SET #st = :c, ver = ver + :one", {"#st": "status"}, {":c": "canceled", ":one": 1, ":e": ""}, "billedThrough = :e AND ver = :one", "계약에 그 뒤 변경(청구·기기 추가·수거·요금 수정)이 있어 출고를 취소할 수 없습니다")
    elif op == "add":
        rm = ", ".join(f"machines.#a{i}" for i in range(len(names)))
        tx.update(key, f"SET ver = ver + :one REMOVE {rm}", names, {":one": 1, ":sm": txn["date"][:7]}, "billedThrough < :sm", "이 기기가 들어간 달을 이미 청구했습니다. 청구부터 취소하세요")
    elif op == "return":
        rm = ", ".join(f"machines.#a{i}.endedAt, machines.#a{i}.endMono, machines.#a{i}.endColor" for i in range(len(names)))
        tx.update(key, f"SET #st = :act, ver = ver + :one REMOVE endedAt, {rm}", names | {"#st": "status"}, {":act": "active", ":one": 1, ":rm": txn["date"][:7]}, "billedThrough < :rm", "수거한 달을 이미 정산 청구했습니다. 청구부터 취소하세요")


@router.post("/company/<cid>/txns/<day>/<tid>/cancel")
def cancel_txn(cid: str, day: str, tid: str) -> dict[str, Any]:
    reason = parse_body(router, CancelBody).reason
    ctx = company_ctx(router, cid)
    txn = _get(cid, _txn_sk(day, tid), "transaction")
    t = txn["type"]
    _check_perms(ctx, t, bool(txn.get("total")))
    if txn["status"] != "confirmed":
        raise BadRequestError("already canceled")
    if _closed(cid, txn["date"]):
        raise BadRequestError(f"{txn['date'][:7]} is closed")

    tx = Tx()
    deltas = Deltas()
    fails: dict[str, str] = {}
    pid = txn.get("partnerId")
    psk = f"PARTNER#{pid}" if pid else ""

    for ln in txn.get("lines", []):
        if not ln.get("itemId"):
            continue
        sign = -STOCK_SIGN.get(t, 0)
        it = table().get_item(Key={"PK": pk(cid), "SK": f"ITEM#{ln['itemId']}"}).get("Item")
        if it and it["tracking"] == "stock" and sign:
            deltas.add(f"ITEM#{ln['itemId']}", "qty", sign * ln["qty"], cid, nonneg=True)
            fails[f"ITEM#{ln['itemId']}"] = f"재고가 부족해 되돌릴 수 없습니다: {ln['name']}"
        for aid in ln.get("assetIds", []):
            # 매입으로 생긴 기기: 아직 창고에 있고 다른 이력이 없어야 지울 수 있다
            logs = query_all(KeyConditionExpression=Key("PK").eq(pk(cid)) & Key("SK").begins_with(f"ASSET#{aid}#LOG#"))
            if any(x["action"] != "registered" for x in logs):
                raise BadRequestError("assets from this purchase have history; cannot cancel")
            tx.update({"PK": pk(cid), "SK": f"ASSET#{aid}"}, "SET #st = :ret, memo = :m", {"#st": "status"}, {":ret": "retired", ":m": f"매입 취소 {txn['no']}", ":s": "in_stock"}, "#st = :s", "매입한 기기가 이미 쓰이고 있습니다")

    if t in {"rental_out", "rental_return"}:
        for aid in txn.get("assetIds", []):
            key = {"PK": pk(cid), "SK": f"ASSET#{aid}"}
            if t == "rental_out":
                tx.update(key, "SET #st = :s, updatedAt = :now REMOVE partnerId, contractId", {"#st": "status"}, {":s": "in_stock", ":r": "rented", ":p": pid, ":now": now_iso()}, "#st = :r AND partnerId = :p", "기기가 이미 다른 상태입니다 (수거 등)")
            else:
                back = ", contractId = :k" if txn.get("contractId") else ""
                more = {":k": txn["contractId"]} if back else {}
                tx.update(key, f"SET #st = :r, partnerId = :p, updatedAt = :now{back}", {"#st": "status"}, {":s": "in_stock", ":r": "rented", ":p": pid, ":now": now_iso(), **more}, "#st = :s", "기기가 이미 다른 곳에 나갔습니다")
            tx.put(asset_log(cid, aid, ctx.sub, "cancel", txnNo=txn["no"], note=f"{TYPE_LABEL[t]} 취소"))

    if t in CHARGE_TYPES | PAYABLE_TYPES and txn.get("total"):
        payable = t in PAYABLE_TYPES
        bal, credit = ("payable", "prepaid") if payable else ("receivable", "advance")
        paid = int(txn.get("paid", 0))
        deltas.add(psk, bal, -(int(txn["total"]) - paid), cid)
        deltas.add(psk, credit, paid, cid)  # 이미 갚은 돈은 선수(선급)로 돌아간다
        for p in txn.get("paidBy", []):
            r = _get(cid, _txn_sk(p["date"], p["txnId"]), "receipt")
            r["allocations"] = [a for a in r.get("allocations", []) if a["txnId"] != tid]
            r["allocated"] = int(r["allocated"]) - int(p["amount"])
            r["unallocated"] = int(r["unallocated"]) + int(p["amount"])
            ver = r["ver"]
            r["ver"] = ver + 1
            tx.put({"PK": pk(cid), "SK": _txn_sk(r["date"], r["id"]), **r}, "ver = :v", values={":v": ver}, fail="입금 기록이 바뀌었습니다. 다시 시도하세요")

    if t in {"receipt", "payment"}:
        payable = t == "payment"
        bal, credit = ("payable", "prepaid") if payable else ("receivable", "advance")
        for a in txn.get("allocations", []):
            c = _get(cid, _txn_sk(a["date"], a["txnId"]), "charge")
            c["paidBy"] = [p for p in c.get("paidBy", []) if p["txnId"] != tid]
            c["paid"] = int(c["paid"]) - int(a["amount"])
            ver = c["ver"]
            c["ver"] = ver + 1
            tx.put({"PK": pk(cid), "SK": _txn_sk(c["date"], c["id"]), **c}, "ver = :v", values={":v": ver}, fail="청구 기록이 바뀌었습니다. 다시 시도하세요")
        deltas.add(psk, bal, int(txn["allocated"]), cid)
        deltas.add(psk, credit, -int(txn["unallocated"]), cid)
        deltas.add(f"ACCOUNT#{txn['accountId']}", "balance", int(txn["amount"]) if payable else -int(txn["amount"]), cid)

    if t == "expense":
        deltas.add(f"ACCOUNT#{txn['accountId']}", "balance", int(txn["amount"]), cid)

    if txn.get("serviceId"):
        skey = {"PK": pk(cid), "SK": f"SERVICE#{txn['serviceId']}"}
        if t == "service":  # A/S 완료 취소 → 다시 접수 상태
            tx.update(skey, "SET #st = :o, ver = ver + :one REMOVE done, txn", {"#st": "status"}, {":o": "open", ":one": 1, ":t": tid}, "txn.id = :t", "A/S 기록이 바뀌었습니다")
        else:  # A/S 청구 취소 → 다시 청구 필요
            tx.update(skey, "SET needsBilling = :y REMOVE chargeTxn", None, {":y": True, ":t": tid}, "chargeTxn.id = :t", "A/S 기록이 바뀌었습니다")
    if txn.get("contractId"):
        _cancel_contract(cid, txn, tx)
    # 이 거래로 발행한 문서(영수증·명세서·청구서·작업 확인서)에 취소 표시 → 다시 받으면 "취소됨" 판
    for ref in query_all(KeyConditionExpression=Key("PK").eq(pk(cid)) & Key("SK").begins_with(f"DOCSRC#{tid}#")):
        tx.update({"PK": pk(cid), "SK": f"DOC#{ref['docId']}"}, "SET canceled = :y", values={":y": True})

    ver = txn["ver"]
    done = {**txn, "status": "canceled", "canceledBy": ctx.sub, "canceledAt": now_iso(), "cancelReason": reason, "ver": ver + 1}
    if txn.get("partnerId"):
        done |= {"GSI1PK": _partner_index(cid, txn["partnerId"]), "GSI1SK": f"{txn['date']}#{tid}"}
    tx.put({"PK": pk(cid), "SK": _txn_sk(day, tid), **done}, "ver = :v AND #st = :c", names={"#st": "status"}, values={":v": ver, ":c": "confirmed"}, fail="거래가 이미 바뀌었습니다. 새로 고친 뒤 다시 시도하세요")
    deltas.emit(tx, fails)
    tx.put(company_audit(cid, ctx.sub, "txn_cancel", txn["no"], {"type": TYPE_LABEL[t], "reason": reason}))
    tx.run()
    return {"txn": _view(ctx, done)}


# ── 조회 ─────────────────────────────────────────────

def _range(default_days: int = 31) -> tuple[str, str]:
    q = router.current_event.get_query_string_value
    to = q("to") or (date.today()).isoformat()
    frm = q("from") or (date.fromisoformat(to) - timedelta(days=default_days)).isoformat()
    try:
        a, b = date.fromisoformat(frm), date.fromisoformat(to)
    except ValueError as exc:
        raise BadRequestError("from, to must be YYYY-MM-DD") from exc
    if b < a or (b - a).days > MAX_RANGE_DAYS:
        raise BadRequestError(f"range must be 0~{MAX_RANGE_DAYS} days")
    return frm, to


def _txns_between(cid: str, frm: str, to: str) -> list[dict[str, Any]]:
    return [to_plain(i) for i in query_all(KeyConditionExpression=Key("PK").eq(pk(cid)) & Key("SK").between(f"TXN#{frm}", f"TXN#{to}#￿"))]


@router.get("/company/<cid>/txns")
def list_txns(cid: str) -> dict[str, Any]:
    """?from&to (기본 최근 31일), ?type, ?partnerId (거래처는 전체 기간)"""
    ctx = company_ctx(router, cid, "txns")
    q = router.current_event.get_query_string_value
    pid = q("partnerId")
    if pid:
        items = _partner_txns(cid)(pid)
    else:
        frm, to = _range()
        items = _txns_between(cid, frm, to)
    if q("type"):
        items = [t for t in items if t["type"] == q("type")]
    items.sort(key=lambda t: (t["date"], t["createdAt"]), reverse=True)
    return {"txns": [_view(ctx, t) for t in items]}


@router.get("/company/<cid>/txns/<day>/<tid>")
def get_txn(cid: str, day: str, tid: str) -> dict[str, Any]:
    ctx = company_ctx(router, cid, "txns")
    return {"txn": _view(ctx, _get(cid, _txn_sk(day, tid), "transaction"))}


@router.get("/company/<cid>/open-charges")
def open_charges(cid: str) -> dict[str, Any]:
    """입금(지급) 화면: 거래처의 남은 청구(매입) 목록. ?partnerId&side=receivable|payable"""
    ctx = company_ctx(router, cid, "money")
    if not ctx.show_amounts:
        raise ForbiddenError("needs amount permission")
    q = router.current_event.get_query_string_value
    pid = q("partnerId")
    if not pid:
        raise BadRequestError("partnerId is required")
    items = _open_charges(cid, pid, q("side") == "payable")
    return {"charges": [{"id": c["id"], "no": c["no"], "date": c["date"], "type": c["type"], "total": c["total"], "paid": c["paid"], "open": c["total"] - c["paid"], "summary": _summary(c)} for c in items]}


def _summary(t: dict[str, Any]) -> str:
    names = [ln.get("name", "") for ln in t.get("lines", []) if ln.get("name")] or t.get("assetCodes", [])
    return (names[0] + (f" 외 {len(names) - 1}건" if len(names) > 1 else "")) if names else TYPE_LABEL.get(t["type"], "")


@router.get("/company/<cid>/receivables")
def receivables(cid: str) -> dict[str, Any]:
    """미수·선수·미지급·선급이 있는 거래처 (거래처 항목의 잔액 기준)"""
    ctx = company_ctx(router, cid, "money")
    if not ctx.show_amounts:
        raise ForbiddenError("needs amount permission")
    partners = [_strip(p) for p in query_all(KeyConditionExpression=Key("PK").eq(pk(cid)) & Key("SK").begins_with("PARTNER#"))]
    rows = [{k: p.get(k, 0) for k in ("receivable", "advance", "payable", "prepaid")} | {"id": p["id"], "name": p["name"], "kind": p["kind"]} for p in partners]
    rows = [r for r in rows if any(r[k] for k in ("receivable", "advance", "payable", "prepaid"))]
    return {"partners": sorted(rows, key=lambda r: -r["receivable"])}


@router.get("/company/<cid>/ledger")
def account_ledger(cid: str) -> dict[str, Any]:
    """회사 장부: 계좌 입출금 (입금·지급·경비). 잔액은 현재 잔액에서 거꾸로 계산. ?from&to&accountId"""
    ctx = company_ctx(router, cid, "money")
    if not ctx.show_amounts:
        raise ForbiddenError("needs amount permission")
    frm, to = _range()
    acc_filter = router.current_event.get_query_string_value("accountId")
    accounts = {a["id"]: to_plain(a) for a in query_all(KeyConditionExpression=Key("PK").eq(pk(cid)) & Key("SK").begins_with("ACCOUNT#"))}
    # 현재 잔액에서 오늘까지의 움직임을 빼며 거꾸로 (to 이후 거래 포함해서 읽는다)
    today = max(to, date.today().isoformat())
    moves = [t for t in _txns_between(cid, frm, today) if t["type"] in {"receipt", "payment", "expense"} and t["status"] == "confirmed" and (not acc_filter or t["accountId"] == acc_filter)]
    moves.sort(key=lambda t: (t["date"], t["createdAt"]), reverse=True)
    running = {aid: int(a.get("balance", 0)) for aid, a in accounts.items()}
    rows = []
    for t in moves:
        signed = int(t["amount"]) * (1 if t["type"] == "receipt" else -1)
        if t["date"] <= to:
            rows.append({"date": t["date"], "id": t["id"], "no": t["no"], "type": t["type"], "accountId": t["accountId"], "accountName": t.get("accountName", ""), "partnerName": t.get("partnerName", ""), "category": t.get("category", ""), "memo": t.get("memo", ""), "amount": signed, "balanceAfter": running.get(t["accountId"], 0)})
        running[t["accountId"]] = running.get(t["accountId"], 0) - signed
    return {"rows": rows, "accounts": [{"id": a["id"], "name": a["name"], "balance": a.get("balance", 0)} for a in accounts.values()]}


# ── 월 마감 ──────────────────────────────────────────

@router.get("/company/<cid>/closes")
def list_closes(cid: str) -> dict[str, Any]:
    company_ctx(router, cid, "money")
    return {"closes": [_strip(i) for i in query_all(KeyConditionExpression=Key("PK").eq(pk(cid)) & Key("SK").begins_with("CLOSE#"))]}


@router.post("/company/<cid>/closes")
def close_month(cid: str) -> dict[str, Any]:
    ctx = company_ctx(router, cid, admin=True)
    month = parse_body(router, CloseBody).month
    if month >= date.today().isoformat()[:7]:
        raise BadRequestError("only past months can be closed")
    item = {"PK": pk(cid), "SK": f"CLOSE#{month}", "month": month, "closedBy": ctx.sub, "closedAt": now_iso()}
    table().put_item(Item=item)
    table().put_item(Item=company_audit(cid, ctx.sub, "month_close", month))
    return _strip(item)


@router.delete("/company/<cid>/closes/<month>")
def reopen_month(cid: str, month: str) -> dict[str, Any]:
    ctx = company_ctx(router, cid, admin=True)
    table().delete_item(Key={"PK": pk(cid), "SK": f"CLOSE#{month}"})
    table().put_item(Item=company_audit(cid, ctx.sub, "month_reopen", month))
    return {"reopened": month}

