"""C8 서비스 접수: 유형(설정에서 추가)·접수 → 진행 → 완료, 수정 이력, 접수 단계 삭제, 점검 카운터 → 기기 검침"""

from typing import Any

import pytest

from tests.conftest import FakeContext
from tests.test_company_rental import TODAY, World, call


@pytest.fixture
def w(aws: Any, ctx: FakeContext) -> World:
    return World(ctx)


def new(w: World, sub: str = "h1", **body: Any) -> dict[str, Any]:
    return w.ok("POST", f"{w.base}/services", {"partnerId": w.school, "symptom": "용지 걸림", **body}, sub=sub)["service"]


def test_types_from_settings(w: World) -> None:
    assert w.get("/services")["types"] == ["고장", "점검", "설치", "원격"]
    assert new(w)["type"] == "고장"  # 유형을 안 보내면 고장
    assert call(w.ctx, "h1", "POST", f"{w.base}/services", {"partnerId": w.school, "symptom": "x", "type": "배송"})[0] == 400
    assert call(w.ctx, "h1", "POST", f"{w.base}/services", {"partnerId": w.school, "symptom": "x", "type": "설치", "subtype": "청소"})[0] == 400
    assert new(w, type="설치", subtype="수거")["subtype"] == "수거"
    # 설정에서 유형 추가 (같은 이름 두 번은 안 됨)
    assert call(w.ctx, "h1", "PATCH", w.base, {"serviceTypes": ["고장", "고장"]})[0] == 400
    w.ok("PATCH", w.base, {"serviceTypes": ["고장", "점검", "설치", "원격", "배송"]})
    assert new(w, type="배송")["type"] == "배송"
    assert [s["type"] for s in w.ok("GET", f"{w.base}/services", query={"type": "배송"})["services"]] == ["배송"]


def test_stages_edit_history_delete(w: World) -> None:
    a = new(w, requester="김선생", phone="010-1111-2222", visitAt=f"{TODAY.isoformat()}T14:00", assignee="f1")
    b = new(w, urgent=True, symptom="전원 안 켜짐")
    assert a["status"] == "open" and a["requester"] == "김선생"
    # 긴급 먼저, 받은 사람·담당 이름
    listed = w.get("/services")["services"]
    assert [s["id"] for s in listed] == [b["id"], a["id"]]
    assert (listed[1]["assigneeName"], listed[1]["createdByName"]) == ("기사", "호스트")

    # 접수 → 진행 (기사), 두 번은 안 됨
    s = w.ok("POST", f"{w.base}/services/{a['id']}/start", {"note": "부품 주문"}, sub="f1")["service"]
    assert (s["status"], s["progressNote"], s["startedByName"]) == ("in_progress", "부품 주문", "기사")
    assert call(w.ctx, "f1", "POST", f"{w.base}/services/{a['id']}/start", {})[0] == 400
    assert [x["id"] for x in w.ok("GET", f"{w.base}/services", query={"status": "active"})["services"]] == [b["id"], a["id"]]

    # 수정 → 바뀐 칸만 이력에, 지우면 빈 칸
    w.ok("PATCH", f"{w.base}/services/{a['id']}", {"symptom": "용지 걸림 (2단)", "phone": "", "remark": "오전 방문 불가"})
    got = w.get(f"/services/{a['id']}")
    assert "phone" not in got["service"] and got["service"]["remark"] == "오전 방문 불가"
    edit = got["history"][0]
    assert (edit["action"], edit["actorName"], set(edit["changes"])) == ("edit", "호스트", {"symptom", "phone", "remark"})
    assert edit["changes"]["phone"] == {"from": "010-1111-2222", "to": ""}
    assert [h["action"] for h in got["history"]] == ["edit", "start"]

    # 진행 중은 삭제 불가(취소만), 접수 단계는 삭제 → 이력도 같이 지워짐
    assert call(w.ctx, "h1", "DELETE", f"{w.base}/services/{a['id']}")[0] == 400
    w.ok("PATCH", f"{w.base}/services/{b['id']}", {"urgent": False})
    w.ok("DELETE", f"{w.base}/services/{b['id']}")
    assert call(w.ctx, "h1", "GET", f"{w.base}/services/{b['id']}")[0] == 404
    assert [s["id"] for s in w.get("/services")["services"]] == [a["id"]]

    # 완료 → 보고 내용·특이사항만 고칠 수 있음
    w.ok("POST", f"{w.base}/services/{a['id']}/complete", {"date": TODAY.isoformat(), "action": "롤러 청소", "method": "방문", "report": "소모 심함"}, sub="f1")
    done = w.get(f"/services/{a['id']}")["service"]
    assert (done["done"]["method"], done["report"], done["doneByName"]) == ("방문", "소모 심함", "기사")
    assert call(w.ctx, "h1", "PATCH", f"{w.base}/services/{a['id']}", {"symptom": "x"})[0] == 400
    w.ok("PATCH", f"{w.base}/services/{a['id']}", {"report": "다음 달 교체 권장"})
    assert call(w.ctx, "h1", "POST", f"{w.base}/services/{a['id']}/cancel", {})[0] == 400
    board = w.ok("GET", f"{w.base}/services", query={"doneSince": "2999-01-01"})["services"]
    assert board == []  # 끝난 것은 그날 이후 것만
    assert [x["id"] for x in w.ok("GET", f"{w.base}/services", query={"doneSince": TODAY.isoformat()})["services"]] == [a["id"]]


