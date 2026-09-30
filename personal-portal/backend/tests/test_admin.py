import json
from datetime import UTC, datetime
from typing import Any

import boto3
import pytest

from common import audit, users
from common.perms import Level, Module, Role, Status
from handlers import admin
from tests.conftest import FakeContext, add_cognito_user, http_event


@pytest.fixture
def env(aws: dict[str, str], monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    admin._mfa_verified_at.clear()
    monkeypatch.setattr(admin, "has_totp", lambda sub: True)
    users.create_profile("h1", "h@x.com", "Host", "", Status.ACTIVE, Role.HOST)
    add_cognito_user(aws["pool_id"], "m1", "m@x.com")
    boto3.client("cognito-idp").admin_disable_user(UserPoolId=aws["pool_id"], Username="m1")
    users.create_profile("m1", "m@x.com", "Member", "", Status.PENDING, Role.MEMBER)
    return aws


def req(
    ctx: FakeContext,
    method: str,
    path: str,
    body: dict[str, Any] | None = None,
    sub: str = "h1",
    groups: str = "[host]",
    query: dict[str, str] | None = None,
) -> tuple[int, Any]:
    raw = json.dumps(body) if body is not None else None
    res = admin.lambda_handler(http_event(method, f"/api/v1{path}", sub=sub, groups=groups, body=raw, query=query), ctx)
    return res["statusCode"], json.loads(res["body"]) if res.get("body") else None


def enabled(pool_id: str, sub: str) -> bool:
    return bool(boto3.client("cognito-idp").admin_get_user(UserPoolId=pool_id, Username=sub)["Enabled"])


def audit_logs() -> list[dict[str, Any]]:
    return audit.list_month(f"{datetime.now(UTC):%Y-%m}")


def test_non_host_is_forbidden(env: dict[str, str], ctx: FakeContext) -> None:
    users.create_profile("x1", "x@x.com", "X", "", Status.ACTIVE, Role.MEMBER)
    assert req(ctx, "GET", "/admin/users", sub="x1", groups="")[0] == 403


def test_host_without_mfa_is_forbidden(env: dict[str, str], ctx: FakeContext, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(admin, "has_totp", lambda sub: False)
    status, body = req(ctx, "GET", "/admin/users")
    assert (status, body["message"]) == (403, "mfa required")


def test_approve_with_preset(env: dict[str, str], ctx: FakeContext) -> None:
    status, body = req(ctx, "GET", "/admin/presets")
    assert status == 200
    assert {p["id"] for p in body["presets"]} == {"family", "team"}

    pending = req(ctx, "GET", "/admin/users", query={"status": "pending"})[1]["users"]
    assert [u["email"] for u in pending] == ["m@x.com"]
    assert req(ctx, "POST", "/admin/users/m1/approve", {"presetId": "team"})[0] == 200

    assert enabled(env["pool_id"], "m1") is True
    profile = users.get_profile("m1")
    assert profile is not None and profile["status"] == "active"
    perms = users.get_perms("m1")
    assert perms[Module.BOARDS] == Level.EDIT
    assert perms[Module.LEDGER] == Level.NONE
    assert "approve" in [log["action"] for log in audit_logs()]
    # 이미 승인된 계정은 다시 승인할 수 없다
    assert req(ctx, "POST", "/admin/users/m1/approve", {"presetId": "team"})[0] == 400


def test_approve_validates_body(env: dict[str, str], ctx: FakeContext) -> None:
    assert req(ctx, "POST", "/admin/users/m1/approve", {})[0] == 400
    assert req(ctx, "POST", "/admin/users/m1/approve", {"presetId": "nope"})[0] == 404


def test_reject_deletes_everything(env: dict[str, str], ctx: FakeContext) -> None:
    assert req(ctx, "POST", "/admin/users/m1/reject")[0] == 200
    assert users.get_profile("m1") is None
    idp = boto3.client("cognito-idp")
    with pytest.raises(idp.exceptions.UserNotFoundException):
        idp.admin_get_user(UserPoolId=env["pool_id"], Username="m1")


def test_suspend_reactivate_and_delete(env: dict[str, str], ctx: FakeContext) -> None:
    req(ctx, "GET", "/admin/presets")
    req(ctx, "POST", "/admin/users/m1/approve", {"presetId": "family"})

    assert req(ctx, "POST", "/admin/users/m1/suspend")[0] == 200
    assert enabled(env["pool_id"], "m1") is False
    profile = users.get_profile("m1")
    assert profile is not None and profile["status"] == "suspended"

    assert req(ctx, "POST", "/admin/users/m1/reactivate")[0] == 200
    assert enabled(env["pool_id"], "m1") is True

    assert req(ctx, "DELETE", "/admin/users/m1")[0] == 200
    assert users.get_profile("m1") is None
    assert users.get_perms("m1") == {m: Level.NONE for m in Module}


def test_host_cannot_suspend_or_delete_self(env: dict[str, str], ctx: FakeContext) -> None:
    assert req(ctx, "POST", "/admin/users/h1/suspend")[0] == 400
    assert req(ctx, "DELETE", "/admin/users/h1")[0] == 400


def test_permission_matrix_update_is_audited(env: dict[str, str], ctx: FakeContext) -> None:
    req(ctx, "GET", "/admin/presets")
    req(ctx, "POST", "/admin/users/m1/approve", {"presetId": "family"})
    status, body = req(ctx, "PUT", "/admin/users/m1/permissions", {"perms": {"ledger": "view", "notes": "edit"}})
    assert status == 200
    assert body["perms"]["ledger"] == "view"

    matrix = req(ctx, "GET", "/admin/permissions")[1]
    row = next(u for u in matrix["users"] if u["sub"] == "m1")
    assert row["perms"]["ledger"] == "view"

    change = next(log for log in audit_logs() if log["action"] == "perm_change")
    assert change["detail"]["changes"] == {"ledger": "edit→view"}
    assert req(ctx, "PUT", "/admin/users/m1/permissions", {"perms": {"ledger": "admin"}})[0] == 400


def test_preset_crud(env: dict[str, str], ctx: FakeContext) -> None:
    status, created = req(ctx, "POST", "/admin/presets", {"name": "친구", "perms": {"notes": "edit"}})
    assert status == 200
    assert created["perms"]["notes"] == "edit"
    assert created["perms"]["ledger"] == "none"
    assert req(ctx, "PUT", f"/admin/presets/{created['id']}", {"name": "친구2", "perms": {}})[1]["name"] == "친구2"
    assert req(ctx, "DELETE", f"/admin/presets/{created['id']}")[0] == 200
    assert req(ctx, "DELETE", f"/admin/presets/{created['id']}")[0] == 404


def test_audit_month_validation(env: dict[str, str], ctx: FakeContext) -> None:
    assert req(ctx, "GET", "/admin/audit", query={"month": "2026-13"})[0] == 400
    assert req(ctx, "GET", "/admin/audit")[0] == 200
