from datetime import UTC, datetime
from typing import Any

import boto3
import pytest

from common import audit, users
from common.perms import Status
from handlers import auth_trigger
from tests.conftest import HOST_EMAIL, FakeContext, add_cognito_user


def confirm_event(pool_id: str, sub: str, email: str) -> dict[str, Any]:
    return {
        "triggerSource": "PostConfirmation_ConfirmSignUp",
        "userPoolId": pool_id,
        "userName": sub,
        "request": {"userAttributes": {"sub": sub, "email": email, "name": "이름", "custom:signup_note": "메모"}},
        "response": {},
    }


def test_member_signup_is_disabled_and_pending(aws: dict[str, str], ctx: FakeContext) -> None:
    add_cognito_user(aws["pool_id"], "m1", "m@x.com")
    event = confirm_event(aws["pool_id"], "m1", "m@x.com")
    assert auth_trigger.lambda_handler(event, ctx) == event

    user = boto3.client("cognito-idp").admin_get_user(UserPoolId=aws["pool_id"], Username="m1")
    assert user["Enabled"] is False
    profile = users.get_profile("m1")
    assert profile is not None
    assert (profile["status"], profile["role"], profile["signupNote"]) == ("pending", "member", "메모")
    assert [u["sub"] for u in users.list_by_status(Status.PENDING)] == ["m1"]


def test_host_email_is_activated(aws: dict[str, str], ctx: FakeContext) -> None:
    add_cognito_user(aws["pool_id"], "h1", HOST_EMAIL)
    auth_trigger.lambda_handler(confirm_event(aws["pool_id"], "h1", HOST_EMAIL.upper()), ctx)

    idp = boto3.client("cognito-idp")
    assert idp.admin_get_user(UserPoolId=aws["pool_id"], Username="h1")["Enabled"] is True
    groups = idp.admin_list_groups_for_user(UserPoolId=aws["pool_id"], Username="h1")["Groups"]
    assert [g["GroupName"] for g in groups] == ["host"]
    profile = users.get_profile("h1")
    assert profile is not None
    assert (profile["status"], profile["role"]) == ("active", "host")
    assert set(users.get_perms("h1").values()) == {"edit"}


def test_notification_failure_does_not_block_signup(
    aws: dict[str, str], ctx: FakeContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SIGNUP_TOPIC_ARN", "arn:aws:sns:ap-northeast-2:000000000000:missing")
    add_cognito_user(aws["pool_id"], "m1", "m@x.com")
    auth_trigger.lambda_handler(confirm_event(aws["pool_id"], "m1", "m@x.com"), ctx)
    assert users.get_profile("m1") is not None


@pytest.mark.usefixtures("aws")
def test_login_is_audited(ctx: FakeContext) -> None:
    event = {
        "triggerSource": "PostAuthentication_Authentication",
        "request": {"userAttributes": {"sub": "m1", "email": "m@x.com"}},
    }
    auth_trigger.lambda_handler(event, ctx)
    logs = audit.list_month(f"{datetime.now(UTC):%Y-%m}")
    assert [(log["action"], log["actorEmail"]) for log in logs] == [("login", "m@x.com")]
