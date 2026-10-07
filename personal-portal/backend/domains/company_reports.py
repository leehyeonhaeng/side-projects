"""행컴퍼니 대시보드·보고서 (COMPANY.md 4장, C6).

대시보드: 이번 달·지난달 돈(매출·수금·매입·경비), 미수 상위(연체 금액 포함), 재고 부족, 계약 만료 임박, 기기 현황 — 권한 있는 것만
보고서: 기간(월 단위) 월별 합계·거래처별·품목별·경비 항목별·기기 가동률. CSV는 화면에서 만든다
매출 = 청구성 거래(판매·청구·임대 출고/수거·A/S)의 금액, 수금 = 입금. 취소된 거래는 빼고, 금액 보기 권한이 있어야 한다
"""

import calendar
from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from aws_lambda_powertools.event_handler.api_gateway import Router
from aws_lambda_powertools.event_handler.exceptions import BadRequestError, ForbiddenError
from boto3.dynamodb.conditions import Key

from common.aws import table
from common.serialize import to_plain
from domains.company_core import company_ctx, pk
from domains.company_rental import month_add
from domains.company_txn import CHARGE_TYPES, _open_charges, _txns_between
from domains.sharing import query_all

router = Router()
MAX_MONTHS = 24


def _items(cid: str, prefix: str) -> list[dict[str, Any]]:
    return [to_plain(i) for i in query_all(KeyConditionExpression=Key("PK").eq(pk(cid)) & Key("SK").begins_with(prefix))]


