"""Phase 6b: 즐겨찾기·내 담당 카드·템플릿·보관·활동 기록·댓글"""

from typing import Any

import pytest

from tests.conftest import FakeContext
from tests.test_boards import call, new_board, people  # noqa: F401  (fixture 재사용)


def card(ctx: FakeContext, bid: str, col: str, title: str, **extra: Any) -> dict[str, Any]:
    status, body = call(ctx, "owner", "POST", f"/boards/{bid}/cards", {"title": title, "columnId": col, **extra})
    assert status == 200, body
    return body


@pytest.mark.usefixtures("aws", "people")
class TestBoardExtras:
    def test_favorite_is_per_member(self, ctx: FakeContext) -> None:
        bid, _ = new_board(ctx)
        call(ctx, "owner", "POST", f"/boards/{bid}/members", {"sub": "ed", "role": "editor"})
        assert call(ctx, "owner", "PUT", f"/boards/{bid}/favorite", {"favorite": True})[1] == {"favorite": True}
        assert call(ctx, "owner", "GET", "/boards")[1]["boards"][0]["favorite"] is True
        assert call(ctx, "ed", "GET", "/boards")[1]["boards"][0]["favorite"] is False
        assert call(ctx, "owner", "GET", f"/boards/{bid}")[1]["favorite"] is True

    def test_my_cards_excludes_done_and_others(self, ctx: FakeContext) -> None:
        bid, cols = new_board(ctx)
        card(ctx, bid, cols[0]["id"], "나중", assignee="owner", due="2026-10-20")
        card(ctx, bid, cols[1]["id"], "급함", assignee="owner", due="2026-10-03")
        card(ctx, bid, cols[2]["id"], "끝남", assignee="owner")
        card(ctx, bid, cols[0]["id"], "담당 없음")
        res = call(ctx, "owner", "GET", "/boards")[1]
        assert [(c["title"], c["columnName"]) for c in res["myCards"]] == [("급함", "진행 중"), ("나중", "할 일")]
        assert res["boards"][0]["activeCount"] == 3

    def test_templates(self, ctx: FakeContext) -> None:
        bid, cols = new_board(ctx)
        call(ctx, "owner", "POST", f"/boards/{bid}/columns", {"name": "검토"})
        call(ctx, "owner", "PATCH", f"/boards/{bid}", {"labels": [{"id": "l1", "name": "버그", "color": "red"}]})
        tpl = call(ctx, "owner", "POST", "/boards/templates", {"name": "개발", "boardId": bid})[1]
        assert [c["name"] for c in tpl["columns"]] == ["할 일", "진행 중", "완료", "검토"]
        assert call(ctx, "owner", "GET", "/boards/templates")[1]["templates"][0]["id"] == tpl["id"]
        # 템플릿은 개인 것: 다른 사람 목록에는 없음, 멤버가 아닌 보드로는 못 만듦
        assert call(ctx, "ed", "GET", "/boards/templates")[1]["templates"] == []
        assert call(ctx, "ed", "POST", "/boards/templates", {"name": "x", "boardId": bid})[0] == 404
        new_id = call(ctx, "owner", "POST", "/boards", {"name": "새 보드", "templateId": tpl["id"]})[1]["id"]
        detail = call(ctx, "owner", "GET", f"/boards/{new_id}")[1]
        assert [(c["name"], c["done"]) for c in detail["columns"]] == [("할 일", False), ("진행 중", False), ("완료", True), ("검토", False)]
        assert detail["board"]["labels"][0]["name"] == "버그"
        assert call(ctx, "owner", "DELETE", f"/boards/templates/{tpl['id']}")[0] == 200
        assert call(ctx, "owner", "POST", "/boards", {"name": "x", "templateId": tpl["id"]})[0] == 404

    def test_archive_done_and_restore(self, ctx: FakeContext) -> None:
        bid, cols = new_board(ctx)
        card(ctx, bid, cols[0]["id"], "진행")
        a = card(ctx, bid, cols[2]["id"], "완료1")
        card(ctx, bid, cols[2]["id"], "완료2")
        assert call(ctx, "owner", "POST", f"/boards/{bid}/archive-done")[1] == {"archived": 2}
        detail = call(ctx, "owner", "GET", f"/boards/{bid}")[1]
        assert [c["title"] for c in detail["cards"]] == ["진행"]
        assert (detail["archivedCount"], detail["progress"]) == (2, {"done": 0, "total": 1})
        assert len(call(ctx, "owner", "GET", f"/boards/{bid}/archived")[1]["cards"]) == 2
        # 복구하면 원래 컬럼 맨 아래로
        restored = call(ctx, "owner", "PATCH", f"/boards/{bid}/cards/{a['id']}", {"archived": False})[1]
        assert "archived" not in restored and restored["columnId"] == cols[2]["id"]
        # 원래 컬럼이 없어졌으면 첫 컬럼으로
        b = card(ctx, bid, cols[1]["id"], "옮길 것")
        call(ctx, "owner", "PATCH", f"/boards/{bid}/cards/{b['id']}", {"archived": True})
        assert call(ctx, "owner", "DELETE", f"/boards/{bid}/columns/{cols[1]['id']}")[0] == 200
        assert call(ctx, "owner", "PATCH", f"/boards/{bid}/cards/{b['id']}", {"archived": False})[1]["columnId"] == cols[0]["id"]

    def test_activity_per_card(self, ctx: FakeContext) -> None:
        bid, cols = new_board(ctx)
        a = card(ctx, bid, cols[0]["id"], "A")
        b = card(ctx, bid, cols[0]["id"], "B")
        call(ctx, "owner", "PATCH", f"/boards/{bid}/cards/{a['id']}", {"columnId": cols[1]["id"], "order": 1, "assignee": "owner"})
        call(ctx, "owner", "PATCH", f"/boards/{bid}/cards/{a['id']}", {"order": 5})  # 같은 컬럼 순서 변경은 기록 안 함
        call(ctx, "owner", "PATCH", f"/boards/{bid}/cards/{a['id']}", {"checklist": [{"id": "c1", "text": "x", "done": True}]})
        acts = call(ctx, "owner", "GET", f"/boards/{bid}/activity", query={"cardId": a["id"]})[1]["activity"]
        assert [x["action"] for x in acts] == ["checklist", "assigned", "moved", "created"]
        moved = acts[2]
        assert (moved["from"], moved["to"], moved["actor"]) == ("할 일", "진행 중", "owner")
        assert acts[0]["to"] == "1/1"
        call(ctx, "owner", "DELETE", f"/boards/{bid}/cards/{b['id']}")
        all_acts = call(ctx, "owner", "GET", f"/boards/{bid}/activity")[1]["activity"]
        assert (all_acts[0]["action"], all_acts[0]["cardTitle"]) == ("deleted", "B")

    def test_comments(self, ctx: FakeContext) -> None:
        bid, cols = new_board(ctx)
        call(ctx, "owner", "POST", f"/boards/{bid}/members", {"sub": "ed", "role": "editor"})
        call(ctx, "owner", "POST", f"/boards/{bid}/members", {"sub": "vw", "role": "viewer"})
        a = card(ctx, bid, cols[0]["id"], "A")
        base = f"/boards/{bid}/cards/{a['id']}/comments"
        mine = call(ctx, "ed", "POST", base, {"text": "확인했어요"})[1]
        theirs = call(ctx, "owner", "POST", base, {"text": "좋아요"})[1]
        assert [c["text"] for c in call(ctx, "vw", "GET", base)[1]["comments"]] == ["확인했어요", "좋아요"]
        assert call(ctx, "vw", "POST", base, {"text": "열람자"})[0] == 403
        assert call(ctx, "ed", "POST", base, {"text": "   "})[0] == 400
        # 남의 댓글은 소유자만 지운다
        assert call(ctx, "ed", "DELETE", f"{base}/{theirs['id']}")[0] == 403
        assert call(ctx, "owner", "DELETE", f"{base}/{mine['id']}")[0] == 200
        # 카드를 지우면 댓글도 지워지고 카드 목록에 섞이지 않는다
        assert len(call(ctx, "owner", "GET", f"/boards/{bid}")[1]["cards"]) == 1
        call(ctx, "owner", "DELETE", f"/boards/{bid}/cards/{a['id']}")
        assert call(ctx, "owner", "GET", base)[1]["comments"] == []
