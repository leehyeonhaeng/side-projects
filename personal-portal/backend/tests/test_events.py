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


def month(ctx: FakeContext, frm: str = "2026-10-01", to: str = "2026-10-31") -> list[dict[str, Any]]:
    status, body = call(ctx, "GET", "/events", query={"from": frm, "to": to})
    assert status == 200
    return body["events"]


@pytest.fixture
def member() -> None:
    users.create_profile("m1", "m@x.com", "Member", "", Status.ACTIVE, Role.MEMBER)
    users.set_perms("m1", {Module.CALENDAR: Level.EDIT})


@pytest.mark.usefixtures("aws", "member")
class TestSingleEvents:
    def test_create_defaults_and_range(self, ctx: FakeContext) -> None:
        _, ev = call(ctx, "POST", "/events", {"title": "회의", "start": "2026-10-05", "allDay": False, "startTime": "10:00"})
        assert (ev["end"], ev["endTime"], ev["color"]) == ("2026-10-05", "10:00", "blue")
        assert [e["title"] for e in month(ctx)] == ["회의"]
        assert month(ctx, "2026-11-01", "2026-11-30") == []

    def test_multi_day_event_overlapping_range_start(self, ctx: FakeContext) -> None:
        call(ctx, "POST", "/events", {"title": "여행", "start": "2026-09-28", "end": "2026-10-02"})
        assert [e["title"] for e in month(ctx)] == ["여행"]

    @pytest.mark.parametrize(
        "body",
        [
            {"title": "x", "start": "2026-10-05", "end": "2026-10-04"},
            {"title": "x", "start": "2026-10-05", "allDay": False},  # 시작 시간 없음
            {"title": "x", "start": "2026-10-05", "allDay": False, "startTime": "10:00", "endTime": "09:00"},
            {"title": "x", "start": "2026-10-01", "end": "2026-12-31"},  # 62일 초과
            {"title": "x", "start": "2026-10-05", "color": "neon"},
        ],
    )
    def test_rejects_invalid(self, ctx: FakeContext, body: dict[str, Any]) -> None:
        assert call(ctx, "POST", "/events", body)[0] == 400

    def test_move_start_keeps_span_and_key(self, ctx: FakeContext) -> None:
        _, ev = call(ctx, "POST", "/events", {"title": "여행", "start": "2026-10-05", "end": "2026-10-07"})
        status, moved = call(ctx, "PATCH", f"/events/{ev['id']}", {"start": "2026-10-10"}, query={"start": "2026-10-05"})
        assert status == 200
        assert (moved["start"], moved["end"]) == ("2026-10-10", "2026-10-12")
        assert [(e["start"], e["title"]) for e in month(ctx)] == [("2026-10-10", "여행")]
        assert call(ctx, "PATCH", f"/events/{ev['id']}", {"title": "x"}, query={"start": "2026-10-05"})[0] == 404
        assert call(ctx, "DELETE", f"/events/{ev['id']}", query={"start": "2026-10-10"})[0] == 200
        assert month(ctx) == []

    def test_search_title_and_memo(self, ctx: FakeContext) -> None:
        call(ctx, "POST", "/events", {"title": "치과", "start": "2026-10-05"})
        call(ctx, "POST", "/events", {"title": "회의", "start": "2026-10-06", "memo": "치과 다음"})
        call(ctx, "POST", "/events", {"title": "운동", "start": "2026-10-07", "repeat": {"freq": "weekly"}})
        assert {e["title"] for e in call(ctx, "GET", "/events/search", query={"q": "치과"})[1]["events"]} == {"치과", "회의"}
        assert [e["title"] for e in call(ctx, "GET", "/events/search", query={"q": "운동"})[1]["events"]] == ["운동"]


@pytest.mark.usefixtures("aws", "member")
class TestRecurringEvents:
    def create_weekly(self, ctx: FakeContext) -> dict[str, Any]:
        # 2026-10-01(목)부터 매주
        return call(ctx, "POST", "/events", {"title": "스터디", "start": "2026-10-01", "allDay": False, "startTime": "20:00", "repeat": {"freq": "weekly"}})[1]

    def test_expands_in_range(self, ctx: FakeContext) -> None:
        series = self.create_weekly(ctx)
        events = month(ctx)
        assert [e["start"] for e in events] == ["2026-10-01", "2026-10-08", "2026-10-15", "2026-10-22", "2026-10-29"]
        assert events[1]["id"] == f"{series['id']}@2026-10-08"
        assert events[1]["seriesId"] == series["id"]

    def test_delete_this_only(self, ctx: FakeContext) -> None:
        series = self.create_weekly(ctx)
        assert call(ctx, "DELETE", f"/event-series/{series['id']}/occurrences/2026-10-08")[0] == 200
        assert "2026-10-08" not in [e["start"] for e in month(ctx)]
        # 회차가 아닌 날짜는 404
        assert call(ctx, "DELETE", f"/event-series/{series['id']}/occurrences/2026-10-09")[0] == 404

    def test_edit_this_only_detaches(self, ctx: FakeContext) -> None:
        series = self.create_weekly(ctx)
        status, single = call(ctx, "PATCH", f"/event-series/{series['id']}/occurrences/2026-10-15", {"startTime": "21:00", "title": "스터디(장소 변경)"})
        assert status == 200
        assert single["seriesId"] == series["id"] and single["start"] == "2026-10-15"
        assert single["endTime"] == "21:00"  # 시작 시간을 옮기면 종료 시간도 같이
        oct15 = [e for e in month(ctx) if e["start"] == "2026-10-15"]
        assert [(e["title"], e["startTime"], e.get("occurrenceDate")) for e in oct15] == [("스터디(장소 변경)", "21:00", None)]

    def test_edit_all_and_until(self, ctx: FakeContext) -> None:
        series = self.create_weekly(ctx)
        call(ctx, "DELETE", f"/event-series/{series['id']}/occurrences/2026-10-08")
        status, updated = call(ctx, "PATCH", f"/event-series/{series['id']}", {"title": "북클럽", "repeat": {"freq": "weekly", "until": "2026-10-15"}})
        assert status == 200 and updated["exdates"] == ["2026-10-08"]
        assert [(e["start"], e["title"]) for e in month(ctx)] == [("2026-10-01", "북클럽"), ("2026-10-15", "북클럽")]
        assert call(ctx, "PATCH", f"/event-series/{series['id']}", {"repeat": None})[0] == 400

    def test_delete_all_removes_detached(self, ctx: FakeContext) -> None:
        series = self.create_weekly(ctx)
        call(ctx, "PATCH", f"/event-series/{series['id']}/occurrences/2026-10-15", {"title": "따로"})
        call(ctx, "POST", "/events", {"title": "다른 일정", "start": "2026-10-20"})
        assert call(ctx, "DELETE", f"/event-series/{series['id']}")[0] == 200
        assert [e["title"] for e in month(ctx)] == ["다른 일정"]

    def test_calendar_permission_required(self, ctx: FakeContext) -> None:
        users.set_perms("m1", {Module.CALENDAR: Level.NONE})
        assert call(ctx, "GET", "/events", query={"from": "2026-10-01", "to": "2026-10-31"})[0] == 403
        assert call(ctx, "DELETE", "/event-series/x")[0] == 403