def test_inspection_counters_become_reading(w: World) -> None:
    w.ok("POST", f"{w.base}/assets/{w.assets[0]}/readings", {"date": TODAY.isoformat(), "mono": 1000, "color": 200})
    s = new(w, type="점검", assetId=w.assets[0], symptom="정기 점검")
    body = {"date": TODAY.isoformat(), "action": "점검 완료", "consumables": {"KT": 30, "CT": "양호", "WTC": 50, "XX": 1}}
    # 카운터가 지난 검침보다 작으면 거절
    assert call(w.ctx, "f1", "POST", f"{w.base}/services/{s['id']}/complete", {**body, "counters": {"a4Mono": 900}})[0] == 400
    w.ok("POST", f"{w.base}/services/{s['id']}/complete", {**body, "counters": {"a4Mono": 1500, "a4Color": 260, "a3Mono": 40}}, sub="f1")
    r = w.asset(w.assets[0])["lastReading"]
    assert (r["mono"], r["color"], r["a3Mono"], r["a3Color"]) == (1500, 260, 40, 0)
    done = w.get(f"/services/{s['id']}")["service"]["done"]
    assert done["consumables"] == {"KT": 30, "CT": "양호", "WTC": 50} and done["counters"]["a4Mono"] == 1500
    # 기기 없는 접수에 카운터는 안 됨
    s2 = new(w, type="점검")
    assert call(w.ctx, "h1", "POST", f"{w.base}/services/{s2['id']}/complete", {**body, "counters": {"a4Mono": 1}})[0] == 400


def test_cancel_and_txn_cancel_back_to_progress(w: World) -> None:
    s = new(w, assetId=w.assets[0])
    w.ok("POST", f"{w.base}/services/{s['id']}/start", {})
    res = w.ok("POST", f"{w.base}/services/{s['id']}/complete", {"date": TODAY.isoformat(), "action": "토너 교체", "parts": [{"itemId": w.toner, "qty": 1}]})
    t = res["txn"]
    w.ok("POST", f"{w.base}/txns/{t['date']}/{t['id']}/cancel", {})
    assert w.get(f"/services/{s['id']}")["service"]["status"] == "in_progress"  # 진행했던 건 진행으로
    c = w.ok("POST", f"{w.base}/services/{s['id']}/cancel", {"reason": "고객 취소"})["service"]
    assert (c["status"], c["cancelReason"]) == ("canceled", "고객 취소")
    assert call(w.ctx, "h1", "PATCH", f"{w.base}/services/{s['id']}", {"remark": "x"})[0] == 400
    assert w.get(f"/services/{s['id']}")["history"][0]["action"] == "cancel"


def test_install_links_contract_out_and_return(w: World) -> None:
    day = TODAY.isoformat()
    machine = {"assetId": w.assets[0], "monthly": 70000}
    # 신규 설치 접수 → 계약 출고로 완료 (다른 거래처·수거 접수로는 안 됨)
    pickup = new(w, type="설치", subtype="수거", symptom="수거 요청")
    assert call(w.ctx, "h1", "POST", f"{w.base}/contracts", {"partnerId": w.school, "date": day, "machines": [machine], "serviceId": pickup["id"]})[0] == 400
    inst = new(w, type="설치", subtype="신규 설치", symptom="복합기 1대 설치")
    res = w.ok("POST", f"{w.base}/contracts", {"partnerId": w.school, "date": day, "machines": [machine], "serviceId": inst["id"]})
    kid, out = res["contract"]["id"], res["txn"]
    s = w.get(f"/services/{inst['id']}")["service"]
    assert (s["status"], s["links"][0]["no"], s["done"]["action"]) == ("done", out["no"], f"출고 {out['no']}")
    assert out["serviceNo"] == inst["no"]
    # 출고를 취소하면 서비스는 다시 진행
    w.ok("POST", f"{w.base}/txns/{out['date']}/{out['id']}/cancel", {})
    assert w.get(f"/services/{inst['id']}")["service"]["status"] == "in_progress"

    # 기기 교체: 수거하면 진행, 새 기기 추가 출고하면 완료
    kid = w.ok("POST", f"{w.base}/contracts", {"partnerId": w.school, "date": day, "machines": [machine]})["contract"]["id"]
    swap = new(w, type="설치", subtype="기기 교체", symptom="고장 기기 교체", assetId=w.assets[0])
    w.ok("POST", f"{w.base}/contracts/{kid}/return", {"date": day, "assetIds": [w.assets[0]], "serviceId": swap["id"]}, sub="f1")
    assert w.get(f"/services/{swap['id']}")["service"]["status"] == "in_progress"
    w2 = w.ok("POST", f"{w.base}/contracts", {"partnerId": w.school, "date": day, "machines": [{"assetId": w.assets[1], "monthly": 70000}], "serviceId": swap["id"]})
    s = w.get(f"/services/{swap['id']}")["service"]
    assert s["status"] == "done" and [x["op"] for x in s["links"]] == ["return", "out"]
    # 끝난 서비스는 다시 연결 못 함, 수거 접수는 수거로 완료
    assert call(w.ctx, "h1", "POST", f"{w.base}/contracts/{w2['contract']['id']}/return", {"date": day, "assetIds": [w.assets[1]], "serviceId": swap["id"]})[0] == 400
    w.ok("POST", f"{w.base}/contracts/{w2['contract']['id']}/return", {"date": day, "assetIds": [w.assets[1]], "serviceId": pickup["id"]})
    assert w.get(f"/services/{pickup['id']}")["service"]["status"] == "done"
