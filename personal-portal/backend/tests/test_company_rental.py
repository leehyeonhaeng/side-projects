"""C4 임대 계약·정기 청구·검침·A/S: 계약 출고/추가/수거가 기기·계약을 같이 바꾸고, 청구 대기 금액(일할·초과 매수)이 맞고,
발행·취소가 계약의 청구한 달과 카운터를 정확히 움직이는지"""

import json
from datetime import date
from typing import Any

import pytest

from common import users
from common.perms import Role, Status
from domains.company_rental import days_in, month_add
from handlers import company
from tests.conftest import FakeContext, http_event

TODAY = date.today()
M2 = month_add(TODAY.isoformat()[:7], -2)
M1 = month_add(TODAY.isoformat()[:7], -1)


def call(ctx: FakeContext, sub: str, method: str, path: str, body: dict[str, Any] | None = None, query: dict[str, str] | None = None) -> tuple[int, Any]:
    raw = json.dumps(body) if body is not None else None
    res = company.lambda_handler(http_event(method, f"/api/v1{path}", sub=sub, groups="[host]" if sub == "h1" else "", body=raw, query=query), ctx)
    return res["statusCode"], json.loads(res["body"])


class World:
    def __init__(self, ctx: FakeContext) -> None:
        self.ctx = ctx
        users.create_profile("h1", "h@x.com", "호스트", "", Status.ACTIVE, Role.HOST)
        users.create_profile("f1", "f@x.com", "기사", "", Status.ACTIVE, Role.MEMBER)
        self.cid = self.ok("POST", "/company", {"name": "행컴퍼니"})["id"]
        c = self.base = f"/company/{self.cid}"
        code = self.ok("POST", f"{c}/invites", {"roleId": "field"})["code"]
        call(ctx, "f1", "POST", f"/company/invites/{code}/accept")
        self.school = self.ok("POST", f"{c}/partners", {"name": "학교"})["id"]
        self.model = self.ok("POST", f"{c}/items", {"name": "복합기", "tracking": "asset", "rentPrice": 100000})["id"]
        self.toner = self.ok("POST", f"{c}/items", {"name": "토너", "tracking": "stock", "openingQty": 10, "price": 50000})["id"]
        self.assets = [a["id"] for a in self.ok("POST", f"{c}/assets", {"itemId": self.model, "count": 2})["assets"]]

    def ok(self, method: str, path: str, body: dict[str, Any] | None = None, sub: str = "h1", query: dict[str, str] | None = None) -> Any:
        status, res = call(self.ctx, sub, method, path, body, query)
        assert status == 200, res
        return res

    def get(self, path: str, sub: str = "h1") -> Any:
        return self.ok("GET", f"{self.base}{path}", sub=sub)

    def asset(self, aid: str) -> dict[str, Any]:
        return self.get(f"/assets/{aid}")["asset"]

    def receivable(self) -> int:
        return self.get(f"/partners/{self.school}")["partner"].get("receivable", 0)

    def stock(self) -> float:
        return {i["id"]: i for i in self.get("/items")["items"]}[self.toner]["qty"]


@pytest.fixture
def w(aws: Any, ctx: FakeContext) -> World:
    return World(ctx)


