"""행컴퍼니 알림 (COMPANY.md 4장 "알림", C6): 앱 안 알림 + 폰 푸시. 종류마다 직원이 직접 켜고 끈다.

- 바로 알림: 일이 생긴 순간 (A/S 배정·접수·완료, 입금, 재고 부족으로 떨어짐, 임대 출고·수거). 한 사람은 자기가 한 일은 안 받는다
- 아침 확인(매일 08:30 KST, company-daily Lambda): 연체 미수·계약 만료 임박·청구 대기·검침 필요·밀린 A/S 중 **새로 생긴 것만**
  (지난번에 알린 목록을 ALERTSTATE#<종류>에 두고 비교)
- 권한 없는 종류는 안 받는다 (금액 종류는 금액 보기도 필요)

키 (회사 파티션)
- NOTIFY#<sub>: 종류별 켜기(prefs), 다 읽은 시각(readAt). 회사 멤버가 아닌 Host도 설정하면 받는다
- NOTI#<sub>#<시각>#<rand>: 알림 한 건 (60일 TTL)
- PUSHSUB#<sub>#<endpoint 해시>: 이 사람 기기의 푸시 구독
알림을 못 보내도 원래 작업은 실패하지 않는다 (전부 잡아서 로그만)
"""

import hashlib
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from typing import Any
from uuid import uuid4

from aws_lambda_powertools.event_handler.api_gateway import Router
from aws_lambda_powertools.event_handler.exceptions import BadRequestError
from boto3.dynamodb.conditions import Key
from pydantic import BaseModel, ConfigDict, Field

from common import webpush
from common.aws import table
from common.http import parse_body
from common.serialize import to_plain
from common.users import get_profile, now_iso
from domains.company_core import AREAS, company_ctx, pk
from domains.sharing import query_all

router = Router()
log = logging.getLogger(__name__)

# id → (이름, 묶음, 기본 켜짐, 필요한 영역, 금액 보기 필요)
TYPES: dict[str, tuple[str, str, bool, str, bool]] = {
    "service_assigned": ("내게 A/S 배정", "instant", True, "assets", False),
    "service_new": ("A/S 접수", "instant", False, "assets", False),
    "service_done": ("A/S 완료", "instant", False, "assets", False),
    "receipt_new": ("입금 들어옴", "instant", False, "money", True),
    "stock_low": ("재고 부족으로 떨어짐", "instant", True, "items", False),
    "rental": ("임대 출고·수거", "instant", False, "contracts", False),
    "overdue": ("새로 연체된 미수", "daily", True, "money", True),
    "contract_expiring": ("계약 만료 30일 전", "daily", True, "contracts", False),
    "billing_due": ("새 청구 대기", "daily", True, "contracts", True),
    "readings_due": ("검침 필요", "daily", False, "assets", False),
    "service_stale": ("3일 넘게 안 끝난 A/S", "daily", True, "assets", False),
}
NOTI_DAYS = 60
STALE_DAYS = 3
EXPIRING_DAYS = 30


class Prefs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prefs: dict[str, bool]


class SubscribeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    endpoint: str = Field(pattern=r"^https://", max_length=1000)
    keys: dict[str, str]
    device: str = Field(default="", max_length=100)


class UnsubscribeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    endpoint: str = Field(max_length=1000)


# ── 받는 사람 ────────────────────────────────────────

def _items(cid: str, prefix: str) -> list[dict[str, Any]]:
    return [to_plain(i) for i in query_all(KeyConditionExpression=Key("PK").eq(pk(cid)) & Key("SK").begins_with(prefix))]


def _allowed(ntype: str, perms: dict[str, str], show_amounts: bool) -> bool:
    _, _, _, area, money = TYPES[ntype]
    return perms.get(area, "none") != "none" and (show_amounts or not money)


