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


OCT = {"from": "2026-10-01", "to": "2026-10-31"}


@pytest.fixture
def member() -> None:
    users.create_profile("m1", "m@x.com", "Member", "", Status.ACTIVE, Role.MEMBER)
    users.set_perms("m1", {Module.HEALTH: Level.EDIT})


@pytest.mark.usefixtures("aws", "member")
class TestRuns:
    def test_pace_and_kcal_from_latest_weight(self, ctx: FakeContext) -> None:
        call(ctx, "PUT", "/weights/2026-09-28", {"weight": 70})
        status, run = call(ctx, "POST", "/runs", {"date": "2026-10-01", "distanceKm": 5, "durationSec": 1500, "type": "easy", "effort": 4})
        assert status == 200
        assert run["paceSecPerKm"] == 300  # 5:00/km
        assert (run["kcal"], run["kcalEstimated"]) == (362.6, True)  # 70 × 5 × 1.036

    def test_no_weight_no_estimate_and_manual_kcal(self, ctx: FakeContext) -> None:
        _, run = call(ctx, "POST", "/runs", {"date": "2026-10-01", "distanceKm": 3, "durationSec": 1200})
        assert "kcal" not in run and run["kcalEstimated"] is False
        _, run2 = call(ctx, "POST", "/runs", {"date": "2026-10-02", "distanceKm": 3, "durationSec": 1200, "kcal": 250})
        assert (run2["kcal"], run2["kcalEstimated"]) == (250, False)

    def test_move_delete_and_range(self, ctx: FakeContext) -> None:
        _, run = call(ctx, "POST", "/runs", {"date": "2026-10-01", "distanceKm": 5, "durationSec": 1500})
        body = {"date": "2026-10-03", "distanceKm": 6, "durationSec": 1800, "type": "tempo"}
        assert call(ctx, "PUT", f"/runs/{run['id']}", body, query={"date": "2026-10-01"})[1]["date"] == "2026-10-03"
        runs = call(ctx, "GET", "/runs", query=OCT)[1]["runs"]
        assert [(r["date"], r["type"]) for r in runs] == [("2026-10-03", "tempo")]
        assert call(ctx, "DELETE", f"/runs/{run['id']}", query={"date": "2026-10-01"})[0] == 404
        assert call(ctx, "DELETE", f"/runs/{run['id']}", query={"date": "2026-10-03"})[0] == 200

    def test_best_paces(self, ctx: FakeContext) -> None:
        for d, km, sec in [("2026-10-01", 5, 1500), ("2026-10-02", 5.2, 1404), ("2026-10-03", 10, 3300), ("2026-10-04", 3, 600)]:
            call(ctx, "POST", "/runs", {"date": d, "distanceKm": km, "durationSec": sec})
        records = call(ctx, "GET", "/runs/records")[1]
        assert records["best5k"]["date"] == "2026-10-02"  # 3km는 5K 기록 아님
        assert records["best10k"]["date"] == "2026-10-03"

    @pytest.mark.parametrize("body", [{"date": "2026-10-01", "distanceKm": 0, "durationSec": 60}, {"date": "2026-10-01", "distanceKm": 5, "durationSec": 60, "effort": 11}, {"date": "2026-10-01", "distanceKm": 5, "durationSec": 60, "type": "sprint"}])
    def test_rejects_invalid(self, ctx: FakeContext, body: dict[str, Any]) -> None:
        assert call(ctx, "POST", "/runs", body)[0] == 400


