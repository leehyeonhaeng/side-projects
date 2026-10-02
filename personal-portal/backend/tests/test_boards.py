import json
from typing import Any

import pytest

from common import users
from common.perms import Level, Module, Role, Status
from handlers import shared
from tests.conftest import FakeContext, http_event


def call(ctx: FakeContext, sub: str, method: str, path: str, body: dict[str, Any] | None = None) -> tuple[int, Any]:
    raw = json.dumps(body) if body is not None else None
    res = shared.lambda_handler(http_event(method, f"/api/v1{path}", sub=sub, body=raw), ctx)
    return res["statusCode"], json.loads(res["body"])


@pytest.fixture
def people() -> None:
    for sub, level in [("owner", Level.EDIT), ("ed", Level.EDIT), ("vw", Level.VIEW), ("none", Level.NONE)]:
        users.create_profile(sub, f"{sub}@x.com", sub.upper(), "", Status.ACTIVE, Role.MEMBER)
        users.set_perms(sub, {Module.BOARDS: level})
    users.create_profile("pend", "p@x.com", "P", "", Status.PENDING, Role.MEMBER)
    users.set_perms("pend", {Module.BOARDS: Level.EDIT})


def new_board(ctx: FakeContext) -> tuple[str, list[dict[str, Any]]]:
    bid = call(ctx, "owner", "POST", "/boards", {"name": "사이드 프로젝트"})[1]["id"]
    return bid, call(ctx, "owner", "GET", f"/boards/{bid}")[1]["columns"]


