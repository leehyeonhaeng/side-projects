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
        users.set_perms(sub, {Module.CHECKLISTS: level})


def new_list(ctx: FakeContext, items: list[str] | None = None) -> str:
    lid = call(ctx, "owner", "POST", "/checklists", {"name": "장보기", "icon": "🛒"})[1]["id"]
    if items:
        call(ctx, "owner", "POST", f"/checklists/{lid}/items", {"texts": items})
    return lid


@pytest.mark.usefixtures("aws", "people")
class TestChecklists:
    def test_create_items_and_counts(self, ctx: FakeContext) -> None:
        lid = new_list(ctx, ["우유", " ", "계란", "두부"])
        detail = call(ctx, "owner", "GET", f"/checklists/{lid}")[1]
        assert [i["text"] for i in detail["items"]] == ["우유", "계란", "두부"]  # 빈 줄은 빠지고 추가순
        assert (detail["list"]["icon"], detail["role"]) == ("🛒", "owner")
        lists = call(ctx, "owner", "GET", "/checklists")[1]["lists"]
        assert [(x["remaining"], x["total"], x["memberCount"]) for x in lists] == [(3, 3, 1)]

    def test_check_records_who_and_when(self, ctx: FakeContext) -> None:
        lid = new_list(ctx, ["우유"])
        call(ctx, "owner", "POST", f"/checklists/{lid}/members", {"sub": "ed", "role": "editor"})
        iid = call(ctx, "owner", "GET", f"/checklists/{lid}")[1]["items"][0]["id"]
        checked = call(ctx, "ed", "PATCH", f"/checklists/{lid}/items/{iid}", {"done": True})[1]
        assert checked["done"] is True and checked["doneBy"] == "ed" and "doneAt" in checked
        unchecked = call(ctx, "owner", "PATCH", f"/checklists/{lid}/items/{iid}", {"done": False})[1]
        assert "doneBy" not in unchecked and "doneAt" not in unchecked
        assert call(ctx, "owner", "GET", "/checklists")[1]["lists"][0]["remaining"] == 1

    def test_clear_done_and_uncheck_all(self, ctx: FakeContext) -> None:
        lid = new_list(ctx, ["a", "b", "c"])
        ids = [i["id"] for i in call(ctx, "owner", "GET", f"/checklists/{lid}")[1]["items"]]
        for iid in ids[:2]:
            call(ctx, "owner", "PATCH", f"/checklists/{lid}/items/{iid}", {"done": True})
        assert call(ctx, "owner", "POST", f"/checklists/{lid}/uncheck-all")[1] == {"unchecked": 2}
        items = call(ctx, "owner", "GET", f"/checklists/{lid}")[1]["items"]
        assert all(not i["done"] and "doneBy" not in i for i in items)
        call(ctx, "owner", "PATCH", f"/checklists/{lid}/items/{ids[0]}", {"done": True})
        assert call(ctx, "owner", "POST", f"/checklists/{lid}/clear-done")[1] == {"deleted": 1}
        assert [i["text"] for i in call(ctx, "owner", "GET", f"/checklists/{lid}")[1]["items"]] == ["b", "c"]

    def test_sharing_roles(self, ctx: FakeContext) -> None:
        lid = new_list(ctx, ["a"])
        assert call(ctx, "ed", "GET", f"/checklists/{lid}")[0] == 404
        cands = call(ctx, "owner", "GET", f"/checklists/{lid}/candidates")[1]["candidates"]
        assert sorted(c["sub"] for c in cands) == ["ed", "vw"]
        # 모듈 view 계정은 편집자로 넣어도 열람만
        call(ctx, "owner", "POST", f"/checklists/{lid}/members", {"sub": "vw", "role": "editor"})
        assert call(ctx, "vw", "GET", f"/checklists/{lid}")[1]["role"] == "viewer"
        assert call(ctx, "vw", "POST", f"/checklists/{lid}/items", {"texts": ["x"]})[0] == 403
        # 리스트 열람자는 체크 불가
        call(ctx, "owner", "POST", f"/checklists/{lid}/members", {"sub": "ed", "role": "viewer"})
        iid = call(ctx, "owner", "GET", f"/checklists/{lid}")[1]["items"][0]["id"]
        assert call(ctx, "ed", "PATCH", f"/checklists/{lid}/items/{iid}", {"done": True})[0] == 403
        # 즐겨찾기는 사람마다
        call(ctx, "ed", "PUT", f"/checklists/{lid}/favorite", {"favorite": True})
        assert call(ctx, "ed", "GET", "/checklists")[1]["lists"][0]["favorite"] is True
        assert call(ctx, "owner", "GET", "/checklists")[1]["lists"][0]["favorite"] is False
        # 나가기, 소유자만 삭제
        assert call(ctx, "ed", "DELETE", f"/checklists/{lid}/members/ed")[0] == 200
        assert call(ctx, "vw", "DELETE", f"/checklists/{lid}")[0] == 403
        assert call(ctx, "owner", "DELETE", f"/checklists/{lid}")[0] == 200
        assert call(ctx, "vw", "GET", "/checklists")[1]["lists"] == []

    def test_templates(self, ctx: FakeContext) -> None:
        lid = new_list(ctx, ["여권", "충전기"])
        empty = new_list(ctx)
        assert call(ctx, "owner", "POST", "/checklists/templates", {"name": "빈 것", "listId": empty})[0] == 400
        tpl = call(ctx, "owner", "POST", "/checklists/templates", {"name": "여행 준비물", "listId": lid})[1]
        assert (tpl["items"], tpl["icon"]) == (["여권", "충전기"], "🛒")
        assert call(ctx, "ed", "GET", "/checklists/templates")[1]["templates"] == []
        new_id = call(ctx, "owner", "POST", "/checklists", {"name": "제주 여행", "icon": "✈️", "templateId": tpl["id"]})[1]["id"]
        assert [i["text"] for i in call(ctx, "owner", "GET", f"/checklists/{new_id}")[1]["items"]] == ["여권", "충전기"]
        assert call(ctx, "owner", "DELETE", f"/checklists/templates/{tpl['id']}")[0] == 200

    def test_module_permission(self, ctx: FakeContext) -> None:
        assert call(ctx, "none", "GET", "/checklists")[0] == 403
        assert call(ctx, "vw", "POST", "/checklists", {"name": "x"})[0] == 403