def _people(cid: str) -> list[dict[str, Any]]:
    """회사 멤버 + 알림을 설정한 Host. {sub, perms, showAmounts, prefs}"""
    members = {m["sub"]: m for m in _items(cid, "MEMBER#")}
    settings = {n["sub"]: n for n in _items(cid, "NOTIFY#")}
    out = []
    for sub in set(members) | set(settings):
        m = members.get(sub)
        if m:
            perms, amounts = dict(m.get("perms", {})), bool(m.get("showAmounts"))
            if m.get("isAdmin"):
                perms = {a: "edit" for a in AREAS}
        else:
            profile = get_profile(sub)
            if not profile or profile.get("role") != "host":
                continue
            perms, amounts = {a: "edit" for a in AREAS}, True
        out.append({"sub": sub, "perms": perms, "showAmounts": amounts, "prefs": settings.get(sub, {}).get("prefs", {})})
    return out


def _on(person: dict[str, Any], ntype: str) -> bool:
    return bool(person["prefs"].get(ntype, TYPES[ntype][2])) and _allowed(ntype, person["perms"], person["showAmounts"])


# ── 보내기 ───────────────────────────────────────────

def _push(cid: str, subs: list[dict[str, Any]], message: dict[str, Any]) -> None:
    v = webpush.vapid()
    if v is None or not subs:
        return

    def one(s: dict[str, Any]) -> tuple[dict[str, Any], int]:
        try:
            return s, webpush.send(s, message, v)
        except Exception:  # noqa: BLE001 (네트워크 오류 등은 이번만 건너뛴다)
            log.warning("push failed", exc_info=True)
            return s, 0

    with ThreadPoolExecutor(max_workers=8) as pool:
        for s, status in pool.map(one, subs):
            if status in (404, 410):  # 만료된 구독
                table().delete_item(Key={"PK": pk(cid), "SK": s["SK"]})


def notify(cid: str, ntype: str, title: str, body: str, url: str, only: list[str] | None = None, exclude: str | None = None) -> int:
    """알림 보내기 (앱 안 + 폰 푸시). 받은 사람 수. 실패해도 예외를 던지지 않는다"""
    try:
        people = [p for p in _people(cid) if _on(p, ntype) and (only is None or p["sub"] in only) and p["sub"] != exclude]
        if not people:
            return 0
        at = now_iso()
        ttl = int(time.time()) + NOTI_DAYS * 86400
        with table().batch_writer() as batch:
            for p in people:
                batch.put_item(Item={"PK": pk(cid), "SK": f"NOTI#{p['sub']}#{at}#{uuid4().hex[:4]}", "type": ntype, "title": title, "body": body, "url": url, "at": at, "ttl": ttl})
        subs_by = {}
        for s in query_all(KeyConditionExpression=Key("PK").eq(pk(cid)) & Key("SK").begins_with("PUSHSUB#")):
            subs_by.setdefault(s["sub"], []).append(s)
        targets = [s for p in people for s in subs_by.get(p["sub"], [])]
        _push(cid, targets, {"title": title, "body": body, "url": url, "tag": ntype})
        return len(people)
    except Exception:  # noqa: BLE001
        log.warning("notify failed: %s", ntype, exc_info=True)
        return 0


# ── 내 알림·설정 ─────────────────────────────────────

def _setting(cid: str, sub: str) -> dict[str, Any]:
    item = table().get_item(Key={"PK": pk(cid), "SK": f"NOTIFY#{sub}"}).get("Item")
    return to_plain(item) if item else {}


@router.get("/company/<cid>/notifications")
def my_notifications(cid: str) -> dict[str, Any]:
    """내 알림 최근 50개 + 안 읽은 수"""
    ctx = company_ctx(router, cid)
    items = [to_plain(i) for i in table().query(KeyConditionExpression=Key("PK").eq(pk(cid)) & Key("SK").begins_with(f"NOTI#{ctx.sub}#"), ScanIndexForward=False, Limit=50)["Items"]]
    read_at = _setting(cid, ctx.sub).get("readAt", "")
    return {"notifications": [{k: i[k] for k in ("type", "title", "body", "url", "at")} | {"unread": i["at"] > read_at} for i in items], "unread": sum(1 for i in items if i["at"] > read_at)}


@router.post("/company/<cid>/notifications/read")
def mark_read(cid: str) -> dict[str, Any]:
    ctx = company_ctx(router, cid)
    at = now_iso()
    table().update_item(Key={"PK": pk(cid), "SK": f"NOTIFY#{ctx.sub}"}, UpdateExpression="SET readAt = :t, #s = :s", ExpressionAttributeNames={"#s": "sub"}, ExpressionAttributeValues={":t": at, ":s": ctx.sub})
    return {"readAt": at}


