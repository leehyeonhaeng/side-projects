"""C3 거래 엔진: 거래 하나가 재고·기기·잔액·계좌·배분을 한 번에 바꾸고, 취소하면 모두 되돌아가는지"""

import json
from typing import Any

import pytest

from common import users
from common.perms import Role, Status
from handlers import company
from tests.conftest import FakeContext, http_event

DAY = "2026-10-05"


def call(ctx: FakeContext, sub: str, method: str, path: str, body: dict[str, Any] | None = None, query: dict[str, str] | None = None) -> tuple[int, Any]:
    raw = json.dumps(body) if body is not None else None
    res = company.lambda_handler(http_event(method, f"/api/v1{path}", sub=sub, groups="[host]" if sub == "h1" else "", body=raw, query=query), ctx)
    return res["statusCode"], json.loads(res["body"])


class World:
    def __init__(self, ctx: FakeContext) -> None:
        self.ctx = ctx
        users.create_profile("h1", "h@x.com", "호스트", "", Status.ACTIVE, Role.HOST)
        users.create_profile("f1", "f@x.com", "기사", "", Status.ACTIVE, Role.MEMBER)
        self.cid = self.ok("POST", "/company", {"name": "행컴퍼니"})["id"]
        code = self.ok("POST", f"/company/{self.cid}/invites", {"roleId": "field"})["code"]
        call(ctx, "f1", "POST", f"/company/invites/{code}/accept")
        c = f"/company/{self.cid}"
        self.base = c
        self.school = self.ok("POST", f"{c}/partners", {"name": "학교"})["id"]
        self.vendor = self.ok("POST", f"{c}/partners", {"name": "도매상", "kind": "supplier"})["id"]
        self.model = self.ok("POST", f"{c}/items", {"name": "복합기", "tracking": "asset", "rentPrice": 100000})["id"]
        self.toner = self.ok("POST", f"{c}/items", {"name": "토너", "tracking": "stock", "openingQty": 10, "price": 50000})["id"]
        self.assets = [a["id"] for a in self.ok("POST", f"{c}/assets", {"itemId": self.model, "count": 2})["assets"]]
        self.bank = self.ok("POST", f"{c}/accounts", {"name": "통장", "openingBalance": 1_000_000})["id"]

    def ok(self, method: str, path: str, body: dict[str, Any] | None = None, sub: str = "h1", query: dict[str, str] | None = None) -> Any:
        status, res = call(self.ctx, sub, method, path, body, query)
        assert status == 200, res
        return res

    def txn(self, body: dict[str, Any], sub: str = "h1") -> tuple[int, Any]:
        return call(self.ctx, sub, "POST", f"{self.base}/txns", {"date": DAY, **body})

    def partner(self, pid: str) -> dict[str, Any]:
        return self.ok("GET", f"{self.base}/partners/{pid}")["partner"]

    def item(self, iid: str) -> dict[str, Any]:
        return {i["id"]: i for i in self.ok("GET", f"{self.base}/items")["items"]}[iid]

    def account(self) -> int:
        return self.ok("GET", f"{self.base}/accounts")["accounts"][0]["balance"]

    def asset(self, aid: str) -> dict[str, Any]:
        return self.ok("GET", f"{self.base}/assets/{aid}")["asset"]


@pytest.fixture
def w(aws: Any, ctx: FakeContext) -> World:
    return World(ctx)


def test_vat_modes_and_manual_override(w: World) -> None:
    lines = [
        {"name": "포함", "unitPrice": 11000, "vatMode": "included"},
        {"name": "별도", "unitPrice": 10000, "vatMode": "excluded"},
        {"name": "면세", "qty": 2, "unitPrice": 5000, "vatMode": "exempt"},
        {"name": "직접", "unitPrice": 999, "supply": 1000, "vat": 50},
    ]
    t = w.ok("POST", f"{w.base}/txns", {"type": "charge", "date": DAY, "partnerId": w.school, "lines": lines})["txn"]
    got = [(ln["supply"], ln["vat"], ln["total"], ln["manual"]) for ln in t["lines"]]
    assert got == [(10000, 1000, 11000, False), (10000, 1000, 11000, False), (10000, 0, 10000, False), (1000, 50, 1050, True)]
    assert (t["supply"], t["vat"], t["total"], t["no"]) == (31000, 2050, 33050, "T-2026-00001")
    assert w.txn({"type": "charge", "partnerId": w.school, "lines": [{"name": "x", "supply": 100, "vat": 10, "total": 999}]})[0] == 400
    assert w.partner(w.school)["receivable"] == 33050


