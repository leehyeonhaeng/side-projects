"""C8 2단계: 거래처 부서·판매구분 기본값, 고객 장비(번호 직접 입력·자동 번호 건너뛰기), 계약 기기 A3 기본 매수·초과 단가"""

from typing import Any

import pytest

from tests.conftest import FakeContext
from tests.test_company_rental import M1, TODAY, World, call


@pytest.fixture
def w(aws: Any, ctx: FakeContext) -> World:
    return World(ctx)


def test_partner_departments_and_sale_type(w: World) -> None:
    p = w.ok("POST", f"{w.base}/partners", {"name": "충주시청", "saleType": "유지보수", "departments": ["건축과", " 회계과 "]})
    assert (p["saleType"], p["departments"]) == ("유지보수", ["건축과", "회계과"])
    assert call(w.ctx, "h1", "POST", f"{w.base}/partners", {"name": "x", "departments": ["a", "a"]})[0] == 400
    assert call(w.ctx, "h1", "POST", f"{w.base}/partners", {"name": "y", "saleType": "렌탈"})[0] == 400
    p = w.ok("PATCH", f"{w.base}/partners/{p['id']}", {"departments": ["건축과", "회계과", "민원과"]})
    assert p["departments"][-1] == "민원과"


def test_customer_equipment(w: World) -> None:
    city = w.ok("POST", f"{w.base}/partners", {"name": "충주시청", "saleType": "완판", "departments": ["건축과"]})["id"]
    # 번호 직접 입력 (소문자는 대문자로), 판매구분은 거래처 기본값
    a = w.ok("POST", f"{w.base}/assets/customer", {"partnerId": city, "itemId": w.model, "code": "a003", "serial": "SN-9", "department": "건축과"})["asset"]
    assert (a["code"], a["status"], a["saleType"], a["partnerName"], a["department"]) == ("A003", "customer", "완판", "충주시청", "건축과")
    assert call(w.ctx, "h1", "POST", f"{w.base}/assets/customer", {"partnerId": city, "itemId": w.model, "code": "A003"})[0] == 400  # 번호 겹침
    assert call(w.ctx, "h1", "POST", f"{w.base}/assets/customer", {"partnerId": city, "itemId": w.toner})[0] == 400  # 수량 품목
    # 자동 번호는 직접 넣은 A003을 건너뜀 (World가 A001·A002를 이미 씀)
    b = w.ok("POST", f"{w.base}/assets/customer", {"partnerId": city, "itemId": w.model, "saleType": "유지보수"})["asset"]
    assert (b["code"], b["saleType"]) == ("A004", "유지보수")
    more = w.ok("POST", f"{w.base}/assets", {"itemId": w.model, "count": 1})["assets"]
    assert more[0]["code"] == "A005"
    # 고객 장비는 임대 출고 불가, 창고로 못 돌림(폐기만), 번호 고치기
    assert call(w.ctx, "h1", "POST", f"{w.base}/contracts", {"partnerId": city, "date": TODAY.isoformat(), "machines": [{"assetId": a["id"]}]})[0] == 400
    assert call(w.ctx, "h1", "PATCH", f"{w.base}/assets/{a['id']}", {"status": "in_stock"})[0] == 400
    assert call(w.ctx, "h1", "PATCH", f"{w.base}/assets/{a['id']}", {"code": "A004"})[0] == 400
    assert w.ok("PATCH", f"{w.base}/assets/{a['id']}", {"code": "B610"})["code"] == "B610"
    # 서비스 접수: 장비의 부서·판매구분이 따라옴
    s = w.ok("POST", f"{w.base}/services", {"partnerId": city, "assetId": a["id"], "symptom": "용지 걸림"})["service"]
    assert s["department"] == "건축과"
    row = w.get("/services")["services"][0]
    assert (row["saleType"], row["assetCode"]) == ("완판", "B610")


def test_a3_terms_billing(w: World) -> None:
    terms = {"assetId": w.assets[0], "monthly": 50000, "counter": True, "freeMono": 1000, "overMono": 10, "freeA3Mono": 100, "overA3Mono": 30, "startMono": 0, "startA3Mono": 50}
    k = w.ok("POST", f"{w.base}/contracts", {"partnerId": w.school, "date": f"{M1}-01", "billingDay": 1, "machines": [terms]})["contract"]
    assert k["machines"][w.assets[0]]["billedA3Mono"] == 50
    # 검침: A3도 줄어들 수 없음
    w.ok("POST", f"{w.base}/assets/{w.assets[0]}/readings", {"date": TODAY.isoformat(), "mono": 1500, "a3Mono": 250})
    assert call(w.ctx, "h1", "POST", f"{w.base}/assets/{w.assets[0]}/readings", {"date": TODAY.isoformat(), "mono": 1500, "a3Mono": 200})[0] == 400
    p = next(x for x in w.get("/billing")["pending"] if x["contractId"] == k["id"])
    a3 = [ln for ln in p["lines"] if "A3" in ln["name"]]
    assert [(ln["qty"], ln["unitPrice"]) for ln in a3] == [(100, 30)]  # 250 − 50 − 기본 100
    assert any("흑백 초과" in ln["name"] and ln["qty"] == 500 for ln in p["lines"])
    res = w.ok("POST", f"{w.base}/billing", {"items": [{"contractId": k["id"], "month": p["month"], "date": TODAY.isoformat(), "lines": p["lines"]}]})["results"][0]
    assert res["ok"], res
    m = w.get(f"/contracts/{k['id']}")["contract"]["machines"][w.assets[0]]
    assert (m["billedMono"], m["billedA3Mono"]) == (1500, 250)
    # 청구 취소 → A3 청구 카운터도 되돌아감
    t = res["txn"]
    w.ok("POST", f"{w.base}/txns/{t['date']}/{t['id']}/cancel", {})
    m = w.get(f"/contracts/{k['id']}")["contract"]["machines"][w.assets[0]]
    assert (m["billedMono"], m["billedA3Mono"]) == (0, 50)
    rows = w.get("/readings")["rows"]
    assert rows[0]["a3"] is True and rows[0]["billedA3Mono"] == 50