def test_contract_billing_prorate_overage_and_cancel(w: World) -> None:
    start = f"{M2}-11"
    machine = {"assetId": w.assets[0], "monthly": 100000, "counter": True, "freeMono": 1000, "overMono": 10, "startMono": 5000}
    res = w.ok("POST", f"{w.base}/contracts", {"partnerId": w.school, "date": start, "billingDay": 25, "machines": [machine], "lines": [{"name": "설치비", "unitPrice": 50000}]})
    k, out = res["contract"], res["txn"]
    assert k["no"].startswith("C-") and k["billedThrough"] == "" and out["contractOp"] == "create"
    a = w.asset(w.assets[0])
    assert (a["status"], a["contractId"], a["lastReading"]["mono"]) == ("rented", k["id"], 5000)
    assert w.receivable() == 55000
    # 계약 기기는 일반 수거 거래로 못 돌린다
    assert call(w.ctx, "h1", "POST", f"{w.base}/txns", {"type": "rental_return", "date": start, "partnerId": w.school, "assetIds": [w.assets[0]]})[0] == 400

    # 청구 대기: 11일 출고 → 일할, 설치 뒤 검침 없음 경고
    dim = days_in(M2)
    p = w.get("/billing")["pending"][0]
    assert p["month"] == M2 and p["behind"] >= 2
    assert p["lines"][0]["unitPrice"] == round(100000 * (dim - 10) / dim) and "일할" in p["lines"][0]["memo"]
    assert any("검침 없음" in x for x in p["warnings"])

    # 검침 7,500 → 사용 2,500 − 기본 1,000 = 초과 1,500매 × 10원
    w.ok("POST", f"{w.base}/assets/{w.assets[0]}/readings", {"date": f"{M2}-28", "mono": 7500})
    assert call(w.ctx, "h1", "POST", f"{w.base}/assets/{w.assets[0]}/readings", {"date": f"{M2}-28", "mono": 7000})[0] == 400
    p = w.get("/billing")["pending"][0]
    assert [(ln["qty"], ln["unitPrice"]) for ln in p["lines"][1:]] == [(1500, 10)] and not p["warnings"]

    before = w.receivable()
    r = w.ok("POST", f"{w.base}/billing", {"items": [{"contractId": k["id"], "month": M2, "date": f"{M2}-25", "lines": p["lines"]}]})["results"][0]
    assert r["ok"]
    bill_total = r["txn"]["total"]
    assert w.receivable() == before + bill_total
    k2 = w.get(f"/contracts/{k['id']}")["contract"]
    assert (k2["billedThrough"], k2["machines"][w.assets[0]]["billedMono"]) == (M2, 7500)
    # 같은 달 또 발행 → 실패 (따로 저장되므로 결과만 실패)
    again = w.ok("POST", f"{w.base}/billing", {"items": [{"contractId": k["id"], "month": M2, "date": f"{M2}-25", "lines": p["lines"]}]})["results"][0]
    assert not again["ok"]
    # 다음 달: 한 달 전액, 새 검침 없음 경고
    p = w.get("/billing")["pending"][0]
    assert p["month"] == M1 and p["lines"][0]["unitPrice"] == 100000 and p["warnings"]

    # 청구 취소 → 청구한 달·카운터 되돌림
    w.ok("POST", f"{w.base}/txns/{r['txn']['date']}/{r['txn']['id']}/cancel", {"reason": "금액 오류"})
    k3 = w.get(f"/contracts/{k['id']}")["contract"]
    assert (k3["billedThrough"], k3["machines"][w.assets[0]]["billedMono"]) == ("", 5000)
    assert w.get("/billing")["pending"][0]["month"] == M2
    assert w.receivable() == before
    # 변경이 있었던 계약은 출고 취소 불가
    assert call(w.ctx, "h1", "POST", f"{w.base}/txns/{out['date']}/{out['id']}/cancel", {})[0] == 400


def test_add_return_final_settlement(w: World) -> None:
    k = w.ok("POST", f"{w.base}/contracts", {"partnerId": w.school, "date": f"{M1}-01", "machines": [{"assetId": w.assets[0], "monthly": 50000}]})["contract"]
    term = {"assetId": w.assets[1], "counter": True, "overMono": 20, "startMono": 100}
    add = w.ok("POST", f"{w.base}/contracts/{k['id']}/machines", {"date": f"{M1}-15", "machines": [term]})["txn"]
    assert w.asset(w.assets[1])["contractId"] == k["id"]
    # 추가 취소 → 기기 창고, 계약에서 빠짐
    w.ok("POST", f"{w.base}/txns/{add['date']}/{add['id']}/cancel", {})
    a1 = w.asset(w.assets[1])
    assert a1["status"] == "in_stock" and "contractId" not in a1
    assert w.assets[1] not in w.get(f"/contracts/{k['id']}")["contract"]["machines"]
    w.ok("POST", f"{w.base}/contracts/{k['id']}/machines", {"date": f"{M1}-15", "machines": [term]})

    # 하나 수거(카운터 300) → 계약 진행 중, 마지막 기기 수거 → 종료
    w.ok("POST", f"{w.base}/contracts/{k['id']}/return", {"date": f"{M1}-20", "assetIds": [w.assets[1]], "readings": [{"assetId": w.assets[1], "mono": 300}]})
    assert w.get(f"/contracts/{k['id']}")["contract"]["status"] == "active"
    last = w.ok("POST", f"{w.base}/contracts/{k['id']}/return", {"date": f"{M1}-20", "assetIds": [w.assets[0]]})["txn"]
    assert last["returnAll"]
    detail = w.get(f"/contracts/{k['id']}")
    assert detail["contract"]["status"] == "ended" and w.asset(w.assets[0])["status"] == "in_stock"
    # 정산 청구: 20일 사용 일할 + 수거 카운터 초과 200매 × 20원, 청구 대기에 바로
    p = detail["pending"]
    dim = days_in(M1)
    assert p["final"] and p["month"] == M1
    assert [(ln["qty"], ln["unitPrice"]) for ln in p["lines"]] == [(1, round(50000 * 20 / dim)), (200, 20)]
    assert any(x["contractId"] == k["id"] for x in w.get("/billing")["pending"])
    # 마지막 수거 취소 → 계약 다시 진행 중, 기기 임대 중 + 계약 연결
    w.ok("POST", f"{w.base}/txns/{last['date']}/{last['id']}/cancel", {})
    assert w.get(f"/contracts/{k['id']}")["contract"]["status"] == "active"
    a0 = w.asset(w.assets[0])
    assert (a0["status"], a0["contractId"]) == ("rented", k["id"])


