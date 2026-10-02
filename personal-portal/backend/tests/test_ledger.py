import json
from datetime import date
from typing import Any

import pytest

from common import users
from common.perms import Level, Module, Role, Status
from domains import ledger
from handlers import personal
from tests.conftest import FakeContext, http_event


def call(ctx: FakeContext, method: str, path: str, body: dict[str, Any] | None = None, query: dict[str, str] | None = None) -> tuple[int, Any]:
    raw = json.dumps(body) if body is not None else None
    res = personal.lambda_handler(http_event(method, f"/api/v1{path}", sub="m1", body=raw, query=query), ctx)
    return res["statusCode"], json.loads(res["body"])


@pytest.fixture
def member(monkeypatch: pytest.MonkeyPatch) -> None:
    users.create_profile("m1", "m@x.com", "Member", "", Status.ACTIVE, Role.MEMBER)
    users.set_perms("m1", {Module.LEDGER: Level.EDIT})
    monkeypatch.setattr(ledger, "today", lambda: date(2026, 10, 15))


def cats(ctx: FakeContext) -> dict[str, str]:
    """이름 → id (지출만, 수입 '기타'와 겹치지 않게 유형 붙임)"""
    return {f"{c['type']}:{c['name']}": c["id"] for c in call(ctx, "GET", "/categories")[1]["categories"]}


def txn(ctx: FakeContext, day: str, amount: int, cat: str, kind: str = "expense", **extra: Any) -> dict[str, Any]:
    status, body = call(ctx, "POST", "/txns", {"date": day, "type": kind, "amount": amount, "categoryId": cat, **extra})
    assert status == 200, body
    return body


