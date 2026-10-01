import json
from typing import Any

import pytest

from common import users
from common.perms import Level, Module, Role, Status
from handlers import personal
from tests.conftest import FakeContext, http_event


def call(ctx: FakeContext, method: str, path: str, body: dict[str, Any] | None = None, query: dict[str, str] | None = None) -> tuple[int, Any]:
    raw = json.dumps(body) if body is not None else None
    res = personal.lambda_handler(http_event(method, f"/api/v1{path}", sub="m1", body=raw, query=query), ctx)
    return res["statusCode"], json.loads(res["body"])


def day(ctx: FakeContext, d: str = "2026-10-01") -> dict[str, Any]:
    status, body = call(ctx, "GET", "/meals", query={"from": d, "to": d})
    assert status == 200
    return body


RICE = {"name": "현미밥", "grams": 200, "kcal": 300.04, "carb": 64, "protein": 6, "fat": 2}


@pytest.fixture
def member() -> None:
    users.create_profile("m1", "m@x.com", "Member", "", Status.ACTIVE, Role.MEMBER)
    users.set_perms("m1", {Module.HEALTH: Level.EDIT})


@pytest.mark.usefixtures("aws", "member")
class TestMeals:
    def test_create_round_and_totals(self, ctx: FakeContext) -> None:
        status, meal = call(ctx, "POST", "/meals", {**RICE, "date": "2026-10-01", "meal": "lunch"})
        assert status == 200
        assert (meal["kcal"], meal["method"]) == (300.0, "manual")
        call(ctx, "POST", "/meals", {"name": "사과", "kcal": 95, "date": "2026-10-01", "meal": "snack"})
        body = day(ctx)
        assert len(body["meals"]) == 2
        assert body["totals"]["2026-10-01"]["kcal"] == 395.0
        assert day(ctx, "2026-10-02")["meals"] == []

    def test_batch_from_ai(self, ctx: FakeContext) -> None:
        items = [RICE, {"name": "닭가슴살", "grams": 150, "kcal": 165, "protein": 31, "carb": 0, "fat": 3.6}]
        status, body = call(ctx, "POST", "/meals/batch", {"date": "2026-10-01", "meal": "dinner", "method": "ai", "items": items})
        assert status == 200
        assert [m["method"] for m in body["meals"]] == ["ai", "ai"]
        assert day(ctx)["totals"]["2026-10-01"]["protein"] == 37.0

    @pytest.mark.parametrize(
        "body",
        [
            {"name": "x", "kcal": -1, "date": "2026-10-01", "meal": "lunch"},
            {"name": "", "kcal": 1, "date": "2026-10-01", "meal": "lunch"},
            {"name": "x", "kcal": 1, "date": "2026-10-01", "meal": "brunch"},
            {"name": "x", "date": "2026-10-01", "meal": "lunch"},
        ],
    )
    def test_rejects_invalid(self, ctx: FakeContext, body: dict[str, Any]) -> None:
        assert call(ctx, "POST", "/meals", body)[0] == 400

    def test_move_and_delete(self, ctx: FakeContext) -> None:
        _, meal = call(ctx, "POST", "/meals", {**RICE, "date": "2026-10-01", "meal": "lunch"})
        old = {"date": "2026-10-01", "meal": "lunch"}
        new = {"date": "2026-10-01", "meal": "dinner"}
        status, moved = call(ctx, "PATCH", f"/meals/{meal['id']}", {"meal": "dinner", "kcal": 250}, query=old)
        assert status == 200 and (moved["meal"], moved["kcal"]) == ("dinner", 250.0)
        assert [m["meal"] for m in day(ctx)["meals"]] == ["dinner"]
        assert call(ctx, "PATCH", f"/meals/{meal['id']}", {"kcal": None}, query=new)[0] == 400
        assert call(ctx, "DELETE", f"/meals/{meal['id']}", query=old)[0] == 404  # 옮기기 전 키
        assert call(ctx, "DELETE", f"/meals/{meal['id']}", query=new)[0] == 200
        assert day(ctx)["meals"] == []

    def test_copy_yesterday(self, ctx: FakeContext) -> None:
        call(ctx, "POST", "/meals", {**RICE, "date": "2026-09-30", "meal": "breakfast"})
        call(ctx, "POST", "/meals", {"name": "라면", "kcal": 500, "date": "2026-09-30", "meal": "lunch"})
        status, body = call(ctx, "POST", "/meals/copy", {"fromDate": "2026-09-30", "toDate": "2026-10-01", "meal": "lunch"})
        assert status == 200 and [m["name"] for m in body["meals"]] == ["라면"]
        call(ctx, "POST", "/meals/copy", {"fromDate": "2026-09-30", "toDate": "2026-10-01"})
        assert len(day(ctx)["meals"]) == 3
        assert call(ctx, "POST", "/meals/copy", {"fromDate": "2026-09-01", "toDate": "2026-10-01"})[0] == 400

    def test_stats_daily_totals(self, ctx: FakeContext) -> None:
        call(ctx, "POST", "/meals", {**RICE, "date": "2026-08-01", "meal": "lunch"})
        call(ctx, "POST", "/meals", {**RICE, "date": "2026-10-01", "meal": "lunch"})
        _, body = call(ctx, "GET", "/meals/stats", query={"from": "2026-07-01", "to": "2026-10-31"})
        assert sorted(body["totals"]) == ["2026-08-01", "2026-10-01"]

    def test_foods_and_sets(self, ctx: FakeContext) -> None:
        _, food = call(ctx, "POST", "/foods", {"name": "그릭요거트", "basis": "serving", "servingGrams": 100, "kcal": 97, "protein": 9})
        assert call(ctx, "GET", "/foods", query={"q": "요거"})[1]["foods"][0]["id"] == food["id"]
        assert call(ctx, "GET", "/foods", query={"q": "없음"})[1]["foods"] == []
        assert call(ctx, "PUT", f"/foods/{food['id']}", {"name": "요거트", "kcal": 90})[1]["name"] == "요거트"
        assert call(ctx, "DELETE", f"/foods/{food['id']}")[0] == 200
        assert call(ctx, "DELETE", f"/foods/{food['id']}")[0] == 404

        _, mset = call(ctx, "POST", "/meal-sets", {"name": "아침 기본", "items": [RICE]})
        assert call(ctx, "GET", "/meal-sets")[1]["sets"][0]["items"][0]["kcal"] == 300.0
        assert call(ctx, "DELETE", f"/meal-sets/{mset['id']}")[0] == 200

    def test_health_permission(self, ctx: FakeContext) -> None:
        users.set_perms("m1", {Module.HEALTH: Level.VIEW})
        assert call(ctx, "GET", "/meals", query={"from": "2026-10-01", "to": "2026-10-01"})[0] == 200
        assert call(ctx, "POST", "/meals", {**RICE, "date": "2026-10-01", "meal": "lunch"})[0] == 403
        users.set_perms("m1", {Module.HEALTH: Level.NONE})
        assert call(ctx, "GET", "/foods")[0] == 403
