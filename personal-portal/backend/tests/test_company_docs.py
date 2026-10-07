"""C5 문서: 발행은 원본당 한 번(다시 누르면 같은 파일), 원본 취소 → 취소 판, 청구서 고르기·이전 미수, 작업 확인서 권한,
직인 버전 고정, 원장 이월·잔액, 라벨 장수"""

import base64
import io
import json
import re
from datetime import date
from typing import Any

import boto3
import pytest
from PIL import Image

from common import users
from common.perms import Role, Status
from domains import company_docs
from handlers import company
from tests.conftest import FakeContext, http_event

DAY = date.today().isoformat()


def call(ctx: FakeContext, sub: str, method: str, path: str, body: dict[str, Any] | None = None) -> tuple[int, Any]:
    raw = json.dumps(body) if body is not None else None
    path, _, qs = path.partition("?")
    query = dict(kv.split("=", 1) for kv in qs.split("&")) if qs else None
    res = company.lambda_handler(http_event(method, f"/api/v1{path}", sub=sub, groups="[host]" if sub == "h1" else "", body=raw, query=query), ctx)
    return res["statusCode"], json.loads(res["body"])


def pdf_of(res: dict[str, Any]) -> bytes:
    data = base64.b64decode(res["data"])
    assert data.startswith(b"%PDF")
    return data


class World:
    def __init__(self, ctx: FakeContext) -> None:
        self.ctx = ctx
        users.create_profile("h1", "h@x.com", "호스트", "", Status.ACTIVE, Role.HOST)
        users.create_profile("f1", "f@x.com", "기사", "", Status.ACTIVE, Role.MEMBER)
        self.cid = self.ok("POST", "/company", {"name": "행컴퍼니"})["id"]
        c = self.base = f"/company/{self.cid}"
        self.ok("PATCH", c, {"ceo": "홍길동", "bizNo": "123-45-67890", "bankAccount": "국민 123"})
        code = self.ok("POST", f"{c}/invites", {"roleId": "field"})["code"]
        call(ctx, "f1", "POST", f"/company/invites/{code}/accept")
        self.school = self.ok("POST", f"{c}/partners", {"name": "학교"})["id"]
        self.toner = self.ok("POST", f"{c}/items", {"name": "토너", "tracking": "stock", "openingQty": 10, "price": 50000})["id"]
        self.bank = self.ok("POST", f"{c}/accounts", {"name": "통장"})["id"]

    def ok(self, method: str, path: str, body: dict[str, Any] | None = None, sub: str = "h1") -> Any:
        status, res = call(self.ctx, sub, method, path, body)
        assert status == 200, res
        return res

    def txn(self, body: dict[str, Any]) -> dict[str, Any]:
        return self.ok("POST", f"{self.base}/txns", {"date": DAY, "partnerId": self.school, **body})["txn"]

    def charge(self, amount: int, name: str = "임대료") -> dict[str, Any]:
        return self.txn({"type": "charge", "lines": [{"name": name, "unitPrice": amount}]})


@pytest.fixture
def w(aws: Any, ctx: FakeContext) -> World:
    return World(ctx)


def test_issue_once_store_and_cancel_watermark(w: World) -> None:
    ch = w.charge(100000)
    r = w.txn({"type": "receipt", "accountId": w.bank, "amount": 110000})
    first = w.ok("POST", f"{w.base}/docs", {"type": "receipt", "txnDate": r["date"], "txnId": r["id"]})
    doc = first["doc"]
    assert first["created"] and doc["no"] == f"R-{DAY[:4]}-0001" and doc["total"] == 110000 and "snapshot" not in doc
    # 다시 누르면 같은 문서, 번호 그대로
    again = w.ok("POST", f"{w.base}/docs", {"type": "receipt", "txnDate": r["date"], "txnId": r["id"]})
    assert not again["created"] and again["doc"]["id"] == doc["id"]
    stored = boto3.client("s3").get_object(Bucket="portal-test-docs", Key=f"company/{w.cid}/docs/{doc['no']}.pdf")["Body"].read()
    got = w.ok("GET", f"{w.base}/docs/{doc['id']}/pdf")
    assert pdf_of(got) == stored and not got["canceled"]
    assert "portal-test-docs" in got["url"] and doc["no"] in got["url"]  # 새 탭에서 열 서명 URL
    # 명세서는 청구에, 입금에는 명세서 없음
    st = w.ok("POST", f"{w.base}/docs", {"type": "statement", "txnDate": ch["date"], "txnId": ch["id"]})["doc"]
    assert st["no"] == f"S-{DAY[:4]}-0001"
    assert call(w.ctx, "h1", "POST", f"{w.base}/docs", {"type": "statement", "txnDate": r["date"], "txnId": r["id"]})[0] == 400
    # 입금 취소 → 영수증에 취소 표시, 받으면 취소 판 (보관 파일과 다름)
    w.ok("POST", f"{w.base}/txns/{r['date']}/{r['id']}/cancel", {"reason": "오입력"})
    listed = {d["id"]: d for d in w.ok("GET", f"{w.base}/docs")["docs"]}
    assert listed[doc["id"]]["canceled"] and not listed[st["id"]]["canceled"]
    cut = w.ok("GET", f"{w.base}/docs/{doc['id']}/pdf")
    assert cut["canceled"] and pdf_of(cut) != stored and cut["filename"].endswith("_취소.pdf")
    # 원본별 찾기
    assert [d["id"] for d in w.ok("GET", f"{w.base}/docs?source={ch['id']}")["docs"]] == [st["id"]]


