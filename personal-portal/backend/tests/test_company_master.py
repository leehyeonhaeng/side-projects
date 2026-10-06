import json
from typing import Any

import pytest

from common import users
from common.perms import Role, Status
from handlers import company
from tests.conftest import FakeContext, http_event


def call(ctx: FakeContext, sub: str, method: str, path: str, body: dict[str, Any] | None = None) -> tuple[int, Any]:
    raw = json.dumps(body) if body is not None else None
    res = company.lambda_handler(http_event(method, f"/api/v1{path}", sub=sub, groups="[host]" if sub == "h1" else "", body=raw), ctx)
    return res["statusCode"], json.loads(res["body"])


@pytest.fixture
def cid(aws: Any, ctx: FakeContext) -> str:
    users.create_profile("h1", "h@x.com", "호스트", "", Status.ACTIVE, Role.HOST)
    users.create_profile("f1", "f@x.com", "기사", "", Status.ACTIVE, Role.MEMBER)
    cid = call(ctx, "h1", "POST", "/company", {"name": "행컴퍼니"})[1]["id"]
    code = call(ctx, "h1", "POST", f"/company/{cid}/invites", {"roleId": "field"})[1]["code"]
    assert call(ctx, "f1", "POST", f"/company/invites/{code}/accept")[0] == 200
    return cid


def model(ctx: FakeContext, cid: str, name: str = "컬러복합기 X1", **extra: Any) -> dict[str, Any]:
    status, body = call(ctx, "h1", "POST", f"/company/{cid}/items", {"name": name, "tracking": "asset", "category": "복합기", "price": 3_000_000, "rentPrice": 80_000, **extra})
    assert status == 200, body
    return body


class TestPartners:
    def test_crud_dedupe_and_redaction(self, ctx: FakeContext, cid: str) -> None:
        p = call(ctx, "h1", "POST", f"/company/{cid}/partners", {"name": "서울초등학교", "phone": "02-111-2222"})[1]
        assert (p["kind"], p["receivable"], p["active"]) == ("customer", 0, True)
        assert call(ctx, "h1", "POST", f"/company/{cid}/partners", {"name": "서울초등학교"})[0] == 400
        # 현장 기사: 보기만, 잔액 숨김
        seen = call(ctx, "f1", "GET", f"/company/{cid}/partners")[1]["partners"][0]
        assert "receivable" not in seen and seen["phone"] == "02-111-2222"
        assert call(ctx, "f1", "POST", f"/company/{cid}/partners", {"name": "x"})[0] == 403
        # 사용 안 함
        assert call(ctx, "h1", "PATCH", f"/company/{cid}/partners/{p['id']}", {"active": False})[1]["active"] is False
        assert call(ctx, "h1", "PATCH", f"/company/{cid}/partners/{p['id']}", {"name": None})[0] == 400
        assert call(ctx, "h1", "DELETE", f"/company/{cid}/partners/{p['id']}")[0] == 200


