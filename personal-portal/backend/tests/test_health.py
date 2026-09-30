import importlib
import json
from dataclasses import dataclass
from typing import Any

import pytest


@dataclass
class FakeContext:
    function_name: str = "test"
    memory_limit_in_mb: int = 256
    invoked_function_arn: str = "arn:aws:lambda:ap-northeast-2:000000000000:function:test"
    aws_request_id: str = "req-1"


def http_event(method: str, path: str) -> dict[str, Any]:
    return {
        "version": "2.0",
        "routeKey": f"{method} {path}",
        "rawPath": path,
        "rawQueryString": "",
        "headers": {},
        "requestContext": {
            "http": {"method": method, "path": path, "protocol": "HTTP/1.1", "sourceIp": "127.0.0.1", "userAgent": "test"},
            "requestId": "req-1",
            "routeKey": f"{method} {path}",
            "stage": "$default",
        },
        "isBase64Encoded": False,
    }


@pytest.mark.parametrize("service", ["personal", "shared", "admin", "ai"])
def test_health(service: str) -> None:
    handler = importlib.import_module(f"handlers.{service}")
    res = handler.lambda_handler(http_event("GET", "/api/v1/health"), FakeContext())
    assert res["statusCode"] == 200
    assert json.loads(res["body"]) == {"status": "ok", "service": service}


def test_unknown_route_returns_404() -> None:
    handler = importlib.import_module("handlers.personal")
    res = handler.lambda_handler(http_event("GET", "/api/v1/nope"), FakeContext())
    assert res["statusCode"] == 404