@pytest.mark.usefixtures("aws", "member")
class TestGym:
    def session(self, ctx: FakeContext, day: str, bench: float) -> dict[str, Any]:
        body = {
            "date": day,
            "title": "상체 A",
            "exercises": [{"name": "벤치프레스", "sets": [{"reps": 8, "weight": bench}, {"reps": 6, "weight": bench + 5}]}, {"name": "푸시업", "sets": [{"reps": 20}]}],
        }
        status, s = call(ctx, "POST", "/gym", body)
        assert status == 200
        return s

    def test_last_sets_and_progress(self, ctx: FakeContext) -> None:
        self.session(ctx, "2026-10-01", 60)
        self.session(ctx, "2026-10-05", 62.5)
        last = call(ctx, "GET", "/gym/last", query={"names": "벤치프레스,스쿼트"})[1]["last"]
        assert last["벤치프레스"]["date"] == "2026-10-05" and last["벤치프레스"]["sets"][1]["weight"] == 67.5
        assert "스쿼트" not in last
        points = call(ctx, "GET", "/gym/progress", query={"name": "벤치프레스"})[1]["points"]
        assert [(p["date"], p["maxWeight"]) for p in points] == [("2026-10-01", 65), ("2026-10-05", 67.5)]
        assert len(call(ctx, "GET", "/gym", query=OCT)[1]["sessions"]) == 2

    def test_update_delete(self, ctx: FakeContext) -> None:
        s = self.session(ctx, "2026-10-01", 60)
        body = {"date": "2026-10-02", "title": "상체 A", "kcal": 200, "exercises": [{"name": "벤치프레스", "sets": [{"reps": 5, "weight": 70}]}]}
        assert call(ctx, "PUT", f"/gym/{s['id']}", body, query={"date": "2026-10-01"})[1]["kcal"] == 200
        assert call(ctx, "DELETE", f"/gym/{s['id']}", query={"date": "2026-10-02"})[0] == 200
        assert call(ctx, "POST", "/gym", {"date": "2026-10-01", "title": "x", "exercises": []})[0] == 400

    def test_routines(self, ctx: FakeContext) -> None:
        _, r = call(ctx, "POST", "/routines", {"name": "상체 A", "exercises": [{"name": "벤치프레스", "sets": 4}, {"name": "풀업"}]})
        assert r["exercises"][1]["sets"] == 3
        assert call(ctx, "PUT", f"/routines/{r['id']}", {"name": "상체 B", "exercises": [{"name": "딥스"}]})[1]["name"] == "상체 B"
        assert [x["name"] for x in call(ctx, "GET", "/routines")[1]["routines"]] == ["상체 B"]
        assert call(ctx, "DELETE", f"/routines/{r['id']}")[0] == 200


@pytest.mark.usefixtures("aws", "member")
class TestPrograms:
    PLAN = {
        "name": "10K 준비",
        "startDate": "2026-10-01",
        "weeks": 4,
        "items": [{"week": 1, "weekday": 2, "kind": "run", "title": "이지런 5km"}, {"week": 1, "weekday": 4, "kind": "other", "title": "스트레칭"}],
    }

    def test_only_one_active(self, ctx: FakeContext) -> None:
        _, a = call(ctx, "POST", "/programs", self.PLAN)
        _, b = call(ctx, "POST", "/programs", {**self.PLAN, "name": "근력"})
        programs = {p["id"]: p for p in call(ctx, "GET", "/programs")[1]["programs"]}
        assert programs[a["id"]]["active"] is False and programs[b["id"]]["active"] is True

    def test_manual_done_and_validation(self, ctx: FakeContext) -> None:
        _, p = call(ctx, "POST", "/programs", self.PLAN)
        assert call(ctx, "PATCH", f"/programs/{p['id']}/done", {"date": "2026-10-01", "done": True})[1]["manualDone"] == ["2026-10-01"]
        assert call(ctx, "PATCH", f"/programs/{p['id']}/done", {"date": "2026-10-01", "done": False})[1]["manualDone"] == []
        # 수정해도 직접 체크한 기록은 유지
        call(ctx, "PATCH", f"/programs/{p['id']}/done", {"date": "2026-10-01", "done": True})
        assert call(ctx, "PUT", f"/programs/{p['id']}", {**self.PLAN, "name": "10K"})[1]["manualDone"] == ["2026-10-01"]
        bad = {**self.PLAN, "items": [{"week": 9, "weekday": 1, "kind": "run", "title": "x"}]}
        assert call(ctx, "POST", "/programs", bad)[0] == 400