@router.get("/company/<cid>/notify/settings")
def get_settings(cid: str) -> dict[str, Any]:
    """알림 종류(권한 있는 것만)와 내 켜기, 푸시 공개 키, 내 기기 구독 수"""
    ctx = company_ctx(router, cid)
    prefs = _setting(cid, ctx.sub).get("prefs", {})
    types = [{"id": k, "label": v[0], "group": v[1], "on": bool(prefs.get(k, v[2]))} for k, v in TYPES.items() if _allowed(k, ctx.perms, ctx.show_amounts)]
    v = webpush.vapid()
    devices = len(_items(cid, f"PUSHSUB#{ctx.sub}#"))
    return {"types": types, "publicKey": v.public_key if v else None, "devices": devices}


@router.put("/company/<cid>/notify/settings")
def put_settings(cid: str) -> dict[str, Any]:
    ctx = company_ctx(router, cid)
    body = parse_body(router, Prefs)
    if any(k not in TYPES for k in body.prefs):
        raise BadRequestError("unknown notification type")
    current = _setting(cid, ctx.sub).get("prefs", {})
    merged = {**current, **body.prefs}
    table().update_item(Key={"PK": pk(cid), "SK": f"NOTIFY#{ctx.sub}"}, UpdateExpression="SET prefs = :p, #s = :s", ExpressionAttributeNames={"#s": "sub"}, ExpressionAttributeValues={":p": merged, ":s": ctx.sub})
    return {"prefs": merged}


def _sub_key(sub: str, endpoint: str) -> str:
    return f"PUSHSUB#{sub}#{hashlib.sha256(endpoint.encode()).hexdigest()[:16]}"


@router.post("/company/<cid>/push/subscribe")
def subscribe(cid: str) -> dict[str, Any]:
    """이 기기에서 폰 알림 받기 (브라우저 PushSubscription)"""
    ctx = company_ctx(router, cid)
    body = parse_body(router, SubscribeIn)
    if not body.keys.get("p256dh") or not body.keys.get("auth"):
        raise BadRequestError("keys.p256dh and keys.auth are required")
    table().put_item(Item={"PK": pk(cid), "SK": _sub_key(ctx.sub, body.endpoint), "sub": ctx.sub, "endpoint": body.endpoint, "keys": {"p256dh": body.keys["p256dh"], "auth": body.keys["auth"]}, "device": body.device, "createdAt": now_iso()})
    # 설정이 없는 사람(Host 등)도 받을 수 있게 설정 항목을 만들어 둔다
    table().update_item(Key={"PK": pk(cid), "SK": f"NOTIFY#{ctx.sub}"}, UpdateExpression="SET #s = :s", ExpressionAttributeNames={"#s": "sub"}, ExpressionAttributeValues={":s": ctx.sub})
    return {"subscribed": True}


@router.post("/company/<cid>/push/unsubscribe")
def unsubscribe(cid: str) -> dict[str, Any]:
    ctx = company_ctx(router, cid)
    body = parse_body(router, UnsubscribeIn)
    table().delete_item(Key={"PK": pk(cid), "SK": _sub_key(ctx.sub, body.endpoint)})
    return {"subscribed": False}


@router.post("/company/<cid>/push/test")
def push_test(cid: str) -> dict[str, Any]:
    """내 기기들에 시험 알림 (앱 안 목록에는 남기지 않음)"""
    ctx = company_ctx(router, cid)
    subs = _items(cid, f"PUSHSUB#{ctx.sub}#")
    if webpush.vapid() is None:
        raise BadRequestError("push is not configured")
    _push(cid, subs, {"title": "행컴퍼니 알림 시험", "body": "이 기기에서 알림을 받을 수 있습니다.", "url": f"/company/{cid}/notifications", "tag": "test"})
    return {"devices": len(subs)}


# ── 아침 확인 (새로 생긴 것만) ───────────────────────

def _new_keys(cid: str, ntype: str, keys: set[str]) -> set[str]:
    """지난번 목록과 비교해 새로 생긴 키. 이번 목록을 저장 (사라진 것은 빠지므로 다시 생기면 다시 알림)"""
    sk = f"ALERTSTATE#{ntype}"
    prev = set(to_plain(table().get_item(Key={"PK": pk(cid), "SK": sk}).get("Item", {})).get("keys", []))
    table().put_item(Item={"PK": pk(cid), "SK": sk, "keys": sorted(keys)[:1000], "at": now_iso()})
    return keys - prev


