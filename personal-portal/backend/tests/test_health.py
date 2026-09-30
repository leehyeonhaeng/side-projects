import importlib
import json

import pytest

from tests.conftest import FakeContext, http_event


@pytest.mark.parametrize("service", ["personal", "shared", "admin", "ai"])
def test_health_is_public(service: str, ctx: FakeContext) -> None:
    handler = importlib.import_module(f"handlers.{service}")
    res = handler.lambda_handler(http_event("GET", "/api/v1/health"), ctx)
    assert res["statusCode"] == 200
    assert json.loads(res["body"]) == {"status": "ok", "service": service}


def test_other_routes_require_identity(ctx: FakeContext) -> None:
    handler = importlib.import_module("handlers.personal")
    res = handler.lambda_handler(http_event("GET", "/api/v1/nope"), ctx)
    assert res["statusCode"] == 401