def test_rental_out_receipt_allocation_and_cancel(w: World) -> None:
    # 임대 출고 + 설치비 청구 → 기기 임대 중, 미수 증가
    out = w.ok("POST", f"{w.base}/txns", {"type": "rental_out", "date": DAY, "partnerId": w.school, "assetIds": w.assets, "lines": [{"name": "설치비", "unitPrice": 50000, "vatMode": "excluded"}]})["txn"]
    assert (w.asset(w.assets[0])["status"], w.asset(w.assets[0])["partnerId"]) == ("rented", w.school)
    assert w.partner(w.school)["receivable"] == 55000
    # 같은 기기 또 출고 → 거절, 아무것도 안 바뀜
    status, err = w.txn({"type": "rental_out", "partnerId": w.vendor, "assetIds": [w.assets[0]]})
    assert status == 400 and "창고" in err["message"]
    assert w.partner(w.school)["receivable"] == 55000
    # 거래처 상세에 나가 있는 기기
    assert len(w.ok("GET", f"{w.base}/partners/{w.school}")["assets"]) == 2
    # 7만원 입금 → 5.5만 배분, 1.5만 선수
    r = w.ok("POST", f"{w.base}/txns", {"type": "receipt", "date": DAY, "partnerId": w.school, "accountId": w.bank, "amount": 70000})["txn"]
    assert (r["allocated"], r["unallocated"]) == (55000, 15000)
    p = w.partner(w.school)
    assert (p["receivable"], p["advance"]) == (0, 15000)
    assert w.account() == 1_070_000
    # 새 청구 2만 → 선수 1.5만 자동 상계, 미수 5천
    c = w.ok("POST", f"{w.base}/txns", {"type": "charge", "date": DAY, "partnerId": w.school, "lines": [{"name": "토너 교체비", "total": 20000, "vatMode": "included"}]})["txn"]
    assert (c["paid"], c["paidBy"][0]["txnId"]) == (15000, r["id"])
    p = w.partner(w.school)
    assert (p["receivable"], p["advance"]) == (5000, 0)
    # 입금 취소 → 배분이 풀려 미수 복귀, 계좌 감소
    w.ok("POST", f"{w.base}/txns/{DAY}/{r['id']}/cancel", {"reason": "잘못 입력"})
    p = w.partner(w.school)
    assert (p["receivable"], p["advance"]) == (75000, 0)
    assert w.account() == 1_000_000
    assert w.ok("GET", f"{w.base}/txns/{DAY}/{out['id']}")["txn"]["paid"] == 0
    # 취소된 거래는 다시 취소 불가
    assert call(w.ctx, "h1", "POST", f"{w.base}/txns/{DAY}/{r['id']}/cancel", {})[0] == 400
    # 출고 취소 → 기기 창고로
    w.ok("POST", f"{w.base}/txns/{DAY}/{out['id']}/cancel", {})
    assert w.asset(w.assets[0])["status"] == "in_stock"
    assert w.partner(w.school)["receivable"] == 20000


def test_canceling_paid_charge_returns_money_to_advance(w: World) -> None:
    c = w.ok("POST", f"{w.base}/txns", {"type": "charge", "date": DAY, "partnerId": w.school, "lines": [{"name": "임대료", "total": 100000, "vatMode": "included"}]})["txn"]
    w.ok("POST", f"{w.base}/txns", {"type": "receipt", "date": DAY, "partnerId": w.school, "accountId": w.bank, "amount": 100000})
    w.ok("POST", f"{w.base}/txns/{DAY}/{c['id']}/cancel", {})
    p = w.partner(w.school)
    assert (p["receivable"], p["advance"]) == (0, 100000)


