"""관리자가 만들어 주는 직원 계정: 인증 메일 없이 바로 활성, 임시 비밀번호, 멈춘 가입은 새로 만들기, 비밀번호 다시 만들기는 만든 계정만"""

import json
from typing import Any

import boto3
import pytest

from common import users
from common.perms import Role, Status
from handlers import auth_trigger, company
from tests.conftest import FakeContext, http_event
from tests.test_auth_trigger import confirm_event


def call(ctx: FakeContext, sub: str, method: str, path: str, body: dict[str, Any] | None = None) -> tuple[int, Any]:
    raw = json.dumps(body) if body is not None else None
    res = company.lambda_handler(http_event(method, f"/api/v1{path}", sub=sub, groups="[host]" if sub == "h1" else "", body=raw), ctx)
    return res["statusCode"], json.loads(res["body"])


@pytest.fixture
def world(aws: dict[str, str], ctx: FakeContext) -> dict[str, Any]:
    users.create_profile("h1", "h@x.com", "호스트", "", Status.ACTIVE, Role.HOST)
    status, co = call(ctx, "h1", "POST", "/company", {"name": "행컴퍼니"})
    assert status == 200
    return {"ctx": ctx, "pool": aws["pool_id"], "cid": co["id"], "base": f"/company/{co['id']}"}


def test_create_account_active_without_mail(world: dict[str, Any]) -> None:
    ctx, base, pool = world["ctx"], world["base"], world["pool"]
    status, acc = call(ctx, "h1", "POST", f"{base}/members/accounts", {"name": "박기사", "email": "Field@Example.com", "roleId": "field"})
    assert status == 200, acc
    pw = acc["temporaryPassword"]
    assert acc["email"] == "field@example.com" and len(pw) == 12 and any(c.isdigit() for c in pw) and any(c in "!#$%" for c in pw)
    u = boto3.client("cognito-idp").admin_get_user(UserPoolId=pool, Username="field@example.com")
    assert u["UserStatus"] == "FORCE_CHANGE_PASSWORD" and {"Name": "email_verified", "Value": "true"} in u["UserAttributes"]
    profile = users.get_profile(acc["sub"])
    assert profile and profile["status"] == "active" and profile["createdByCompany"] == world["cid"]
    members = {m["sub"]: m for m in call(ctx, "h1", "GET", f"{base}/members")[1]["members"]}
    m = members[acc["sub"]]
    assert m["roleId"] == "field" and not m["showAmounts"] and m["managed"] and m["name"] == "박기사"
    # 만든 계정은 바로 회사 API를 쓴다 (승인 대기 없음)
    assert call(ctx, acc["sub"], "GET", f"{base}/staff")[0] == 200
    # 같은 이메일 다시 → 거절
    assert call(ctx, "h1", "POST", f"{base}/members/accounts", {"name": "x", "email": "field@example.com", "roleId": "field"})[0] == 400
    # 가입 확정 트리거가 와도 활성 계정을 비활성화하지 않는다
    auth_trigger.lambda_handler(confirm_event(pool, acc["sub"], "field@example.com"), ctx)
    assert users.get_profile(acc["sub"])["status"] == "active"  # type: ignore[index]


def test_stuck_signup_is_recreated(world: dict[str, Any]) -> None:
    idp = boto3.client("cognito-idp")
    client = idp.create_user_pool_client(UserPoolId=world["pool"], ClientName="web")["UserPoolClient"]["ClientId"]
    idp.sign_up(ClientId=client, Username="stuck@example.com", Password="Abcd123!x", UserAttributes=[{"Name": "email", "Value": "stuck@example.com"}])
    assert idp.admin_get_user(UserPoolId=world["pool"], Username="stuck@example.com")["UserStatus"] == "UNCONFIRMED"
    status, acc = call(world["ctx"], "h1", "POST", f"{world['base']}/members/accounts", {"name": "멈춘 가입", "email": "stuck@example.com", "roleId": "office"})
    assert status == 200, acc
    assert idp.admin_get_user(UserPoolId=world["pool"], Username="stuck@example.com")["UserStatus"] == "FORCE_CHANGE_PASSWORD"


def test_permissions_and_password_reset(world: dict[str, Any]) -> None:
    ctx, base = world["ctx"], world["base"]
    _, acc = call(ctx, "h1", "POST", f"{base}/members/accounts", {"name": "사무", "email": "office@example.com", "roleId": "office"})
    # 관리자가 아니면 계정을 만들거나 비밀번호를 바꿀 수 없다
    assert call(ctx, acc["sub"], "POST", f"{base}/members/accounts", {"name": "y", "email": "y@example.com", "roleId": "field"})[0] == 403
    assert call(ctx, acc["sub"], "POST", f"{base}/members/{acc['sub']}/password")[0] == 403
    assert call(ctx, "h1", "POST", f"{base}/members/accounts", {"name": "y", "email": "y@example.com", "roleId": "nope"})[0] == 400
    status, res = call(ctx, "h1", "POST", f"{base}/members/{acc['sub']}/password")
    assert status == 200 and res["temporaryPassword"] != acc["temporaryPassword"]
    # 직접 가입한 계정(만든 회사 표시 없음)은 다시 만들 수 없다
    users.create_profile("self1", "self@example.com", "직접 가입", "", Status.ACTIVE, Role.MEMBER)
    code = call(ctx, "h1", "POST", f"{base}/invites", {"roleId": "field"})[1]["code"]
    call(ctx, "self1", "POST", f"/company/invites/{code}/accept")
    assert call(ctx, "h1", "POST", f"{base}/members/self1/password")[0] == 400