def test_service_flow_and_field_staff(w: World) -> None:
    w.ok("POST", f"{w.base}/contracts", {"partnerId": w.school, "date": f"{M1}-01", "machines": [{"assetId": w.assets[0], "monthly": 70000, "counter": True, "startMono": 10}]})
    # 현장 기사: 금액 숨김 → 청구 대기 불가, 계약 요금 안 보임, 검침은 가능
    assert call(w.ctx, "f1", "GET", f"{w.base}/billing")[0] == 403
    k = w.get("/contracts", sub="f1")["contracts"][0]
    assert "monthly" not in k["machines"][w.assets[0]]
    w.ok("POST", f"{w.base}/assets/{w.assets[0]}/readings", {"date": TODAY.isoformat(), "mono": 500}, sub="f1")
    assert len(w.get("/readings", sub="f1")["rows"]) == 1
    assert {s["name"] for s in w.get("/staff", sub="f1")["staff"]} == {"호스트", "기사"}

    # A/S 접수 → 기사가 부품만 쓰고 유상 표시로 완료
    s = w.ok("POST", f"{w.base}/services", {"partnerId": w.school, "assetId": w.assets[0], "date": TODAY.isoformat(), "symptom": "용지 걸림"}, sub="f1")["service"]
    assert s["no"].startswith("AS-") and s["status"] == "open"
    done = {"date": TODAY.isoformat(), "action": "롤러 교체", "parts": [{"itemId": w.toner, "qty": 1}], "billable": True}
    assert call(w.ctx, "f1", "POST", f"{w.base}/services/{s['id']}/complete", {**done, "fees": [{"name": "출장비", "unitPrice": 30000}]})[0] == 403
    res = w.ok("POST", f"{w.base}/services/{s['id']}/complete", done, sub="f1")
    assert (res["service"]["status"], res["service"]["needsBilling"], res["txn"]["type"]) == ("done", True, "service")
    assert w.stock() == 9 and w.receivable() == 0
    assert any(x["action"] == "service_done" for x in w.get(f"/assets/{w.assets[0]}")["logs"])
    # 사무실이 나중에 청구 → 청구 필요 해제, 두 번은 불가
    charge = {"type": "charge", "date": TODAY.isoformat(), "partnerId": w.school, "serviceId": s["id"], "lines": [{"name": "A/S 출장비", "unitPrice": 30000}]}
    w.ok("POST", f"{w.base}/txns", charge)
    assert w.get(f"/services/{s['id']}")["service"]["needsBilling"] is False
    assert call(w.ctx, "h1", "POST", f"{w.base}/txns", charge)[0] == 400
    # A/S 거래 취소 → 다시 접수, 부품 재고 복귀
    t = res["txn"]
    w.ok("POST", f"{w.base}/txns/{t['date']}/{t['id']}/cancel", {})
    assert w.get(f"/services/{s['id']}")["service"]["status"] == "open" and w.stock() == 10
    # A/S 거래는 일반 거래 화면에서 못 만든다
    assert call(w.ctx, "h1", "POST", f"{w.base}/txns", {"type": "service", "date": TODAY.isoformat(), "partnerId": w.school, "lines": [{"itemId": w.toner}]})[0] == 400

    # 유상 작업비와 함께 완료 → 미수, 완료된 A/S는 접수 취소 불가
    s2 = w.ok("POST", f"{w.base}/services", {"partnerId": w.school, "date": TODAY.isoformat(), "symptom": "소음"})["service"]
    before = w.receivable()
    w.ok("POST", f"{w.base}/services/{s2['id']}/complete", {"date": TODAY.isoformat(), "action": "점검", "fees": [{"name": "작업비", "unitPrice": 30000}]})
    assert w.receivable() == before + 33000
    assert call(w.ctx, "h1", "POST", f"{w.base}/services/{s2['id']}/cancel", {})[0] == 400
    assert [x["status"] for x in w.get("/services")["services"]][:1] == ["open"]
