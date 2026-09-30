import sys
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import boto3
import pytest
from moto import mock_aws

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from common.aws import reset_clients  # noqa: E402

HOST_EMAIL = "host@example.com"


@dataclass
class FakeContext:
    function_name: str = "test"
    memory_limit_in_mb: int = 256
    invoked_function_arn: str = "arn:aws:lambda:ap-northeast-2:000000000000:function:test"
    aws_request_id: str = "req-1"


@pytest.fixture
def ctx() -> FakeContext:
    return FakeContext()


def http_event(
    method: str,
    path: str,
    sub: str | None = None,
    groups: str = "",
    body: str | None = None,
    query: dict[str, str] | None = None,
) -> dict[str, Any]:
    event: dict[str, Any] = {
        "version": "2.0",
        "routeKey": f"{method} {path}",
        "rawPath": path,
        "rawQueryString": "&".join(f"{k}={v}" for k, v in (query or {}).items()),
        "queryStringParameters": query,
        "headers": {"content-type": "application/json"},
        "requestContext": {
            "http": {"method": method, "path": path, "protocol": "HTTP/1.1", "sourceIp": "127.0.0.1", "userAgent": "test"},
            "requestId": "req-1",
            "routeKey": f"{method} {path}",
            "stage": "$default",
        },
        "body": body,
        "isBase64Encoded": False,
    }
    if sub:
        event["requestContext"]["authorizer"] = {"jwt": {"claims": {"sub": sub, "cognito:groups": groups}, "scopes": None}}
    return event


@pytest.fixture
def aws(monkeypatch: pytest.MonkeyPatch) -> Iterator[dict[str, str]]:
    monkeypatch.setenv("AWS_DEFAULT_REGION", "ap-northeast-2")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("TABLE_NAME", "portal-test")
    monkeypatch.setenv("HOST_EMAIL", HOST_EMAIL)
    with mock_aws():
        reset_clients()
        boto3.client("dynamodb").create_table(
            TableName="portal-test",
            BillingMode="PAY_PER_REQUEST",
            AttributeDefinitions=[{"AttributeName": n, "AttributeType": "S"} for n in ("PK", "SK", "GSI1PK", "GSI1SK")],
            KeySchema=[{"AttributeName": "PK", "KeyType": "HASH"}, {"AttributeName": "SK", "KeyType": "RANGE"}],
            GlobalSecondaryIndexes=[
                {
                    "IndexName": "GSI1",
                    "KeySchema": [
                        {"AttributeName": "GSI1PK", "KeyType": "HASH"},
                        {"AttributeName": "GSI1SK", "KeyType": "RANGE"},
                    ],
                    "Projection": {"ProjectionType": "ALL"},
                }
            ],
        )
        idp = boto3.client("cognito-idp")
        pool_id = idp.create_user_pool(PoolName="test")["UserPool"]["Id"]
        idp.create_group(UserPoolId=pool_id, GroupName="host")
        topic_arn = boto3.client("sns").create_topic(Name="signup")["TopicArn"]
        monkeypatch.setenv("USER_POOL_ID", pool_id)
        monkeypatch.setenv("SIGNUP_TOPIC_ARN", topic_arn)
        yield {"pool_id": pool_id, "topic_arn": topic_arn}
        reset_clients()


def add_cognito_user(pool_id: str, sub: str, email: str) -> None:
    boto3.client("cognito-idp").admin_create_user(
        UserPoolId=pool_id,
        Username=sub,
        UserAttributes=[{"Name": "email", "Value": email}],
        MessageAction="SUPPRESS",
    )
