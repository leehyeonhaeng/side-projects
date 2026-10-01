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


@pytest.fixture
def member() -> None:
    users.create_profile("m1", "m@x.com", "Member", "", Status.ACTIVE, Role.MEMBER)
    users.set_perms("m1", {Module.HEALTH: Level.EDIT})


@pytest.mark.usefixtures("aws", "member")
class TestWeights:
    def test_upsert_one_per_day(self, ctx: FakeContext) -> None:
        assert call(ctx, "PUT", "/weights/2026-10-01", {"weight": 72.4})[1] == {"date": "2026-10-01", "weight": 72.4, "memo": ""}
        # 같은 날 다시 저장하면 덮어쓰고, 인바디 수치는 선택
        _, w = call(ctx, "PUT", "/weights/2026-10-01", {"weight": 72.1, "bodyFat": 21.5, "muscle": 31.2, "memo": "인바디"})
        assert (w["weight"], w["bodyFat"], w["muscle"]) == (72.1, 21.5, 31.2)
        assert len(call(ctx, "GET", "/weights")[1]["weights"]) == 1

    def test_range_and_order(self, ctx: FakeContext) -> None:
        for d, kg in [("2026-09-20", 74.0), ("2026-10-01", 72.0), ("2026-09-25", 73.0)]:
            call(ctx, "PUT", f"/weights/{d}", {"weight": kg})
        all_ = call(ctx, "GET", "/weights")[1]["weights"]
        assert [w["date"] for w in all_] == ["2026-09-20", "2026-09-25", "2026-10-01"]
        ranged = call(ctx, "GET", "/weights", query={"from": "2026-09-24", "to": "2026-10-01"})[1]["weights"]
        assert [w["weight"] for w in ranged] == [73.0, 72.0]
        assert call(ctx, "GET", "/weights", query={"from": "2026-09-24"})[0] == 400

    @pytest.mark.parametrize("body", [{"weight": 10}, {"weight": 70, "bodyFat": 90}, {}, {"weight": 70, "height": 170}])
    def test_rejects_invalid(self, ctx: FakeContext, body: dict[str, Any]) -> None:
        assert call(ctx, "PUT", "/weights/2026-10-01", body)[0] == 400

    def test_bad_date_and_delete(self, ctx: FakeContext) -> None:
        assert call(ctx, "PUT", "/weights/2026-13-01", {"weight": 70})[0] == 400
        call(ctx, "PUT", "/weights/2026-10-01", {"weight": 70})
        assert call(ctx, "DELETE", "/weights/2026-10-01")[0] == 200
        assert call(ctx, "DELETE", "/weights/2026-10-01")[0] == 404

    def test_goal_weight_setting(self, ctx: FakeContext) -> None:
        assert call(ctx, "PATCH", "/settings", {"goalWeight": 68.5})[1]["goalWeight"] == 68.5
        assert call(ctx, "PATCH", "/settings", {"goalWeight": 500})[0] == 400