def _month_sums(txns: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    out: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for t in txns:
        if t.get("status") != "confirmed":
            continue
        m = out[t["date"][:7]]
        ty = t["type"]
        if ty in CHARGE_TYPES and t.get("total"):
            m["salesSupply"] += int(t.get("supply") or 0)
            m["salesVat"] += int(t.get("vat") or 0)
            m["salesTotal"] += int(t["total"])
        elif ty == "receipt":
            m["receipts"] += int(t["amount"])
        elif ty == "purchase":
            m["purchaseSupply"] += int(t.get("supply") or 0)
            m["purchaseTotal"] += int(t.get("total") or 0)
        elif ty == "payment":
            m["payments"] += int(t["amount"])
        elif ty == "expense":
            m["expenses"] += int(t["amount"])
    return out


@router.get("/company/<cid>/dashboard")
def dashboard(cid: str) -> dict[str, Any]:
    ctx = company_ctx(router, cid)
    today = date.today()
    this_m = today.isoformat()[:7]
    last_m = month_add(this_m, -1)
    meta = to_plain(table().get_item(Key={"PK": pk(cid), "SK": "META"})["Item"])
    out: dict[str, Any] = {"month": this_m}
    money = ctx.show_amounts and (ctx.can("money") or ctx.can("txns") or ctx.can("reports"))
    if money:
        sums = _month_sums(_txns_between(cid, f"{last_m}-01", today.isoformat()))
        keys = ("salesTotal", "receipts", "purchaseTotal", "expenses")
        out["money"] = {"this": {k: sums[this_m][k] for k in keys}, "last": {k: sums[last_m][k] for k in keys}}
    if ctx.show_amounts and ctx.can("money"):
        limit = (today - timedelta(days=int(meta.get("overdueDays") or 30))).isoformat()
        partners = sorted((p for p in _items(cid, "PARTNER#") if p.get("receivable", 0) > 0), key=lambda p: -p["receivable"])
        top = []
        for p in partners[:5]:
            overdue = sum(int(c["total"]) - int(c["paid"]) for c in _open_charges(cid, p["id"], False) if c["date"] <= limit)
            top.append({"id": p["id"], "name": p["name"], "receivable": p["receivable"], "overdue": overdue})
        out["receivables"] = {"top": top, "total": sum(p["receivable"] for p in partners), "partners": len(partners), "overdueDays": int(meta.get("overdueDays") or 30)}
    if ctx.can("items"):
        low = [i for i in _items(cid, "ITEM#") if i.get("tracking") == "stock" and i.get("active", True) and i.get("minStock") and float(i.get("qty", 0)) < float(i["minStock"])]
        out["lowStock"] = [{"id": i["id"], "name": i["name"], "qty": i.get("qty", 0), "minStock": i["minStock"], "unit": i.get("unit", "")} for i in sorted(low, key=lambda i: float(i.get("qty", 0)) - float(i["minStock"]))]
    if ctx.can("contracts"):
        soon = (today + timedelta(days=30)).isoformat()
        exp = [c for c in _items(cid, "CONTRACT#") if c["status"] == "active" and c.get("termEnd") and c["termEnd"] <= soon]
        out["expiring"] = [{"id": c["id"], "no": c["no"], "partnerName": c["partnerName"], "termEnd": c["termEnd"]} for c in sorted(exp, key=lambda c: c["termEnd"])]
    if ctx.can("assets"):
        counts: dict[str, int] = defaultdict(int)
        for a in _items(cid, "ASSET#"):
            if "#LOG#" not in a.get("SK", "") and "code" in a:
                counts[a["status"]] += 1
        out["assets"] = dict(counts)
    return out


@router.get("/company/<cid>/reports")
def reports(cid: str) -> dict[str, Any]:
    """?from=YYYY-MM&to=YYYY-MM (기본 최근 6개월, 최대 24개월)"""
    ctx = company_ctx(router, cid, "reports")
    if not ctx.show_amounts:
        raise ForbiddenError("needs amount permission")
    q = router.current_event.get_query_string_value
    to_m = q("to") or date.today().isoformat()[:7]
    from_m = q("from") or month_add(to_m, -5)
    if not (len(from_m) == 7 and len(to_m) == 7 and from_m <= to_m):
        raise BadRequestError("from, to must be YYYY-MM and from <= to")
    months = []
    m = from_m
    while m <= to_m:
        months.append(m)
        m = month_add(m, 1)
        if len(months) > MAX_MONTHS:
            raise BadRequestError(f"up to {MAX_MONTHS} months")
    last_day = f"{to_m}-{calendar.monthrange(int(to_m[:4]), int(to_m[5:]))[1]:02d}"
    txns = [t for t in _txns_between(cid, f"{from_m}-01", last_day) if t.get("status") == "confirmed"]

    sums = _month_sums(txns)
    keys = ("salesSupply", "salesVat", "salesTotal", "receipts", "purchaseSupply", "purchaseTotal", "payments", "expenses")
    monthly = [{"month": m, **{k: sums[m][k] for k in keys}} for m in months]

    partners: dict[str, dict[str, Any]] = {}
    for t in txns:
        if not t.get("partnerId"):
            continue
        p = partners.setdefault(t["partnerId"], {"id": t["partnerId"], "name": t.get("partnerName", ""), "salesTotal": 0, "receipts": 0, "purchaseTotal": 0, "payments": 0})
        if t["type"] in CHARGE_TYPES:
            p["salesTotal"] += int(t.get("total") or 0)
        elif t["type"] == "receipt":
            p["receipts"] += int(t["amount"])
        elif t["type"] == "purchase":
            p["purchaseTotal"] += int(t.get("total") or 0)
        elif t["type"] == "payment":
            p["payments"] += int(t["amount"])
    balances = {p["id"]: p for p in _items(cid, "PARTNER#")}
    for pid, p in partners.items():
        p["receivable"] = balances.get(pid, {}).get("receivable", 0)
        p["payable"] = balances.get(pid, {}).get("payable", 0)

    item_rows: dict[str, dict[str, Any]] = {}
    names = {i["id"]: i for i in _items(cid, "ITEM#")}
    for t in txns:
        kind = {"sale": "sale", "purchase": "purchase", "service": "used", "charge": "sale"}.get(t["type"])
        if not kind:
            continue
        for ln in t.get("lines", []):
            iid = ln.get("itemId")
            if not iid:
                continue
            it = item_rows.setdefault(iid, {"id": iid, "name": names.get(iid, {}).get("name", ln.get("name", "")), "unit": names.get(iid, {}).get("unit", ""), "saleQty": 0, "saleSupply": 0, "usedQty": 0, "purchaseQty": 0, "purchaseSupply": 0})
            if kind == "sale":
                it["saleQty"] += float(ln.get("qty") or 0)
                it["saleSupply"] += int(ln.get("supply") or 0)
            elif kind == "purchase":
                it["purchaseQty"] += float(ln.get("qty") or 0)
                it["purchaseSupply"] += int(ln.get("supply") or 0)
            else:
                it["usedQty"] += float(ln.get("qty") or 0)

    expenses: dict[str, int] = defaultdict(int)
    for t in txns:
        if t["type"] == "expense":
            expenses[t.get("category") or "기타"] += int(t["amount"])

    models: dict[str, dict[str, Any]] = {}
    for a in _items(cid, "ASSET#"):
        if "#LOG#" in a.get("SK", "") or "code" not in a or a["status"] == "retired":
            continue
        row = models.setdefault(a["itemId"], {"id": a["itemId"], "name": names.get(a["itemId"], {}).get("name", ""), "total": 0, "rented": 0, "in_stock": 0, "repair": 0})
        row["total"] += 1
        row[a["status"]] = row.get(a["status"], 0) + 1

    return {
        "from": from_m,
        "to": to_m,
        "monthly": monthly,
        "partners": sorted(partners.values(), key=lambda p: -(p["salesTotal"] + p["purchaseTotal"])),
        "items": sorted(item_rows.values(), key=lambda i: -(i["saleSupply"] + i["purchaseSupply"])),
        "expenses": sorted(({"category": k, "amount": v} for k, v in expenses.items()), key=lambda e: -e["amount"]),
        "assets": sorted(models.values(), key=lambda r: -r["total"]),
    }
