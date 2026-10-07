"""C6 알림·대시보드·보고서: 직원마다 켠 종류만·권한 있는 것만 받고, 자기가 한 일은 안 받고, 아침 확인은 새로 생긴 것만.
푸시는 구독한 기기로 가고 만료된 구독(410)은 지운다"""

import json
from datetime import date, timedelta
from typing import Any

import pytest
from cryptography.hazmat.primitives.asymmetric import ec

from common import users, webpush
from common.perms import Role, Status
from domains import company_notify
from handlers import company
from tests.conftest import FakeContext, http_event

TODAY = date.today()
DAY = TODAY.isoformat()


def call(ctx: FakeContext, sub: str, method: str, path: str, body: dict[str, Any] | None = None) -> tuple[int, Any]:
    raw = json.dumps(body) if body is not None else None
    path, _, qs = path.partition("?")
    query = dict(kv.split("=", 1) for kv in qs.split("&")) if qs else None
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
        self.toner = self.ok("POST", f"{c}/items", {"name": "토너", "tracking": "stock", "openingQty": 10, "minStock": 5, "price": 50000})["id"]
        self.bank = self.ok("POST", f"{c}/accounts", {"name": "통장"})["id"]

    def ok(self, method: str, path: str, body: dict[str, Any] | None = None, sub: str = "h1") -> Any:
        status, res = call(self.ctx, sub, method, path, body)
        assert status == 200, res
        return res

    def notes(self, sub: str) -> list[dict[str, Any]]:
        return self.ok("GET", f"{self.base}/notifications", sub=sub)["notifications"]


@pytest.fixture
def w(aws: Any, ctx: FakeContext) -> World:
    return World(ctx)


def test_settings_follow_permissions(w: World) -> None:
    field = {t["id"]: t for t in w.ok("GET", f"{w.base}/notify/settings", sub="f1")["types"]}
    assert "receipt_new" not in field and "overdue" not in field and "billing_due" not in field  # 금액·돈 권한 없음
    assert field["service_assigned"]["on"] and not field["service_new"]["on"]
    w.ok("PUT", f"{w.base}/notify/settings", {"prefs": {"service_new": True}}, sub="f1")
    assert {t["id"]: t for t in w.ok("GET", f"{w.base}/notify/settings", sub="f1")["types"]}["service_new"]["on"]
    assert call(w.ctx, "f1", "PUT", f"{w.base}/notify/settings", {"prefs": {"nope": True}})[0] == 400