def test_invoice_pick_and_previous(w: World) -> None:
    a = w.charge(100000, "9월 임대료")  # 110,000
    b = w.charge(50000, "토너")  # 55,000
    w.txn({"type": "receipt", "accountId": w.bank, "amount": 30000, "allocations": [{"txnId": b["id"], "date": b["date"], "amount": 30000}]})
    res = w.ok("POST", f"{w.base}/docs/invoice", {"partnerId": w.school, "date": DAY, "txns": [{"date": b["date"], "id": b["id"]}], "memo": "말일까지"})["doc"]
    # 고른 토너 55,000 − 받은 30,000 + 이전 미수(9월 임대료) 110,000
    assert res["no"] == f"B-{DAY[:4]}-0001" and res["total"] == 135000
    no_prev = w.ok("POST", f"{w.base}/docs/invoice", {"partnerId": w.school, "date": DAY, "txns": [{"date": b["date"], "id": b["id"]}], "previous": False})["doc"]
    assert no_prev["total"] == 25000 and no_prev["no"].endswith("0002")
    # 다른 거래처 거래·입금은 못 고른다
    other = w.ok("POST", f"{w.base}/partners", {"name": "병원"})["id"]
    assert call(w.ctx, "h1", "POST", f"{w.base}/docs/invoice", {"partnerId": other, "date": DAY, "txns": [{"date": a["date"], "id": a["id"]}]})[0] == 400
    pdf_of(w.ok("GET", f"{w.base}/docs/{res['id']}/pdf"))


def test_work_confirmation_field_staff_and_reissue(w: World) -> None:
    s = w.ok("POST", f"{w.base}/services", {"partnerId": w.school, "date": DAY, "symptom": "용지 걸림"}, sub="f1")["service"]
    assert call(w.ctx, "f1", "POST", f"{w.base}/docs", {"type": "work", "serviceId": s["id"]})[0] == 400  # 완료 전
    done = w.ok("POST", f"{w.base}/services/{s['id']}/complete", {"date": DAY, "action": "롤러 교체", "parts": [{"itemId": w.toner, "qty": 1}]}, sub="f1")
    d1 = w.ok("POST", f"{w.base}/docs", {"type": "work", "serviceId": s["id"]}, sub="f1")["doc"]
    assert d1["no"] == f"W-{DAY[:4]}-0001" and "total" not in d1  # 금액 숨김 직원에게는 금액 없음
    pdf_of(w.ok("GET", f"{w.base}/docs/{d1['id']}/pdf", sub="f1"))
    # 기사는 금액 문서 발행·받기 불가
    r = w.txn({"type": "receipt", "accountId": w.bank, "amount": 1000})
    assert call(w.ctx, "f1", "POST", f"{w.base}/docs", {"type": "receipt", "txnDate": r["date"], "txnId": r["id"]})[0] == 403
    rd = w.ok("POST", f"{w.base}/docs", {"type": "receipt", "txnDate": r["date"], "txnId": r["id"]})["doc"]
    assert call(w.ctx, "f1", "GET", f"{w.base}/docs/{rd['id']}/pdf")[0] == 403
    # A/S 거래 취소 → 작업 확인서 취소 표시, 다시 완료하면 새 확인서
    t = done["txn"]
    w.ok("POST", f"{w.base}/txns/{t['date']}/{t['id']}/cancel", {})
    assert w.ok("GET", f"{w.base}/docs?source={s['id']}")["docs"][0]["canceled"]
    w.ok("POST", f"{w.base}/services/{s['id']}/complete", {"date": DAY, "action": "다시 점검"}, sub="f1")
    d2 = w.ok("POST", f"{w.base}/docs", {"type": "work", "serviceId": s["id"]}, sub="f1")
    assert d2["created"] and d2["doc"]["id"] != d1["id"]


