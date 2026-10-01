import json
from typing import Any

import boto3
import pytest

from common import users
from common.perms import Level, Module, Role, Status
from domains import ai
from handlers import ai as ai_handler
from tests.conftest import FakeContext, http_event


def call(ctx: FakeContext, method: str, path: str, body: dict[str, Any] | None = None) -> tuple[int, Any]:
    raw = json.dumps(body) if body is not None else None
    res = ai_handler.lambda_handler(http_event(method, f"/api/v1{path}", sub="m1", body=raw), ctx)
    return res["statusCode"], json.loads(res["body"])


@pytest.fixture
def model_calls(aws: dict[str, str], monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Bedrock 대신 고정 응답. 모델 호출 여부·횟수를 기록한다"""
    users.create_profile("m1", "m@x.com", "Member", "", Status.ACTIVE, Role.MEMBER)
    users.set_perms("m1", {Module.HEALTH: Level.EDIT})
    calls: list[str] = []

    def fake_estimate(text: str) -> ai.Estimate:
        calls.append(text)
        return ai.Estimate(items=[ai.FoodEstimate(name=" 현미밥 ", grams=200, kcal=300.04, carb=64, protein=6, fat=-1)])

    monkeypatch.setattr(ai, "estimate", fake_estimate)
    return calls


def test_estimate_returns_clean_items_and_counts(model_calls: list[str], ctx: FakeContext) -> None:
    status, body = call(ctx, "POST", "/ai/estimate-calories", {"text": "현미밥 200g"})
    assert status == 200
    # 이름 공백 정리, 소수 첫째 자리, 음수는 0
    assert body["items"] == [{"name": "현미밥", "grams": 200.0, "kcal": 300.0, "carb": 64.0, "protein": 6.0, "fat": 0.0}]
    assert body["usage"] == {"used": 1, "limit": 50}
    assert call(ctx, "GET", "/ai/usage")[1] == {"used": 1, "limit": 50}
    assert model_calls == ["현미밥 200g"]


def test_daily_limit_blocks_before_calling_model(model_calls: list[str], ctx: FakeContext) -> None:
    boto3.resource("dynamodb").Table("portal-test").put_item(
        Item={"PK": "USER#m1", "SK": f"AIUSAGE#{ai.kst_today()}", "count": 50}
    )
    status, body = call(ctx, "POST", "/ai/estimate-calories", {"text": "사과"})
    assert status == 429 and "50" in body["message"]
    assert model_calls == []


def test_failed_call_is_not_counted(model_calls: list[str], ctx: FakeContext, monkeypatch: pytest.MonkeyPatch) -> None:
    def broken(text: str) -> ai.Estimate:
        raise ValueError("unexpected stop_reason: max_tokens")

    monkeypatch.setattr(ai, "estimate", broken)
    assert call(ctx, "POST", "/ai/estimate-calories", {"text": "사과"})[0] == 502
    assert call(ctx, "GET", "/ai/usage")[1]["used"] == 0


def test_requires_health_edit(model_calls: list[str], ctx: FakeContext) -> None:
    users.set_perms("m1", {Module.HEALTH: Level.VIEW})
    assert call(ctx, "POST", "/ai/estimate-calories", {"text": "사과"})[0] == 403
    assert model_calls == []


def test_validates_text(model_calls: list[str], ctx: FakeContext) -> None:
    assert call(ctx, "POST", "/ai/estimate-calories", {"text": ""})[0] == 400
    assert call(ctx, "POST", "/ai/estimate-calories", {"text": "x" * 301})[0] == 400
