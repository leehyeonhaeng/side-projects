import json
from typing import Any

import pytest

from common import users
from common.perms import Role, Status
from handlers import personal
from tests.conftest import FakeContext, http_event


def call(ctx: FakeContext, method: str, path: str, body: dict[str, Any] | None = None, sub: str = "m1") -> tuple[int, Any]:
    raw = json.dumps(body) if body is not None else None
    res = personal.lambda_handler(http_event(method, f"/api/v1{path}", sub=sub, body=raw), ctx)
    return res["statusCode"], json.loads(res["body"])


def item(id_: str, kind: str = "widget", x: int = 0, y: int = 0, w: int = 2, h: int = 1, **extra: Any) -> dict[str, Any]:
    base: dict[str, Any] = {"id": id_, "kind": kind, "module": "todo", "x": x, "y": y, "w": w, "h": h}
    if kind == "widget":
        base["widget"] = "todo"
    return {**base, **extra}


def layout(*items: dict[str, Any]) -> dict[str, Any]:
    return {"version": 1, "sections": [{"id": "work", "name": "업무", "items": list(items)}]}


@pytest.fixture
def member() -> None:
    users.create_profile("m1", "m@x.com", "Member", "", Status.ACTIVE, Role.MEMBER)


@pytest.mark.usefixtures("aws", "member")
class TestLayout:
    def test_empty_layout(self, ctx: FakeContext) -> None:
        assert call(ctx, "GET", "/layout") == (200, {"layout": None, "updatedAt": None})

    def test_round_trip_keeps_numbers(self, ctx: FakeContext) -> None:
        body = layout(item("a", w=2, h=2), item("b", kind="icon", x=2, y=0, w=1, h=1, hidden=True))
        status, saved = call(ctx, "PUT", "/layout", body)
        assert status == 200
        status, loaded = call(ctx, "GET", "/layout")
        assert status == 200
        assert loaded["updatedAt"] == saved["updatedAt"]
        first = loaded["layout"]["sections"][0]["items"][0]
        assert (first["w"], first["h"]) == (2, 2)
        assert isinstance(first["x"], int)
        assert loaded["layout"]["sections"][0]["items"][1]["hidden"] is True

    @pytest.mark.parametrize(
        "bad",
        [
            item("a", w=1, h=2),  # 1×2는 없는 크기
            item("a", kind="icon", w=2, h=1),  # 아이콘은 1×1만
            item("a", x=3, w=2),  # 4칸을 넘침
            {**item("a"), "widget": None},  # 위젯 종류 누락
            {**item("a"), "module": "nope"},
            {**item("a"), "extra": 1},
        ],
    )
    def test_rejects_invalid_items(self, ctx: FakeContext, bad: dict[str, Any]) -> None:
        assert call(ctx, "PUT", "/layout", layout(bad))[0] == 400

    def test_rejects_duplicate_ids(self, ctx: FakeContext) -> None:
        assert call(ctx, "PUT", "/layout", layout(item("a"), item("a", y=1)))[0] == 400

    def test_layout_is_per_user(self, ctx: FakeContext) -> None:
        users.create_profile("m2", "m2@x.com", "Other", "", Status.ACTIVE, Role.MEMBER)
        call(ctx, "PUT", "/layout", layout(item("a")))
        assert call(ctx, "GET", "/layout", sub="m2")[1]["layout"] is None


@pytest.mark.usefixtures("aws", "member")
class TestSettingsAndProfile:
    def test_settings_default_and_patch(self, ctx: FakeContext) -> None:
        empty_goals = {"goalKcal": None, "goalCarb": None, "goalProtein": None, "goalFat": None, "goalWeight": None}
        assert call(ctx, "GET", "/settings") == (200, {"theme": "system", **empty_goals})
        assert call(ctx, "PATCH", "/settings", {"theme": "dark"})[1]["theme"] == "dark"
        assert call(ctx, "GET", "/settings")[1]["theme"] == "dark"
        assert call(ctx, "PATCH", "/settings", {"theme": "pink"})[0] == 400

    def test_goals_set_and_clear(self, ctx: FakeContext) -> None:
        _, s = call(ctx, "PATCH", "/settings", {"goalKcal": 2000, "goalProtein": 120})
        assert (s["goalKcal"], s["goalProtein"], s["theme"]) == (2000, 120, "system")
        # 다른 필드만 바꿔도 목표치는 유지, null이면 미설정으로
        assert call(ctx, "PATCH", "/settings", {"theme": "light"})[1]["goalKcal"] == 2000
        _, s = call(ctx, "PATCH", "/settings", {"goalKcal": None})
        assert s["goalKcal"] is None and s["goalProtein"] == 120
        assert call(ctx, "GET", "/settings")[1]["goalKcal"] is None
        assert call(ctx, "PATCH", "/settings", {"goalKcal": -1})[0] == 400

    def test_update_name(self, ctx: FakeContext) -> None:
        status, body = call(ctx, "PATCH", "/me", {"name": "  새 이름 "})
        assert (status, body["name"]) == (200, "새 이름")
        assert call(ctx, "PATCH", "/me", {"name": "   "})[0] == 400
        assert call(ctx, "PATCH", "/me", {"name": "x" * 51})[0] == 400