class TestItemsAndAssets:
    def test_item_tracking_rules(self, ctx: FakeContext, cid: str) -> None:
        m = model(ctx, cid)
        assert m["unit"] == "대" and m["assetCounts"] == {"in_stock": 0, "rented": 0, "repair": 0, "retired": 0}
        assert call(ctx, "h1", "POST", f"/company/{cid}/items", {"name": "x", "tracking": "asset", "openingQty": 3})[0] == 400
        toner = call(ctx, "h1", "POST", f"/company/{cid}/items", {"name": "X1 토너 검정", "tracking": "stock", "openingQty": 12, "minStock": 5, "rentPrice": 1, "compatibleWith": [m["id"]]})[1]
        assert (toner["qty"], toner["minStock"], toner["compatibleWith"], toner["unit"]) == (12, 5, [m["id"]], "개")
        assert "rentPrice" not in toner
        # 호환 기종은 개체 품목만
        assert call(ctx, "h1", "POST", f"/company/{cid}/items", {"name": "y", "tracking": "stock", "compatibleWith": [toner["id"]]})[0] == 400
        # 수량은 PATCH로 못 바꿈 (모르는 필드)
        assert call(ctx, "h1", "PATCH", f"/company/{cid}/items/{toner['id']}", {"qty": 100})[0] == 400
        # 금액 숨김 직원: 품목 금액 안 보임
        seen = {i["id"]: i for i in call(ctx, "f1", "GET", f"/company/{cid}/items")[1]["items"]}
        assert "price" not in seen[m["id"]] and "rentPrice" not in seen[m["id"]]

    def test_register_assets_codes_and_serials(self, ctx: FakeContext, cid: str) -> None:
        m = model(ctx, cid)
        call(ctx, "h1", "PATCH", f"/company/{cid}", {"assetPrefix": "HC"})
        res = call(ctx, "h1", "POST", f"/company/{cid}/assets", {"itemId": m["id"], "count": 3, "serials": ["SN1", "SN2"], "cost": 2_000_000})[1]["assets"]
        assert [a["code"] for a in res] == ["HC-000001", "HC-000002", "HC-000003"]
        assert [a["serial"] for a in res] == ["SN1", "SN2", ""] and res[0]["itemName"] == "컬러복합기 X1"
        more = call(ctx, "h1", "POST", f"/company/{cid}/assets", {"itemId": m["id"], "count": 1})[1]["assets"]
        assert more[0]["code"] == "HC-000004"
        # 제조번호 중복, 수량 품목, 금액 숨김 직원의 매입가 입력
        assert call(ctx, "h1", "POST", f"/company/{cid}/assets", {"itemId": m["id"], "count": 1, "serials": ["SN1"]})[0] == 400
        assert call(ctx, "h1", "POST", f"/company/{cid}/assets", {"itemId": m["id"], "count": 2, "serials": ["Z", "Z"]})[0] == 400
        toner = call(ctx, "h1", "POST", f"/company/{cid}/items", {"name": "토너", "tracking": "stock"})[1]
        assert call(ctx, "h1", "POST", f"/company/{cid}/assets", {"itemId": toner["id"], "count": 1})[0] == 400
        assert call(ctx, "f1", "POST", f"/company/{cid}/assets", {"itemId": m["id"], "count": 1, "cost": 1})[0] == 400
        assert call(ctx, "f1", "POST", f"/company/{cid}/assets", {"itemId": m["id"], "count": 1})[0] == 200
        # 품목 화면의 대수, 기사에게는 매입가 숨김
        counts = {i["id"]: i for i in call(ctx, "h1", "GET", f"/company/{cid}/items")[1]["items"]}[m["id"]]["assetCounts"]
        assert counts["in_stock"] == 5
        assert all("cost" not in a for a in call(ctx, "f1", "GET", f"/company/{cid}/assets")[1]["assets"])

    def test_asset_status_history_and_delete(self, ctx: FakeContext, cid: str) -> None:
        m = model(ctx, cid)
        a, b = call(ctx, "h1", "POST", f"/company/{cid}/assets", {"itemId": m["id"], "count": 2})[1]["assets"]
        # 임대 중은 직접 지정 불가
        assert call(ctx, "h1", "PATCH", f"/company/{cid}/assets/{a['id']}", {"status": "rented"})[0] == 400
        assert call(ctx, "f1", "PATCH", f"/company/{cid}/assets/{a['id']}", {"status": "repair", "location": "수리실"})[1]["status"] == "repair"
        detail = call(ctx, "h1", "GET", f"/company/{cid}/assets/{a['id']}")[1]
        assert [log["action"] for log in detail["logs"]] == ["status", "registered"]
        # 이력이 있으면 삭제 대신 폐기, 갓 등록한 것만 삭제
        assert call(ctx, "h1", "DELETE", f"/company/{cid}/assets/{a['id']}")[0] == 400
        assert call(ctx, "h1", "DELETE", f"/company/{cid}/assets/{b['id']}")[0] == 200
        # 기기가 있는 품목은 삭제 불가
        assert call(ctx, "h1", "DELETE", f"/company/{cid}/items/{m['id']}")[0] == 400


class TestAccounts:
    def test_accounts_money_area(self, ctx: FakeContext, cid: str) -> None:
        acc = call(ctx, "h1", "POST", f"/company/{cid}/accounts", {"name": "국민 주거래", "bank": "국민은행", "number": "123-456", "openingBalance": 5_000_000})[1]
        assert (acc["balance"], acc["kind"]) == (5_000_000, "bank")
        assert call(ctx, "h1", "PATCH", f"/company/{cid}/accounts/{acc['id']}", {"balance": 1})[0] == 400
        assert call(ctx, "h1", "PATCH", f"/company/{cid}/accounts/{acc['id']}", {"memo": "급여 통장"})[1]["memo"] == "급여 통장"
        # 현장 기사는 돈 영역 없음
        assert call(ctx, "f1", "GET", f"/company/{cid}/accounts")[0] == 403
