import json
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from common import users
from common.aws import table
from common.perms import Level, Module, Role, Status
from handlers import personal
from tests.conftest import FakeContext, http_event


def call(ctx: FakeContext, method: str, path: str, body: dict[str, Any] | None = None, query: dict[str, str] | None = None, sub: str = "m1") -> tuple[int, Any]:
    raw = json.dumps(body) if body is not None else None
    res = personal.lambda_handler(http_event(method, f"/api/v1{path}", sub=sub, body=raw, query=query), ctx)
    return res["statusCode"], json.loads(res["body"])


@pytest.fixture
def member() -> None:
    users.create_profile("m1", "m@x.com", "Member", "", Status.ACTIVE, Role.MEMBER)
    users.set_perms("m1", {Module.NOTES: Level.EDIT})
    users.create_profile("v1", "v@x.com", "Viewer", "", Status.ACTIVE, Role.MEMBER)
    users.set_perms("v1", {Module.NOTES: Level.VIEW})


@pytest.mark.usefixtures("aws", "member")
class TestNotes:
    def test_create_patch_and_list_order(self, ctx: FakeContext) -> None:
        a = call(ctx, "POST", "/notes", {"body": "첫 메모"})[1]
        assert (a["title"], a["tags"], a["pinned"]) == ("", [], False)
        b = call(ctx, "POST", "/notes", {"title": "회의", "tags": ["업무", " 업무 ", "회의"]})[1]
        assert b["tags"] == ["업무", "회의"]
        # 빈 메모는 만들지 않는다
        assert call(ctx, "POST", "/notes", {"title": " ", "body": ""})[0] == 400
        call(ctx, "PATCH", f"/notes/{a['id']}", {"body": "고친 메모", "pinned": True})
        notes = call(ctx, "GET", "/notes")[1]["notes"]
        assert [n["id"] for n in notes] == [a["id"], b["id"]]  # 최근 수정순
        assert notes[0]["body"] == "고친 메모" and notes[0]["pinned"] is True

    def test_trash_restore_and_permanent(self, ctx: FakeContext) -> None:
        a = call(ctx, "POST", "/notes", {"body": "지울 메모"})[1]
        assert call(ctx, "DELETE", f"/notes/{a['id']}")[1]["permanent"] is False
        assert call(ctx, "GET", "/notes")[1]["notes"] == []
        trash = call(ctx, "GET", "/notes", query={"trash": "true"})[1]["notes"]
        assert [n["id"] for n in trash] == [a["id"]] and "deletedAt" in trash[0] and "ttl" not in trash[0]
        item = table().get_item(Key={"PK": "USER#m1", "SK": f"NOTE#{a['id']}"})["Item"]
        assert int(item["ttl"]) > datetime.now(UTC).timestamp() + 29 * 86400
        assert call(ctx, "PATCH", f"/notes/{a['id']}", {"body": "x"})[0] == 400
        restored = call(ctx, "POST", f"/notes/{a['id']}/restore")[1]
        assert "deletedAt" not in restored
        assert "ttl" not in table().get_item(Key={"PK": "USER#m1", "SK": f"NOTE#{a['id']}"})["Item"]
        # 휴지통에서 한 번 더 지우면 영구 삭제
        call(ctx, "DELETE", f"/notes/{a['id']}")
        assert call(ctx, "DELETE", f"/notes/{a['id']}")[1]["permanent"] is True
        assert call(ctx, "GET", f"/notes/{a['id']}")[0] == 404

    def test_expired_trash_is_hidden(self, ctx: FakeContext) -> None:
        a = call(ctx, "POST", "/notes", {"body": "오래된 메모"})[1]
        old = (datetime.now(UTC) - timedelta(days=31)).isoformat()
        table().update_item(Key={"PK": "USER#m1", "SK": f"NOTE#{a['id']}"}, UpdateExpression="SET deletedAt = :d", ExpressionAttributeValues={":d": old})
        assert call(ctx, "GET", "/notes", query={"trash": "true"})[1]["notes"] == []
        assert call(ctx, "GET", f"/notes/{a['id']}")[0] == 404

    def test_permissions_and_isolation(self, ctx: FakeContext) -> None:
        a = call(ctx, "POST", "/notes", {"body": "내 메모"})[1]
        assert call(ctx, "GET", f"/notes/{a['id']}", sub="v1")[0] == 404  # 다른 사람 메모는 안 보임
        assert call(ctx, "GET", "/notes", sub="v1")[0] == 200
        assert call(ctx, "POST", "/notes", {"body": "x"}, sub="v1")[0] == 403

    @pytest.mark.parametrize("body", [{"tags": ["x" * 31]}, {"body": "x" * 50001}, {"color": "red"}])
    def test_rejects_invalid(self, ctx: FakeContext, body: dict[str, Any]) -> None:
        assert call(ctx, "POST", "/notes", {"title": "t", **body})[0] == 400