@pytest.mark.usefixtures("aws", "people")
class TestBoards:
    def test_create_with_default_columns(self, ctx: FakeContext) -> None:
        bid, cols = new_board(ctx)
        assert [(c["name"], c["done"]) for c in cols] == [("할 일", False), ("진행 중", False), ("완료", True)]
        boards = call(ctx, "owner", "GET", "/boards")[1]["boards"]
        assert [(b["id"], b["role"], b["progress"], b["memberCount"]) for b in boards] == [(bid, "owner", {"done": 0, "total": 0}, 1)]

    def test_non_member_sees_404(self, ctx: FakeContext) -> None:
        bid, _ = new_board(ctx)
        assert call(ctx, "ed", "GET", f"/boards/{bid}")[0] == 404
        assert call(ctx, "ed", "GET", "/boards")[1]["boards"] == []

    def test_invite_candidates_and_roles(self, ctx: FakeContext) -> None:
        bid, cols = new_board(ctx)
        # 활성 + 보드 권한 view 이상만 후보 (none, pending 제외)
        cands = call(ctx, "owner", "GET", f"/boards/{bid}/candidates")[1]["candidates"]
        assert sorted(c["sub"] for c in cands) == ["ed", "vw"]
        assert call(ctx, "owner", "POST", f"/boards/{bid}/members", {"sub": "none", "role": "editor"})[0] == 400
        assert call(ctx, "owner", "POST", f"/boards/{bid}/members", {"sub": "ed", "role": "editor"})[0] == 200
        assert call(ctx, "owner", "POST", f"/boards/{bid}/members", {"sub": "ed", "role": "editor"})[0] == 400
        # 멤버 관리는 소유자만
        assert call(ctx, "ed", "GET", f"/boards/{bid}/candidates")[0] == 403
        assert call(ctx, "ed", "POST", f"/boards/{bid}/members", {"sub": "vw", "role": "viewer"})[0] == 403
        # 편집자는 카드 작성 가능
        assert call(ctx, "ed", "POST", f"/boards/{bid}/cards", {"title": "A", "columnId": cols[0]["id"]})[0] == 200
        members = call(ctx, "owner", "GET", f"/boards/{bid}")[1]["members"]
        assert [(m["sub"], m["role"]) for m in members] == [("owner", "owner"), ("ed", "editor")]

    def test_lower_of_module_and_board_role(self, ctx: FakeContext) -> None:
        bid, cols = new_board(ctx)
        # 모듈 권한이 view인 계정은 보드 편집자로 넣어도 열람만
        call(ctx, "owner", "POST", f"/boards/{bid}/members", {"sub": "vw", "role": "editor"})
        assert call(ctx, "vw", "GET", f"/boards/{bid}")[1]["role"] == "viewer"
        assert call(ctx, "vw", "POST", f"/boards/{bid}/cards", {"title": "A", "columnId": cols[0]["id"]})[0] == 403
        # 보드 열람자는 모듈 edit이어도 쓰기 불가
        call(ctx, "owner", "POST", f"/boards/{bid}/members", {"sub": "ed", "role": "viewer"})
        assert call(ctx, "ed", "PATCH", f"/boards/{bid}", {"name": "x"})[0] == 403
        call(ctx, "owner", "PATCH", f"/boards/{bid}/members/ed", {"role": "editor"})
        assert call(ctx, "ed", "PATCH", f"/boards/{bid}", {"name": "x"})[0] == 200
        assert call(ctx, "owner", "PATCH", f"/boards/{bid}/members/owner", {"role": "viewer"})[0] == 400

    def test_cards_move_and_progress(self, ctx: FakeContext) -> None:
        bid, cols = new_board(ctx)
        todo, done = cols[0]["id"], cols[2]["id"]
        a = call(ctx, "owner", "POST", f"/boards/{bid}/cards", {"title": "A", "columnId": todo})[1]
        b = call(ctx, "owner", "POST", f"/boards/{bid}/cards", {"title": "B", "columnId": todo})[1]
        assert (a["order"], b["order"], a["priority"]) == (1, 2, "normal")
        # 다른 컬럼으로 이동 (순서는 프론트가 계산한 값)
        moved = call(ctx, "owner", "PATCH", f"/boards/{bid}/cards/{b['id']}", {"columnId": done, "order": 0.5})[1]
        assert (moved["columnId"], moved["order"]) == (done, 0.5)
        assert call(ctx, "owner", "GET", f"/boards/{bid}")[1]["progress"] == {"done": 1, "total": 2}
        assert call(ctx, "owner", "PATCH", f"/boards/{bid}/cards/{a['id']}", {"columnId": "nope"})[0] == 400
        assert call(ctx, "owner", "PATCH", f"/boards/{bid}/cards/{a['id']}", {"title": None})[0] == 400

    def test_card_fields_and_refs(self, ctx: FakeContext) -> None:
        bid, cols = new_board(ctx)
        call(ctx, "owner", "PATCH", f"/boards/{bid}", {"labels": [{"id": "l1", "name": "버그", "color": "red"}, {"id": "l2", "color": "blue"}]})
        body = {
            "title": "로그인",
            "columnId": cols[0]["id"],
            "description": "**마크다운**",
            "assignee": "owner",
            "due": "2026-10-10",
            "priority": "high",
            "labels": ["l1", "l2", "l1"],
            "checklist": [{"id": "c1", "text": "화면", "done": False}],
            "links": [{"title": "문서", "url": "https://example.com"}],
        }
        status, card = call(ctx, "owner", "POST", f"/boards/{bid}/cards", body)
        assert status == 200 and card["labels"] == ["l1", "l2"] and card["due"] == "2026-10-10"
        assert call(ctx, "owner", "POST", f"/boards/{bid}/cards", {**body, "assignee": "ed"})[0] == 400
        assert call(ctx, "owner", "POST", f"/boards/{bid}/cards", {**body, "labels": ["zz"]})[0] == 400
        assert call(ctx, "owner", "POST", f"/boards/{bid}/cards", {**body, "links": [{"url": "javascript:alert(1)"}]})[0] == 400
        # null은 비우기
        cleared = call(ctx, "owner", "PATCH", f"/boards/{bid}/cards/{card['id']}", {"assignee": None, "due": None})[1]
        assert "assignee" not in cleared and "due" not in cleared
        # 라벨을 지우면 카드에서도 빠진다
        call(ctx, "owner", "PATCH", f"/boards/{bid}", {"labels": [{"id": "l2", "color": "blue"}]})
        assert call(ctx, "owner", "GET", f"/boards/{bid}")[1]["cards"][0]["labels"] == ["l2"]

    def test_columns(self, ctx: FakeContext) -> None:
        bid, cols = new_board(ctx)
        new = call(ctx, "owner", "POST", f"/boards/{bid}/columns", {"name": "검토"})[1]
        assert new["order"] == 4
        call(ctx, "owner", "PATCH", f"/boards/{bid}/columns/{new['id']}", {"order": 1.5, "name": "리뷰"})
        names = [c["name"] for c in call(ctx, "owner", "GET", f"/boards/{bid}")[1]["columns"]]
        assert names == ["할 일", "리뷰", "진행 중", "완료"]
        call(ctx, "owner", "POST", f"/boards/{bid}/cards", {"title": "A", "columnId": new["id"]})
        assert call(ctx, "owner", "DELETE", f"/boards/{bid}/columns/{new['id']}")[0] == 400
        assert call(ctx, "owner", "DELETE", f"/boards/{bid}/columns/{cols[1]['id']}")[0] == 200

    def test_leave_remove_and_delete(self, ctx: FakeContext) -> None:
        bid, cols = new_board(ctx)
        call(ctx, "owner", "POST", f"/boards/{bid}/members", {"sub": "ed", "role": "editor"})
        card = call(ctx, "ed", "POST", f"/boards/{bid}/cards", {"title": "A", "columnId": cols[0]["id"], "assignee": "ed"})[1]
        # 스스로 나가면 담당자도 비워진다
        assert call(ctx, "ed", "DELETE", f"/boards/{bid}/members/ed")[0] == 200
        assert "assignee" not in call(ctx, "owner", "GET", f"/boards/{bid}")[1]["cards"][0]
        assert card["createdBy"] == "ed"
        assert call(ctx, "owner", "DELETE", f"/boards/{bid}/members/owner")[0] == 400
        # 보드 삭제는 소유자만, 삭제하면 멤버 목록에서도 사라진다
        call(ctx, "owner", "POST", f"/boards/{bid}/members", {"sub": "ed", "role": "editor"})
        assert call(ctx, "ed", "DELETE", f"/boards/{bid}")[0] == 403
        assert call(ctx, "owner", "DELETE", f"/boards/{bid}")[0] == 200
        assert call(ctx, "ed", "GET", "/boards")[1]["boards"] == []

    def test_module_permission_required(self, ctx: FakeContext) -> None:
        assert call(ctx, "none", "GET", "/boards")[0] == 403
        assert call(ctx, "vw", "POST", "/boards", {"name": "x"})[0] == 403
