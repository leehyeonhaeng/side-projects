import json
from typing import Any

import pytest

from common import users
from common.perms import Level, Module, Role, Status
from handlers import personal
from tests.conftest import FakeContext, http_event


def call(ctx: FakeContext, method: str, path: str, sub: str | None, groups: str = "") -> dict[str, Any]:
    return personal.lambda_handler(http_event(method, path, sub=sub, groups=groups), ctx)


@pytest.mark.usefixtures("aws")
class TestAccessControl:
    def test_pending_account_is_blocked(self, ctx: FakeContext) -> None:
        users.create_profile("p1", "p@x.com", "P", "", Status.PENDING, Role.MEMBER)
        assert call(ctx, "GET", "/api/v1/me", "p1")["statusCode"] == 403

    def test_unknown_user_is_blocked(self, ctx: FakeContext) -> None:
        assert call(ctx, "GET", "/api/v1/me", "ghost")["statusCode"] == 403

    def test_active_member_me(self, ctx: FakeContext) -> None:
        users.create_profile("m1", "m@x.com", "M", "", Status.ACTIVE, Role.MEMBER)
        users.set_perms("m1", {Module.TODO: Level.VIEW})
        res = call(ctx, "GET", "/api/v1/me", "m1")
        body = json.loads(res["body"])
        assert res["statusCode"] == 200
        assert body["perms"]["todo"] == "view"
        assert body["perms"]["ledger"] == "none"
        assert body["isHost"] is False

    def test_module_permission_levels(self, ctx: FakeContext) -> None:
        users.create_profile("m1", "m@x.com", "M", "", Status.ACTIVE, Role.MEMBER)
        # 권한 없음 → 403 (라우트가 아직 없어도 권한 검사가 먼저, notes는 Phase 7 전이라 미구현)
        assert call(ctx, "GET", "/api/v1/notes", "m1")["statusCode"] == 403
        users.set_perms("m1", {Module.NOTES: Level.VIEW})
        assert call(ctx, "GET", "/api/v1/notes", "m1")["statusCode"] == 404
        assert call(ctx, "POST", "/api/v1/notes", "m1")["statusCode"] == 403
        users.set_perms("m1", {Module.NOTES: Level.EDIT})
        assert call(ctx, "POST", "/api/v1/notes", "m1")["statusCode"] == 404

    def test_suspended_account_is_blocked_immediately(self, ctx: FakeContext) -> None:
        users.create_profile("m1", "m@x.com", "M", "", Status.ACTIVE, Role.MEMBER)
        assert call(ctx, "GET", "/api/v1/me", "m1")["statusCode"] == 200
        users.set_status("m1", Status.SUSPENDED)
        assert call(ctx, "GET", "/api/v1/me", "m1")["statusCode"] == 403

    def test_host_bypasses_module_permissions(self, ctx: FakeContext) -> None:
        users.create_profile("h1", "h@x.com", "H", "", Status.ACTIVE, Role.HOST)
        assert call(ctx, "GET", "/api/v1/notes", "h1", "[host]")["statusCode"] == 404
        body = json.loads(call(ctx, "GET", "/api/v1/me", "h1", "[host]")["body"])
        assert body["isHost"] is True
        assert set(body["perms"].values()) == {"edit"}