def test_sale_stock_paynow_and_shortage(w: World) -> None:
    t = w.ok("POST", f"{w.base}/txns", {"type": "sale", "date": DAY, "partnerId": w.school, "lines": [{"itemId": w.toner, "qty": 3, "unitPrice": 50000, "vatMode": "excluded"}], "payNow": {"accountId": w.bank}})
    assert t["txn"]["lines"][0]["name"] == "토너" and t["txn"]["paid"] == 165000
    assert t["related"][0]["type"] == "receipt" and w.account() == 1_165_000
    assert w.item(w.toner)["qty"] == 7 and w.partner(w.school)["receivable"] == 0
    # 재고보다 많이 판매 → 거절, 재고 그대로
    status, err = w.txn({"type": "sale", "partnerId": w.school, "lines": [{"itemId": w.toner, "qty": 8, "unitPrice": 1}]})
    assert status == 400 and "재고" in err["message"]
    assert w.item(w.toner)["qty"] == 7
    # 기기 모델은 판매 불가
    assert w.txn({"type": "sale", "partnerId": w.school, "lines": [{"itemId": w.model, "unitPrice": 1}]})[0] == 400


def test_purchase_creates_assets_payment_and_adjust(w: World) -> None:
    res = w.ok("POST", f"{w.base}/txns", {"type": "purchase", "date": DAY, "partnerId": w.vendor, "lines": [{"itemId": w.model, "qty": 2, "unitPrice": 2_000_000}, {"itemId": w.toner, "qty": 5, "unitPrice": 30000}]})
    assert [a["code"] for a in res["createdAssets"]] == ["A-000003", "A-000004"]
    assert w.item(w.toner)["qty"] == 15 and w.item(w.model)["assetCounts"]["in_stock"] == 4
    assert w.partner(w.vendor)["payable"] == 4_565_000
    w.ok("POST", f"{w.base}/txns", {"type": "payment", "date": DAY, "partnerId": w.vendor, "accountId": w.bank, "amount": 500000})
    assert w.partner(w.vendor)["payable"] == 4_065_000 and w.account() == 500_000
    # 재고 조정 (분실 -2)
    w.ok("POST", f"{w.base}/txns", {"type": "adjust", "date": DAY, "lines": [{"itemId": w.toner, "qty": -2, "memo": "분실"}]})
    assert w.item(w.toner)["qty"] == 13
    assert w.txn({"type": "adjust", "lines": [{"itemId": w.toner, "qty": -100}]})[0] == 400
    # 경비
    w.ok("POST", f"{w.base}/txns", {"type": "expense", "date": DAY, "accountId": w.bank, "amount": 30000, "category": "유류비"})
    assert w.account() == 470_000
    # 장부: 최신순, 거래 후 잔액
    rows = w.ok("GET", f"{w.base}/ledger", query={"from": DAY, "to": DAY})["rows"]
    assert [(r["type"], r["amount"], r["balanceAfter"]) for r in rows] == [("expense", -30000, 470_000), ("payment", -500000, 500_000)]
    assert {r["name"] for r in w.ok("GET", f"{w.base}/receivables")["partners"]} == {"도매상"}


def test_field_staff_permissions_and_redaction(w: World) -> None:
    # 현장 기사: 임대 출고는 가능, 금액 거래·금액 줄은 불가, 조회 시 금액 숨김
    assert w.txn({"type": "rental_out", "partnerId": w.school, "assetIds": [w.assets[0]]}, sub="f1")[0] == 200
    assert w.txn({"type": "rental_out", "partnerId": w.school, "assetIds": [w.assets[1]], "lines": [{"name": "설치비", "total": 10000}]}, sub="f1")[0] == 403
    assert w.txn({"type": "receipt", "partnerId": w.school, "accountId": w.bank, "amount": 1}, sub="f1")[0] == 403
    w.ok("POST", f"{w.base}/txns", {"type": "charge", "date": DAY, "partnerId": w.school, "lines": [{"name": "임대료", "total": 1000}]})
    seen = w.ok("GET", f"{w.base}/txns", sub="f1", query={"from": DAY, "to": DAY})["txns"]
    assert all("total" not in t and all("total" not in ln for ln in t["lines"]) for t in seen)


def test_month_close(w: World) -> None:
    w.ok("POST", f"{w.base}/closes", {"month": "2026-09"})
    status, err = w.txn({"type": "charge", "date": "2026-09-30", "partnerId": w.school, "lines": [{"name": "x", "total": 1}]})
    assert status == 400 and "closed" in err["message"]
    assert call(w.ctx, "f1", "POST", f"{w.base}/closes", {"month": "2026-08"})[0] == 403
    w.ok("DELETE", f"{w.base}/closes/2026-09")
    assert w.txn({"type": "charge", "date": "2026-09-30", "partnerId": w.school, "lines": [{"name": "x", "total": 1}]})[0] == 200