def test_seal_version_pinned(w: World) -> None:
    assert w.ok("GET", f"{w.base}/seal")["data"] is None
    img = Image.new("RGBA", (120, 120), (0, 0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    png = base64.b64encode(buf.getvalue()).decode()
    assert call(w.ctx, "f1", "PUT", f"{w.base}/seal", {"data": png})[0] == 403
    assert call(w.ctx, "h1", "PUT", f"{w.base}/seal", {"data": base64.b64encode(b"not image").decode()})[0] == 400
    w.ok("PUT", f"{w.base}/seal", {"data": f"data:image/png;base64,{png}"})
    assert w.ok("GET", f"{w.base}/seal")["data"]
    ch = w.charge(10000)
    doc = w.ok("POST", f"{w.base}/docs", {"type": "statement", "txnDate": ch["date"], "txnId": ch["id"]})["doc"]
    assert doc["sealVersion"]
    # 예시 직인으로 되돌려도 이미 발행한 문서는 그때 직인으로 다시 그린다 (취소 판)
    w.ok("DELETE", f"{w.base}/seal")
    assert w.ok("GET", f"{w.base}/seal")["data"] is None
    w.ok("POST", f"{w.base}/txns/{ch['date']}/{ch['id']}/cancel", {})
    assert w.ok("GET", f"{w.base}/docs/{doc['id']}/pdf")["canceled"]


def test_ledger_and_labels(w: World) -> None:
    w.ok("POST", f"{w.base}/txns", {"type": "charge", "date": "2026-01-10", "partnerId": w.school, "lines": [{"name": "1월", "unitPrice": 100000}]})
    w.ok("POST", f"{w.base}/txns", {"type": "receipt", "date": "2026-02-05", "partnerId": w.school, "accountId": w.bank, "amount": 60000})
    w.ok("POST", f"{w.base}/txns", {"type": "charge", "date": "2026-02-10", "partnerId": w.school, "lines": [{"name": "2월", "unitPrice": 100000}]})
    sides = company_docs._ledger_sides(w.cid, w.school, "2026-02-01", "2026-02-28")
    assert len(sides) == 1
    s = sides[0]
    assert (s["opening"], s["plusSum"], s["minusSum"], s["closing"]) == (110000, 110000, 60000, 160000)
    assert [r["balance"] for r in s["rows"]] == [50000, 160000]
    pdf_of(w.ok("POST", f"{w.base}/print/ledger", {"partnerId": w.school, "from": "2026-02-01", "to": "2026-02-28"}))
    assert call(w.ctx, "f1", "POST", f"{w.base}/print/ledger", {"partnerId": w.school, "from": "2026-02-01", "to": "2026-02-28"})[0] == 403

    model = w.ok("POST", f"{w.base}/items", {"name": "복합기", "tracking": "asset"})["id"]
    ids = [a["id"] for a in w.ok("POST", f"{w.base}/assets", {"itemId": model, "count": 3, "serials": ["S1"]})["assets"]]
    pages = lambda data: len(re.findall(rb"/Type /Page[^s]", data))  # noqa: E731
    roll = pdf_of(w.ok("POST", f"{w.base}/print/labels", {"assetIds": ids, "kind": "roll-50x30", "baseUrl": "https://example.com"}, sub="f1"))
    assert pages(roll) == 3
    sheet = pdf_of(w.ok("POST", f"{w.base}/print/labels", {"assetIds": ids, "kind": "a4-21", "start": 20, "baseUrl": "https://example.com"}))
    assert pages(sheet) == 2  # 마지막 1칸 + 다음 장
    assert call(w.ctx, "h1", "POST", f"{w.base}/print/labels", {"assetIds": ids, "baseUrl": "javascript:alert(1)"})[0] == 400
