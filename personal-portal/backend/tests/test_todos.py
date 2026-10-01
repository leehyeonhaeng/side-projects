import json
from typing import Any

import pytest

from common import users
from common.perms import Level, Module, Role, Status
from handlers import personal
from tests.conftest import FakeContext, http_event


def call(ctx: FakeContext, method: str, path: str, body: dict[str, Any] | None = None, query: dict[str, str] | None = None) -> tuple[int, Any]:
    raw = json.dumps(body) if body is not None else None
    res = personal.lambda_handler(http_event(method, f"/api/v1{path}", sub="m1", body=raw, query=query), ctx)
    return res["statusCode"], json.loads(res["body"])


@pytest.fixture
def member() -> None:
    users.create_profile("m1", "m@x.com", "Member", "", Status.ACTIVE, Role.MEMBER)
    users.set_perms("m1", {Module.TODO: Level.EDIT})


@pytest.mark.usefixtures("aws", "member")
class TestTodos:
    def test_create_list_and_defaults(self, ctx: FakeContext) -> None:
        status, todo = call(ctx, "POST", "/todos", {"title": "  우유 사기 ", "due": "2026-10-01"})
        assert status == 200
        assert (todo["title"], todo["priority"], todo["done"], todo["subtasks"]) == ("우유 사기", "normal", False, [])
        assert isinstance(todo["order"], float)
        assert [t["id"] for t in call(ctx, "GET", "/todos")[1]["todos"]] == [todo["id"]]

    @pytest.mark.parametrize(
        "body",
        [
            {"title": ""},
            {"title": "x", "dueTime": "09:00"},  # 시간만 있고 날짜 없음
            {"title": "x", "repeat": {"freq": "daily"}},  # 반복인데 마감일 없음
            {"title": "x", "due": "2026-10-01", "repeat": {"freq": "weekly"}},  # 요일 없음
            {"title": "x", "priority": "urgent"},
            {"title": "x", "dueTime": "25:00", "due": "2026-10-01"},
        ],
    )
    def test_rejects_invalid(self, ctx: FakeContext, body: dict[str, Any]) -> None:
        assert call(ctx, "POST", "/todos", body)[0] == 400

    def test_complete_repeating_creates_next(self, ctx: FakeContext) -> None:
        _, todo = call(ctx, "POST", "/todos", {
            "title": "운동", "due": "2026-10-01", "dueTime": "07:00", "repeat": {"freq": "weekly", "weekdays": [4, 1]},
            "subtasks": [{"id": "s1", "text": "스트레칭", "done": True}],
        })
        assert todo["repeat"]["weekdays"] == [1, 4]

        status, res = call(ctx, "PATCH", f"/todos/{todo['id']}", {"done": True})
        assert status == 200
        assert res["todo"]["done"] is True and "repeat" not in res["todo"]
        nxt = res["next"]
        assert (nxt["due"], nxt["dueTime"], nxt["done"]) == ("2026-10-05", "07:00", False)
        assert nxt["repeat"] == {"freq": "weekly", "weekdays": [1, 4]}
        assert nxt["subtasks"] == [{"id": "s1", "text": "스트레칭", "done": False}]

        # 이미 완료한 걸 다시 완료해도 회차가 또 생기지 않는다
        assert call(ctx, "PATCH", f"/todos/{todo['id']}", {"done": True})[1]["next"] is None
        assert len(call(ctx, "GET", "/todos", query={"status": "open"})[1]["todos"]) == 1
        assert len(call(ctx, "GET", "/todos", query={"status": "done"})[1]["todos"]) == 1

    def test_monthly_keeps_original_day(self, ctx: FakeContext) -> None:
        _, todo = call(ctx, "POST", "/todos", {"title": "월세", "due": "2026-01-31", "repeat": {"freq": "monthly"}})
        nxt = call(ctx, "PATCH", f"/todos/{todo['id']}", {"done": True})[1]["next"]
        assert nxt["due"] == "2026-02-28"
        nxt2 = call(ctx, "PATCH", f"/todos/{nxt['id']}", {"done": True})[1]["next"]
        assert nxt2["due"] == "2026-03-31"

    def test_restore_and_clear_fields(self, ctx: FakeContext) -> None:
        _, todo = call(ctx, "POST", "/todos", {"title": "a", "due": "2026-10-01", "dueTime": "09:00"})
        call(ctx, "PATCH", f"/todos/{todo['id']}", {"done": True})
        restored = call(ctx, "PATCH", f"/todos/{todo['id']}", {"done": False})[1]["todo"]
        assert restored["done"] is False and "doneAt" not in restored
        # dueTime을 남긴 채 due만 지우면 거부, 둘 다 지우면 허용
        assert call(ctx, "PATCH", f"/todos/{todo['id']}", {"due": None})[0] == 400
        cleared = call(ctx, "PATCH", f"/todos/{todo['id']}", {"due": None, "dueTime": None})[1]["todo"]
        assert "due" not in cleared

    def test_due_range_for_calendar(self, ctx: FakeContext) -> None:
        call(ctx, "POST", "/todos", {"title": "in", "due": "2026-10-15"})
        call(ctx, "POST", "/todos", {"title": "out", "due": "2026-11-15"})
        call(ctx, "POST", "/todos", {"title": "nodue"})
        _, res = call(ctx, "GET", "/todos/due", query={"from": "2026-10-01", "to": "2026-10-31"})
        assert [t["title"] for t in res["todos"]] == ["in"]
        assert call(ctx, "GET", "/todos/due", query={"from": "2026-10-01", "to": "2027-10-31"})[0] == 400

    def test_lists_and_delete_list_keeps_todos(self, ctx: FakeContext) -> None:
        _, lst = call(ctx, "POST", "/todo-lists", {"name": "장보기"})
        _, todo = call(ctx, "POST", "/todos", {"title": "a", "listId": lst["id"]})
        assert call(ctx, "GET", "/todo-lists")[1]["lists"][0]["name"] == "장보기"
        assert call(ctx, "PATCH", f"/todo-lists/{lst['id']}", {"name": "마트"})[0] == 200
        assert call(ctx, "PATCH", "/todo-lists/nope", {"name": "x"})[0] == 404
        call(ctx, "DELETE", f"/todo-lists/{lst['id']}")
        remaining = call(ctx, "GET", "/todos")[1]["todos"]
        assert [t["id"] for t in remaining] == [todo["id"]] and "listId" not in remaining[0]

    def test_view_permission_cannot_write(self, ctx: FakeContext) -> None:
        users.set_perms("m1", {Module.TODO: Level.VIEW})
        assert call(ctx, "GET", "/todos")[0] == 200
        assert call(ctx, "POST", "/todos", {"title": "a"})[0] == 403


def test_projected_occurrences() -> None:
    from datetime import date

    from domains.todos import projected_between

    todos = [
        {"id": "w", "title": "주간", "due": "2026-10-01", "done": False, "repeat": {"freq": "weekly", "weekdays": [3]}},  # 목 → 매주 수
        {"id": "d", "title": "완료됨", "due": "2026-10-01", "done": True, "repeat": {"freq": "daily"}},
        {"id": "n", "title": "반복 없음", "due": "2026-10-01", "done": False},
        {"id": "old", "title": "밀린 매일", "due": "2026-09-20", "done": False, "repeat": {"freq": "daily"}},
    ]
    got = projected_between(todos, date(2026, 10, 1), date(2026, 10, 21), today=date(2026, 10, 19))
    by_id: dict[str, list[str]] = {}
    for p in got:
        by_id.setdefault(p["todoId"], []).append(p["due"])
    # 오늘(10/19) 이전 회차는 미리보기에서 뺀다
    assert by_id["w"] == ["2026-10-21"]
    assert by_id["old"] == ["2026-10-19", "2026-10-20", "2026-10-21"]
    assert "d" not in by_id and "n" not in by_id
