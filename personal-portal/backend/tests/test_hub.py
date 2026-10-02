import json
from typing import Any

import pytest

from common import users
from common.perms import Level, Module, Role, Status
from handlers import personal
from tests.conftest import FakeContext, http_event


def call(ctx: FakeContext, method: str, path: str, body: dict[str, Any] | None = None, sub: str = "m1") -> tuple[int, Any]:
    raw = json.dumps(body) if body is not None else None
    res = personal.lambda_handler(http_event(method, f"/api/v1{path}", sub=sub, body=raw), ctx)
    return res["statusCode"], json.loads(res["body"])


@pytest.fixture
def member() -> None:
    users.create_profile("m1", "m@x.com", "Member", "", Status.ACTIVE, Role.MEMBER)
    users.set_perms("m1", {Module.HUB: Level.EDIT})
    users.create_profile("m2", "n@x.com", "Other", "", Status.ACTIVE, Role.MEMBER)
    users.set_perms("m2", {Module.HUB: Level.EDIT})


SNIPPET = {"kind": "snippet", "title": "계정 확인", "lang": "bash", "code": "aws sts get-caller-identity", "tags": ["aws", " aws", "cli"]}
LINK = {"kind": "link", "title": "콘솔", "url": "https://console.aws.amazon.com"}


@pytest.mark.usefixtures("aws", "member")
class TestHub:
    def test_snippet_and_link(self, ctx: FakeContext) -> None:
        s = call(ctx, "POST", "/hub", SNIPPET)[1]
        assert (s["lang"], s["tags"], s["favorite"], s["description"]) == ("bash", ["aws", "cli"], False, "")
        link = call(ctx, "POST", "/hub", {**LINK, "code": "무시됨"})[1]
        assert "code" not in link and "lang" not in link
        # 종류별 필수 항목
        assert call(ctx, "POST", "/hub", {"kind": "snippet", "title": "x"})[0] == 400
        assert call(ctx, "POST", "/hub", {"kind": "link", "title": "x"})[0] == 400
        assert call(ctx, "POST", "/hub", {**LINK, "url": "javascript:alert(1)"})[0] == 400
        assert call(ctx, "POST", "/hub", {**SNIPPET, "lang": "cobol"})[0] == 400
        items = call(ctx, "GET", "/hub")[1]["items"]
        assert [i["id"] for i in items] == [link["id"], s["id"]]  # 최근 수정순

    def test_patch_and_favorite(self, ctx: FakeContext) -> None:
        s = call(ctx, "POST", "/hub", SNIPPET)[1]
        patched = call(ctx, "PATCH", f"/hub/{s['id']}", {"favorite": True, "description": "개인 계정 확인용", "tags": None})[1]
        assert (patched["favorite"], patched["description"], patched["tags"]) == (True, "개인 계정 확인용", [])
        assert call(ctx, "PATCH", f"/hub/{s['id']}", {"code": None})[0] == 400
        assert call(ctx, "PATCH", f"/hub/{s['id']}", {"kind": "link"})[0] == 400  # 종류는 바꿀 수 없음
        assert call(ctx, "DELETE", f"/hub/{s['id']}")[0] == 200
        assert call(ctx, "DELETE", f"/hub/{s['id']}")[0] == 404

    def test_collections(self, ctx: FakeContext) -> None:
        aws = call(ctx, "POST", "/hub/collections", {"name": "AWS"})[1]
        call(ctx, "POST", "/hub/collections", {"name": "Git"})
        assert [c["name"] for c in call(ctx, "GET", "/hub/collections")[1]["collections"]] == ["AWS", "Git"]
        s = call(ctx, "POST", "/hub", {**SNIPPET, "collectionId": aws["id"]})[1]
        assert s["collectionId"] == aws["id"]
        assert call(ctx, "POST", "/hub", {**SNIPPET, "collectionId": "nope"})[0] == 404
        # 컬렉션에서 빼기
        assert "collectionId" not in call(ctx, "PATCH", f"/hub/{s['id']}", {"collectionId": None})[1]
        call(ctx, "PATCH", f"/hub/{s['id']}", {"collectionId": aws["id"]})
        # 컬렉션을 지우면 항목은 남고 컬렉션 없음으로
        assert call(ctx, "DELETE", f"/hub/collections/{aws['id']}")[1]["moved"] == 1
        assert "collectionId" not in call(ctx, "GET", "/hub")[1]["items"][0]
        assert call(ctx, "PATCH", "/hub/collections/" + "x", {"name": "y"})[0] == 404

    def test_personal_only(self, ctx: FakeContext) -> None:
        s = call(ctx, "POST", "/hub", SNIPPET)[1]
        assert call(ctx, "GET", "/hub", sub="m2")[1]["items"] == []
        assert call(ctx, "PATCH", f"/hub/{s['id']}", {"title": "x"}, sub="m2")[0] == 404