@pytest.mark.usefixtures("aws", "member")
class TestLedger:
    def test_default_categories_once(self, ctx: FakeContext) -> None:
        first = call(ctx, "GET", "/categories")[1]["categories"]
        assert [c["name"] for c in first if c["type"] == "expense"][:3] == ["식비", "카페·간식", "교통"]
        assert [c["name"] for c in first if c["type"] == "income"] == ["급여", "부수입", "기타"]
        assert len(call(ctx, "GET", "/categories")[1]["categories"]) == len(first)

    def test_txn_crud_and_month(self, ctx: FakeContext) -> None:
        c = cats(ctx)
        a = txn(ctx, "2026-10-03", 12000, c["expense:식비"], method="카드", memo="점심")
        txn(ctx, "2026-09-30", 5000, c["expense:카페·간식"])
        assert [t["id"] for t in call(ctx, "GET", "/txns", query={"month": "2026-10"})[1]["txns"]] == [a["id"]]
        # 유형과 카테고리가 안 맞으면 거부
        assert call(ctx, "POST", "/txns", {"date": "2026-10-03", "type": "income", "amount": 1, "categoryId": c["expense:식비"]})[0] == 400
        assert call(ctx, "POST", "/txns", {"date": "2026-10-03", "type": "expense", "amount": 0, "categoryId": c["expense:식비"]})[0] == 400
        # 날짜를 바꾸면 다른 달로 옮겨진다
        body = {"date": "2026-09-01", "type": "expense", "amount": 13000, "categoryId": c["expense:식비"], "method": "카드", "memo": "점심"}
        assert call(ctx, "PUT", f"/txns/{a['id']}", body, query={"date": "2026-10-03"})[1]["amount"] == 13000
        assert call(ctx, "GET", "/txns", query={"month": "2026-10"})[1]["txns"] == []
        assert len(call(ctx, "GET", "/txns", query={"month": "2026-09"})[1]["txns"]) == 2
        assert call(ctx, "DELETE", f"/txns/{a['id']}", query={"date": "2026-09-01"})[0] == 200
        assert call(ctx, "GET", "/txns", query={"month": "2026-13"})[0] == 400

    def test_summary_and_search(self, ctx: FakeContext) -> None:
        c = cats(ctx)
        txn(ctx, "2026-10-01", 3_000_000, c["income:급여"], kind="income", method="계좌")
        txn(ctx, "2026-10-02", 12000, c["expense:식비"], method="카드", memo="김밥천국")
        txn(ctx, "2026-08-10", 50000, c["expense:교통"], method="교통카드")
        s = call(ctx, "GET", "/txns/summary", query={"months": "3"})[1]
        assert s["months"] == [
            {"month": "2026-08", "income": 0, "expense": 50000},
            {"month": "2026-09", "income": 0, "expense": 0},
            {"month": "2026-10", "income": 3_000_000, "expense": 12000},
        ]
        assert s["methods"] == ["카드", "계좌", "교통카드"]
        assert [t["memo"] for t in call(ctx, "GET", "/txns/search", query={"q": "김밥"})[1]["txns"]] == ["김밥천국"]
        assert len(call(ctx, "GET", "/txns/search", query={"q": "교통"})[1]["txns"]) == 1  # 카테고리·결제 수단 이름

    def test_category_rules(self, ctx: FakeContext) -> None:
        c = cats(ctx)
        new = call(ctx, "POST", "/categories", {"type": "expense", "name": "반려동물"})[1]
        assert call(ctx, "PATCH", f"/categories/{new['id']}", {"name": "고양이"})[1]["name"] == "고양이"
        for key in ("income:급여", "income:부수입"):
            assert call(ctx, "DELETE", f"/categories/{c[key]}")[0] == 200
        # 유형별 마지막 하나는 남긴다
        assert call(ctx, "DELETE", f"/categories/{c['income:기타']}")[0] == 400

    def test_recurring_apply(self, ctx: FakeContext) -> None:
        c = cats(ctx)
        rent = call(ctx, "POST", "/recurring", {"amount": 500000, "categoryId": c["expense:주거·통신"], "memo": "월세", "day": 31, "startMonth": "2026-08"})[1]
        call(ctx, "POST", "/recurring", {"amount": 9900, "categoryId": c["expense:문화·여가"], "memo": "구독", "day": 10, "startMonth": "2026-10"})
        created = call(ctx, "POST", "/recurring/apply")[1]["created"]
        # 8/31, 9/30(짧은 달은 말일), 10/10. 10/31은 아직 미래라 안 만든다
        assert sorted(t["date"] for t in created) == ["2026-08-31", "2026-09-30", "2026-10-10"]
        assert call(ctx, "POST", "/recurring/apply")[1]["created"] == []
        # 사용자가 지운 회차는 다시 만들지 않는다
        sep = next(t for t in created if t["date"] == "2026-09-30")
        call(ctx, "DELETE", f"/txns/{sep['id']}", query={"date": "2026-09-30"})
        assert call(ctx, "POST", "/recurring/apply")[1]["created"] == []
        # 다음 달이 되면 10월 월세(10/31)부터 만든다
        ledger.today = lambda: date(2026, 11, 1)  # type: ignore[assignment]
        assert [t["date"] for t in call(ctx, "POST", "/recurring/apply")[1]["created"]] == ["2026-10-31"]
        assert call(ctx, "PUT", f"/recurring/{rent['id']}", {"amount": 1, "categoryId": c["income:급여"], "day": 1, "startMonth": "2026-08"})[0] == 400
        assert call(ctx, "POST", "/recurring", {"amount": 1, "categoryId": c["expense:식비"], "day": 1, "startMonth": "2026-10", "endMonth": "2026-09"})[0] == 400

    def test_budget_carries_forward(self, ctx: FakeContext) -> None:
        c = cats(ctx)
        assert call(ctx, "GET", "/budgets/2026-10")[1] == {"month": "2026-10", "from": None, "amounts": {}}
        call(ctx, "PUT", "/budgets/2026-08", {"amounts": {c["expense:식비"]: 400000, c["expense:교통"]: 0}})
        b = call(ctx, "GET", "/budgets/2026-10")[1]
        assert (b["from"], b["amounts"]) == ("2026-08", {c["expense:식비"]: 400000})
        call(ctx, "PUT", "/budgets/2026-10", {"amounts": {c["expense:식비"]: 300000}})
        assert call(ctx, "GET", "/budgets/2026-09")[1]["amounts"] == {c["expense:식비"]: 400000}
        assert call(ctx, "GET", "/budgets/2026-12")[1]["from"] == "2026-10"
        assert call(ctx, "GET", "/budgets/2026-1")[0] == 400