def test_instant_notifications_and_push(w: World, monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[tuple[str, str]] = []
    vapid = webpush.Vapid(ec.generate_private_key(ec.SECP256R1()), "https://example.com")
    monkeypatch.setattr(webpush, "vapid", lambda: vapid)
    monkeypatch.setattr(webpush, "send", lambda sub, msg, v, timeout=5: sent.append((sub["endpoint"], msg["title"])) or (410 if "old" in sub["endpoint"] else 201))
    assert w.ok("GET", f"{w.base}/notify/settings", sub="f1")["publicKey"] == vapid.public_key
    keys = {"p256dh": "x", "auth": "y"}
    w.ok("POST", f"{w.base}/push/subscribe", {"endpoint": "https://push.example/new", "keys": keys}, sub="f1")
    w.ok("POST", f"{w.base}/push/subscribe", {"endpoint": "https://push.example/old", "keys": keys}, sub="f1")
    # Host가 A/S를 접수하며 기사에게 배정 → 기사만 '배정' 알림 (Host는 자기 일 안 받음)
    s = w.ok("POST", f"{w.base}/services", {"partnerId": w.school, "date": DAY, "symptom": "용지 걸림", "assignee": "f1"})["service"]
    f1 = w.notes("f1")
    assert [n["type"] for n in f1] == ["service_assigned"] and f1[0]["unread"] and s["no"] in f1[0]["title"]
    assert not [n for n in w.notes("h1") if n["type"].startswith("service")]
    assert sorted(e for e, _ in sent) == ["https://push.example/new", "https://push.example/old"]
    # 410 받은 구독은 지워짐 → 기기 1대
    assert w.ok("GET", f"{w.base}/notify/settings", sub="f1")["devices"] == 1
    # 읽음 처리
    assert w.ok("GET", f"{w.base}/notifications", sub="f1")["unread"] == 1
    w.ok("POST", f"{w.base}/notifications/read", sub="f1")
    assert w.ok("GET", f"{w.base}/notifications", sub="f1")["unread"] == 0
    # 기사가 완료 → Host가 'A/S 완료'를 켰으면 받음
    w.ok("PUT", f"{w.base}/notify/settings", {"prefs": {"service_done": True}})
    w.ok("POST", f"{w.base}/services/{s['id']}/complete", {"date": DAY, "action": "롤러 교체"}, sub="f1")
    assert w.notes("h1")[0]["type"] == "service_done"


def test_stock_low_once_and_receipt_permissions(w: World) -> None:
    sale = {"type": "sale", "date": DAY, "partnerId": w.school, "lines": [{"itemId": w.toner, "qty": 6, "unitPrice": 50000}]}
    w.ok("POST", f"{w.base}/txns", sale)  # 10 → 4 (최소 5 아래로)
    assert [n["type"] for n in w.notes("h1")] == ["stock_low"]
    w.ok("POST", f"{w.base}/txns", {**sale, "lines": [{"itemId": w.toner, "qty": 1, "unitPrice": 50000}]})  # 이미 아래 → 또 알리지 않음
    assert len(w.notes("h1")) == 1
    # 기사는 입금 알림을 켜도 금액 권한이 없어 못 받는다
    w.ok("PUT", f"{w.base}/notify/settings", {"prefs": {"receipt_new": True}}, sub="f1")
    w.ok("POST", f"{w.base}/txns", {"type": "receipt", "date": DAY, "partnerId": w.school, "accountId": w.bank, "amount": 1000})
    assert not [n for n in w.notes("f1") if n["type"] == "receipt_new"]


def test_daily_only_new(w: World) -> None:
    old = (TODAY - timedelta(days=40)).isoformat()
    w.ok("POST", f"{w.base}/txns", {"type": "charge", "date": old, "partnerId": w.school, "lines": [{"name": "임대료", "unitPrice": 100000}]})
    w.ok("POST", f"{w.base}/services", {"partnerId": w.school, "date": (TODAY - timedelta(days=5)).isoformat(), "symptom": "소음"})
    sent = company_notify.daily(w.cid, TODAY)
    assert sent.get("overdue") == 1 and sent.get("service_stale") == 2  # 연체는 Host만, 밀린 A/S는 Host·기사
    titles = [n["title"] for n in w.notes("h1")]
    assert any("연체" in t for t in titles)
    assert company_notify.daily(w.cid, TODAY) == {}  # 같은 것은 다시 안 알림
    w.ok("POST", f"{w.base}/txns", {"type": "charge", "date": old, "partnerId": w.school, "lines": [{"name": "토너", "unitPrice": 1000}]})
    assert company_notify.daily(w.cid, TODAY) == {"overdue": 1}


def test_dashboard_and_reports(w: World) -> None:
    w.ok("POST", f"{w.base}/txns", {"type": "sale", "date": DAY, "partnerId": w.school, "lines": [{"itemId": w.toner, "qty": 6, "unitPrice": 10000}]})
    w.ok("POST", f"{w.base}/txns", {"type": "receipt", "date": DAY, "partnerId": w.school, "accountId": w.bank, "amount": 50000})
    w.ok("POST", f"{w.base}/txns", {"type": "expense", "date": DAY, "accountId": w.bank, "amount": 7000, "category": "유류비"})
    d = w.ok("GET", f"{w.base}/dashboard")
    assert d["money"]["this"] == {"salesTotal": 66000, "receipts": 50000, "purchaseTotal": 0, "expenses": 7000}
    assert d["receivables"]["top"][0]["receivable"] == 16000 and d["lowStock"][0]["name"] == "토너"
    fd = w.ok("GET", f"{w.base}/dashboard", sub="f1")
    assert "money" not in fd and "receivables" not in fd and "lowStock" in fd
    r = w.ok("GET", f"{w.base}/reports?from={DAY[:7]}&to={DAY[:7]}")
    m = r["monthly"][0]
    assert (m["salesSupply"], m["salesVat"], m["receipts"], m["expenses"]) == (60000, 6000, 50000, 7000)
    assert r["items"][0]["saleQty"] == 6 and r["expenses"] == [{"category": "유류비", "amount": 7000}]
    assert r["partners"][0]["receivable"] == 16000
    assert call(w.ctx, "f1", "GET", f"{w.base}/reports")[0] == 403
    assert call(w.ctx, "h1", "GET", f"{w.base}/reports?from=2020-01&to=2026-12")[0] == 400