def _won(n: float) -> str:
    return f"{int(n):,}원"


def daily(cid: str, today: date) -> dict[str, int]:
    """회사 하나의 아침 확인. 종류별로 새로 생긴 건수"""
    from domains.company_rental import _assets, _contracts, _pending  # noqa: PLC0415 (순환 import 피함)
    from domains.company_txn import _open_charges  # noqa: PLC0415

    meta = to_plain(table().get_item(Key={"PK": pk(cid), "SK": "META"})["Item"])
    t = today.isoformat()
    base = f"/company/{cid}"
    sent: dict[str, int] = {}

    # 연체 미수: 청구 후 overdueDays(기본 30)일이 지나도 남은 청구
    limit = (today - timedelta(days=int(meta.get("overdueDays") or 30))).isoformat()
    partners = [p for p in _items(cid, "PARTNER#") if p.get("receivable", 0) > 0]
    overdue = {}
    for p in partners:
        for c in _open_charges(cid, p["id"], False):
            if c["date"] <= limit:
                overdue[c["id"]] = (p["name"], int(c["total"]) - int(c["paid"]))
    new = _new_keys(cid, "overdue", set(overdue))
    if new:
        names = sorted({overdue[k][0] for k in new})
        sent["overdue"] = notify(cid, "overdue", f"새로 연체된 미수 {len(new)}건", f"{names[0]}{f' 외 {len(names) - 1}곳' if len(names) > 1 else ''} · {_won(sum(overdue[k][1] for k in new))}", f"{base}/money")

    contracts = _contracts(cid)
    soon = (today + timedelta(days=EXPIRING_DAYS)).isoformat()
    expiring = {f"{c['id']}:{c['termEnd']}": c for c in contracts if c["status"] == "active" and c.get("termEnd") and c["termEnd"] <= soon}
    new = _new_keys(cid, "contract_expiring", set(expiring))
    if new:
        first = expiring[sorted(new)[0]]
        sent["contract_expiring"] = notify(cid, "contract_expiring", f"계약 만료 임박 {len(new)}건", f"{first['partnerName']} {first['no']} · {first['termEnd']}{' 외' if len(new) > 1 else ''}", f"{base}/contracts")

    assets = _assets(cid)
    pending = {f"{p['contractId']}:{p['month']}": p for c in contracts if (p := _pending(c, assets, t))}
    new = _new_keys(cid, "billing_due", set(pending))
    if new:
        first = pending[sorted(new)[0]]
        sent["billing_due"] = notify(cid, "billing_due", f"새 청구 대기 {len(new)}건", f"{first['partnerName']} {int(first['month'][5:7])}월{' 외' if len(new) > 1 else ''}", f"{base}/billing")

    readings = {}
    for c in contracts:
        if c["status"] != "active":
            continue
        for aid, m in c["machines"].items():
            last = assets.get(aid, {}).get("lastReading")
            if m.get("counter") and not m.get("endedAt") and (not last or last["date"] <= m.get("billedReadAt", "")):
                readings[f"{aid}:{m.get('billedReadAt', '')}"] = m["code"]
    new = _new_keys(cid, "readings_due", set(readings))
    if new:
        sent["readings_due"] = notify(cid, "readings_due", f"검침할 기기 {len(new)}대", ", ".join(sorted(readings[k] for k in new))[:120], f"{base}/readings")

    stale_day = (today - timedelta(days=STALE_DAYS)).isoformat()
    stale = {s["id"]: s for s in _items(cid, "SERVICE#") if s["status"] == "open" and s["date"] <= stale_day}
    new = _new_keys(cid, "service_stale", set(stale))
    if new:
        first = stale[sorted(new)[0]]
        sent["service_stale"] = notify(cid, "service_stale", f"{STALE_DAYS}일 넘은 A/S {len(new)}건", f"{first['partnerName']} · {first['symptom'][:40]}{' 외' if len(new) > 1 else ''}", f"{base}/services")
    return sent
