"""행컴퍼니 서비스 접수 (COMPANY.md 12장 C4 → C8 개편). 고장·점검·설치·원격 등을 한 곳에서 접수 → 진행 → 완료.

SERVICE#<id> (번호 AS-YYYY-NNNN)
- 유형(type): 회사 설정 serviceTypes (기본 고장·점검·설치·원격, 추가 가능). 설치는 세부(subtype): 신규 설치·기기 교체·수거
- 상태(status): open(접수) → in_progress(진행) → done(완료) | canceled. 예전 데이터(유형 없음)는 고장으로 본다
- 접수 내용(symptom)·진행 내용(progressNote)·처리 내용(done.action)·보고 내용(report)·특이사항(remark)
- 요청자·전화번호·방문 요청 일시·담당·접수자·긴급·지원 요청·부서, 접수/진행/완료 시각과 사람
- 점검 완료: 소모품 잔량(토너·드럼 KCMY, 회수통) + 카운터(A4/A3 흑백·컬러) → 카운터는 기기 검침으로 기록(청구에 반영)
- 수정하면 SERVICE#<id>#HIST#<시각>에 바뀐 칸을 남긴다. 삭제는 접수 단계에서만(그 뒤는 서비스 취소)
완료할 때 사용 부품·작업비가 있으면 A/S 거래(type=service) → 부품 재고 감소, 금액이 있으면 미수.
금액을 못 보는 현장 기사는 부품만 넣고 "유상" 표시 → 사무실이 나중에 청구(청구 거래의 serviceId). A/S 거래를 취소하면 접수 상태로
"""

from datetime import date
from typing import Annotated, Any, Literal
from uuid import uuid4

from aws_lambda_powertools.event_handler.api_gateway import Router
from aws_lambda_powertools.event_handler.exceptions import BadRequestError
from boto3.dynamodb.conditions import Key
from pydantic import BaseModel, ConfigDict, Field

from common.aws import table
from common.http import parse_body
from common.serialize import to_plain
from common.users import now_iso
from domains.company_core import CompanyCtx, company_audit, company_ctx, member_names, pk
from domains.company_master import asset_log, next_seq
from domains.company_notify import notify
from domains.company_txn import ID, LineIn, Tx, TxnCreate, _get, _strip, _view, build_txn, finish_txn
from domains.sharing import query_all

router = Router()
Day = date

DEFAULT_TYPES = ["고장", "점검", "설치", "원격"]
INSTALL_SUBTYPES = ("신규 설치", "기기 교체", "수거")
CONSUMABLES = ("KT", "CT", "MT", "YT", "KD", "CD", "MD", "YD", "WTC")  # 토너 K·C·M·Y, 드럼 K·C·M·Y, 회수통
ACTIVE = ("open", "in_progress")
EDITABLE = ("type", "subtype", "symptom", "requester", "phone", "contact", "visitAt", "assignee", "urgent", "support", "department", "progressNote", "report", "remark")
DateTime = Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$")]
Level = Annotated[int, Field(ge=0, le=100)]
Counter = Annotated[int, Field(ge=0, le=100_000_000)]


class ServiceFields(BaseModel):
    """접수·수정 공통 칸 (보낸 것만 바뀐다)"""

    model_config = ConfigDict(extra="forbid")

    type: str | None = Field(default=None, min_length=1, max_length=10)
    subtype: str | None = Field(default=None, max_length=10)
    symptom: str | None = Field(default=None, min_length=1, max_length=500)  # 접수 내용
    requester: str | None = Field(default=None, max_length=30)  # 요청자
    phone: str | None = Field(default=None, max_length=30)
    contact: str | None = Field(default=None, max_length=60)  # 현장 연락처 (예전 칸)
    visitAt: DateTime | Literal[""] | None = None  # 방문 요청 일시
    assignee: str | None = Field(default=None, max_length=60)  # 담당 직원 sub ("" = 정하지 않음)
    urgent: bool | None = None
    support: bool | None = None  # 지원 요청
    department: str | None = Field(default=None, max_length=40)
    progressNote: str | None = Field(default=None, max_length=1000)  # 진행 내용
    report: str | None = Field(default=None, max_length=1000)  # 보고 내용
    remark: str | None = Field(default=None, max_length=1000)  # 특이사항


class ServiceCreate(ServiceFields):
    partnerId: str = Field(pattern=ID)
    assetId: str | None = Field(default=None, pattern=ID)
    date: Day | None = None  # 접수일 (비우면 오늘)
    symptom: str = Field(min_length=1, max_length=500)


class Counters(BaseModel):
    model_config = ConfigDict(extra="forbid")

    a4Mono: Counter | None = None
    a4Color: Counter | None = None
    a3Mono: Counter | None = None
    a3Color: Counter | None = None


class ServiceDone(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date: Day
    action: str = Field(min_length=1, max_length=1000)  # 처리 내용
    method: str = Field(default="", max_length=20)  # 처리방식 (방문·전산·원격 등)
    parts: list[LineIn] = Field(default_factory=list, max_length=20)  # 사용 부품 (수량 품목)
    fees: list[LineIn] = Field(default_factory=list, max_length=10)  # 출장비·작업비
    billable: bool = False  # 유상 (금액은 사무실이 나중에 청구할 때)
    report: str | None = Field(default=None, max_length=1000)
    remark: str | None = Field(default=None, max_length=1000)
    consumables: dict[str, Level] = Field(default_factory=dict)  # 잔량 %
    counters: Counters | None = None  # 점검: 지금 카운터 → 기기 검침


class StartBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note: str = Field(default="", max_length=1000)


class CancelBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(default="", max_length=200)


# ── 도우미 ───────────────────────────────────────────

def service_types(cid: str) -> list[str]:
    meta = table().get_item(Key={"PK": pk(cid), "SK": "META"})["Item"]
    return list(meta.get("serviceTypes") or DEFAULT_TYPES)


def _check_type(cid: str, t: str | None, subtype: str | None) -> None:
    if t is not None and t not in service_types(cid):
        raise BadRequestError(f"unknown service type: {t}")
    if subtype and t == "설치" and subtype not in INSTALL_SUBTYPES:
        raise BadRequestError("install subtype must be 신규 설치, 기기 교체, 수거")


def _list(cid: str) -> list[dict[str, Any]]:
    return [_strip(s) for s in query_all(KeyConditionExpression=Key("PK").eq(pk(cid)) & Key("SK").begins_with("SERVICE#")) if "#HIST#" not in s["SK"]]


def _out(s: dict[str, Any], names: dict[str, str], assets: dict[str, dict[str, Any]] | None = None) -> dict[str, Any]:
    """화면용: 사람 이름, 유형 기본값, 기기 판매구분·제조번호"""
    out = {**s, "type": s.get("type") or "고장"}
    for key, field in (("assignee", "assigneeName"), ("createdBy", "createdByName"), ("startedBy", "startedByName")):
        if s.get(key):
            out[field] = names.get(s[key], "")
    if s.get("done", {}).get("by"):
        out["doneByName"] = names.get(s["done"]["by"], "")
    a = (assets or {}).get(s.get("assetId", ""))
    if a:
        out["assetSerial"] = a.get("serial", "")
        out["saleType"] = a.get("saleType") or ("임대" if a.get("status") == "rented" else "")
    return out


def _ended(s: dict[str, Any]) -> str:
    return s.get("done", {}).get("at") or s.get("canceledAt") or s.get("createdAt", "")


def _assets(cid: str) -> dict[str, dict[str, Any]]:
    return {a["id"]: to_plain(a) for a in query_all(KeyConditionExpression=Key("PK").eq(pk(cid)) & Key("SK").begins_with("ASSET#")) if "#LOG#" not in a["SK"]}


def _what(s: dict[str, Any]) -> str:
    code = f" · {s['assetCode']}" if s.get("assetCode") else ""
    return f"{s['partnerName']}{code} · {s['symptom'][:60]}"


def _label(s: dict[str, Any]) -> str:
    t = s.get("type") or "고장"
    return f"{t}{f'({s['subtype']})' if s.get('subtype') else ''}"


# ── 조회 ─────────────────────────────────────────────

@router.get("/company/<cid>/services")
def list_services(cid: str) -> dict[str, Any]:
    """?status=open|in_progress|done|canceled|active(접수+진행), ?type, ?assetId, ?partnerId,
    ?doneSince=YYYY-MM-DD (끝난 것은 그날 이후에 끝난·취소한 것만 — 홈 현황판). 진행 중인 것 먼저(긴급·오래된 순)"""
    company_ctx(router, cid, "assets")
    q = router.current_event.get_query_string_value
    status = q("status")
    items = [s for s in _list(cid) if (not status or (s["status"] in ACTIVE if status == "active" else s["status"] == status)) and all(not q(k) or s.get(k) == q(k) for k in ("assetId", "partnerId"))]
    if q("type"):
        items = [s for s in items if (s.get("type") or "고장") == q("type")]
    if q("doneSince"):
        items = [s for s in items if s["status"] in ACTIVE or _ended(s) >= q("doneSince")]
    active = sorted([s for s in items if s["status"] in ACTIVE], key=lambda s: (not s.get("urgent"), s.get("createdAt", s["date"])))
    rest = sorted([s for s in items if s["status"] not in ACTIVE], key=_ended, reverse=True)
    names, assets = member_names(cid), _assets(cid)
    return {"services": [_out(s, names, assets) for s in active + rest], "types": service_types(cid)}


@router.get("/company/<cid>/services/<sid>")
def get_service(cid: str, sid: str) -> dict[str, Any]:
    ctx = company_ctx(router, cid, "assets")
    s = _strip(_get(cid, f"SERVICE#{sid}", "service"))
    txn = None
    if s.get("txn"):
        t = table().get_item(Key={"PK": pk(cid), "SK": f"TXN#{s['txn']['date']}#{s['txn']['id']}"}).get("Item")
        txn = _view(ctx, t) if t else None
    names = member_names(cid)
    hist = [_strip(h) for h in query_all(KeyConditionExpression=Key("PK").eq(pk(cid)) & Key("SK").begins_with(f"SERVICE#{sid}#HIST#"), ScanIndexForward=False)]
    for h in hist:
        h["actorName"] = names.get(h.get("actor", ""), "")
    asset = _assets(cid).get(s.get("assetId", "")) if s.get("assetId") else None
    return {"service": _out(s, names, {asset["id"]: asset} if asset else None), "txn": txn, "history": hist, "types": service_types(cid)}


# ── 접수·수정·삭제 ───────────────────────────────────

def _hist(cid: str, sid: str, actor: str, action: str, changes: dict[str, Any]) -> dict[str, Any]:
    at = now_iso()
    return {"PK": pk(cid), "SK": f"SERVICE#{sid}#HIST#{at}#{uuid4().hex[:4]}", "at": at, "actor": actor, "action": action, "changes": changes}


@router.post("/company/<cid>/services")
def create_service(cid: str) -> dict[str, Any]:
    ctx = company_ctx(router, cid, "assets", "edit")
    body = parse_body(router, ServiceCreate)
    t = body.type or "고장"
    _check_type(cid, t, body.subtype)
    partner = _get(cid, f"PARTNER#{body.partnerId}", "partner")
    asset = _get(cid, f"ASSET#{body.assetId}", "asset") if body.assetId else None
    item = _get(cid, f"ITEM#{asset['itemId']}", "item") if asset else None
    day = (body.date or date.today()).isoformat()
    sid = uuid4().hex[:10]
    fields = {k: v for k, v in body.model_dump(exclude={"partnerId", "assetId", "date"}, exclude_none=True).items() if v not in ("", None)}
    s = {
        "PK": pk(cid),
        "SK": f"SERVICE#{sid}",
        "id": sid,
        "no": f"AS-{day[:4]}-{next_seq(cid, f'service#{day[:4]}'):04d}",
        "status": "open",
        "date": day,
        "partnerId": partner["id"],
        "partnerName": partner["name"],
        "contact": "",
        **fields,
        "type": t,
        "createdBy": ctx.sub,
        "createdAt": now_iso(),
        "ver": 1,
        **({"assetId": asset["id"], "assetCode": asset["code"], "itemName": item["name"]} if asset and item else {}),  # type: ignore[index]
    }
    tx = Tx()
    tx.put(s, "attribute_not_exists(PK)")
    if asset:
        tx.put(asset_log(cid, asset["id"], ctx.sub, "service_open", serviceNo=s["no"], note=f"[{_label(s)}] {body.symptom}"))
    tx.put(company_audit(cid, ctx.sub, "service_create", s["no"], {"partner": partner["name"], "type": _label(s)}))
    tx.run()
    url = f"/company/{cid}/services/{sid}"
    notify(cid, "service_new", f"{'[긴급] ' if s.get('urgent') else ''}{_label(s)} 접수 {s['no']}", _what(s), url, exclude=ctx.sub)
    if s.get("assignee") and s["assignee"] != ctx.sub:
        notify(cid, "service_assigned", f"내게 {_label(s)} 배정 {s['no']}", _what(s), url, only=[s["assignee"]])
    return {"service": _strip(s)}


@router.patch("/company/<cid>/services/<sid>")
def patch_service(cid: str, sid: str) -> dict[str, Any]:
    """접수·진행 중에는 모든 칸, 완료 후에는 보고 내용·특이사항만. 바뀐 칸은 수정 이력에"""
    ctx = company_ctx(router, cid, "assets", "edit")
    changes = parse_body(router, ServiceFields).model_dump(exclude_unset=True)
    s = _get(cid, f"SERVICE#{sid}", "service")
    if s["status"] == "canceled":
        raise BadRequestError("canceled service")
    if s["status"] == "done" and set(changes) - {"report", "remark"}:
        raise BadRequestError("completed service: only report and remark can be edited")
    if "type" in changes or "subtype" in changes:
        _check_type(cid, changes.get("type", s.get("type") or "고장"), changes.get("subtype", s.get("subtype")))
    if "symptom" in changes and not changes["symptom"]:
        raise BadRequestError("symptom is required")
    diff = {k: {"from": s.get(k, ""), "to": v if v is not None else ""} for k, v in changes.items() if s.get(k, "") != (v if v is not None else "")}
    if not diff:
        return {"service": _out(_strip(s), member_names(cid))}
    merged = {**s, "ver": s["ver"] + 1, "updatedAt": now_iso()}
    for k, v in changes.items():
        if v in (None, ""):
            merged.pop(k, None)
        else:
            merged[k] = v
    tx = Tx()
    tx.put({**merged, "PK": pk(cid), "SK": f"SERVICE#{sid}"}, "ver = :v", values={":v": s["ver"]}, fail="서비스 기록이 바뀌었습니다. 새로 고친 뒤 다시 시도하세요")
    tx.put(_hist(cid, sid, ctx.sub, "edit", diff))
    tx.run()
    new_assignee = changes.get("assignee")
    if new_assignee and new_assignee != s.get("assignee") and new_assignee != ctx.sub:
        notify(cid, "service_assigned", f"내게 {_label(merged)} 배정 {s['no']}", _what(merged), f"/company/{cid}/services/{sid}", only=[new_assignee])
    return {"service": _out(_strip(merged), member_names(cid))}


@router.delete("/company/<cid>/services/<sid>")
def delete_service(cid: str, sid: str) -> dict[str, Any]:
    """접수 단계에서만 삭제 (잘못 접수). 진행·완료 뒤에는 서비스 취소"""
    ctx = company_ctx(router, cid, "assets", "edit")
    s = _get(cid, f"SERVICE#{sid}", "service")
    if s["status"] != "open" or s.get("txn"):
        raise BadRequestError("only services still in 접수 can be deleted; cancel it instead")
    hist = query_all(KeyConditionExpression=Key("PK").eq(pk(cid)) & Key("SK").begins_with(f"SERVICE#{sid}#HIST#"))
    tx = Tx()
    tx.delete({"PK": pk(cid), "SK": f"SERVICE#{sid}"}, "#st = :o AND ver = :v", {"#st": "status"}, {":o": "open", ":v": s["ver"]}, "서비스 기록이 바뀌었습니다. 새로 고친 뒤 다시 시도하세요")
    if s.get("assetId"):
        tx.put(asset_log(cid, s["assetId"], ctx.sub, "service_delete", serviceNo=s["no"]))
    tx.put(company_audit(cid, ctx.sub, "service_delete", s["no"], {"partner": s["partnerName"]}))
    tx.run()
    with table().batch_writer() as batch:
        for h in hist:
            batch.delete_item(Key={"PK": h["PK"], "SK": h["SK"]})
    return {"deleted": sid}


# ── 단계: 진행 · 완료 · 취소 ─────────────────────────

@router.post("/company/<cid>/services/<sid>/start")
def start_service(cid: str, sid: str) -> dict[str, Any]:
    """접수 → 진행 (진행 내용을 같이 적을 수 있음)"""
    ctx = company_ctx(router, cid, "assets", "edit")
    note = parse_body(router, StartBody).note.strip()
    s = _get(cid, f"SERVICE#{sid}", "service")
    if s["status"] != "open":
        raise BadRequestError("service is not in 접수")
    at = now_iso()
    vals: dict[str, Any] = {":p": "in_progress", ":o": "open", ":at": at, ":by": ctx.sub, ":one": 1}
    expr = "SET #st = :p, startedAt = :at, startedBy = :by, ver = ver + :one"
    if note:
        vals[":n"] = note
        expr += ", progressNote = :n"
    tx = Tx()
    tx.update({"PK": pk(cid), "SK": f"SERVICE#{sid}"}, expr, {"#st": "status"}, vals, "#st = :o", "이미 진행 중이거나 끝난 서비스입니다")
    tx.put(_hist(cid, sid, ctx.sub, "start", {"progressNote": {"from": s.get("progressNote", ""), "to": note}} if note else {}))
    tx.run()
    return {"service": _out(_strip(_get(cid, f"SERVICE#{sid}", "service")), member_names(cid))}


def _done_ops(ctx: CompanyCtx, cid: str, s: dict[str, Any], body: ServiceDone, tx: Tx, txn: dict[str, Any] | None) -> None:
    day = body.date.isoformat()
    counters = {k: v for k, v in (body.counters.model_dump() if body.counters else {}).items() if v is not None}
    consumables = {k: v for k, v in body.consumables.items() if k in CONSUMABLES}
    done = {"date": day, "action": body.action, "method": body.method, "by": ctx.sub, "at": now_iso(), **({"consumables": consumables} if consumables else {}), **({"counters": counters} if counters else {})}
    vals: dict[str, Any] = {":d": "done", ":done": done, ":v": s["ver"], ":one": 1, ":o": "open", ":p": "in_progress", ":nb": body.billable and not (txn or {}).get("total")}
    expr = "SET #st = :d, done = :done, needsBilling = :nb, ver = ver + :one"
    if txn:
        vals[":t"] = {"id": txn["id"], "date": txn["date"], "no": txn["no"]}
        expr += ", txn = :t"
    for k in ("report", "remark"):
        v = getattr(body, k)
        if v is not None:
            vals[f":{k}"] = v
            expr += f", {k} = :{k}"
    tx.update({"PK": pk(cid), "SK": f"SERVICE#{s['id']}"}, expr, {"#st": "status"}, vals, "(#st = :o OR #st = :p) AND ver = :v", "서비스 기록이 바뀌었습니다. 새로 고친 뒤 다시 시도하세요")
    tx.put(_hist(cid, s["id"], ctx.sub, "done", {"action": {"from": "", "to": body.action}}))
    if s.get("assetId"):
        tx.put(asset_log(cid, s["assetId"], ctx.sub, "service_done", serviceNo=s["no"], note=f"[{_label(s)}] {body.action}", txnNo=(txn or {}).get("no", "")))
        if counters.get("a4Mono") is not None:
            _reading_ops(ctx, cid, s, day, counters, tx)


def _reading_ops(ctx: CompanyCtx, cid: str, s: dict[str, Any], day: str, counters: dict[str, int], tx: Tx) -> None:
    """점검 카운터 → 기기 검침 (흑백·컬러 = A4, A3는 따로 보관). 카운터는 줄어들 수 없다 (검침 화면과 같은 규칙)"""
    a = _get(cid, f"ASSET#{s['assetId']}", "asset")
    prev = a.get("lastReading")
    mono, color = counters["a4Mono"], counters.get("a4Color", 0)
    if prev and (mono < int(prev["mono"]) or color < int(prev.get("color") or 0)):
        raise BadRequestError(f"카운터가 지난 검침보다 작습니다 ({int(prev['mono']):,} / {int(prev.get('color') or 0):,}). 검침 화면에서 정정하세요")
    reading = {"date": day, "mono": mono, "color": color, "a3Mono": counters.get("a3Mono", 0), "a3Color": counters.get("a3Color", 0), "note": f"{s.get('type') or '점검'} {s['no']}"}
    key = {"PK": pk(cid), "SK": f"ASSET#{a['id']}"}
    if prev:
        tx.update(key, "SET lastReading = :r, updatedAt = :now", {"#d": "date"}, {":r": reading, ":now": now_iso(), ":pd": prev["date"], ":pm": prev["mono"]}, "lastReading.#d = :pd AND lastReading.mono = :pm", "다른 검침이 먼저 들어왔습니다. 새로 고친 뒤 다시 시도하세요")
    else:
        tx.update(key, "SET lastReading = :r, updatedAt = :now", None, {":r": reading, ":now": now_iso()}, "attribute_exists(PK) AND attribute_not_exists(lastReading)", "다른 검침이 먼저 들어왔습니다. 새로 고친 뒤 다시 시도하세요")
    tx.put(asset_log(cid, a["id"], ctx.sub, "reading", mono=mono, color=color, a3Mono=reading["a3Mono"], a3Color=reading["a3Color"], date=day, note=f"점검 {s['no']}"))


@router.post("/company/<cid>/services/<sid>/complete")
def complete_service(cid: str, sid: str) -> dict[str, Any]:
    """완료: 부품·작업비가 있으면 A/S 거래(재고 감소, 금액이 있으면 미수)와 함께. 점검 카운터는 기기 검침으로"""
    ctx = company_ctx(router, cid, "assets", "edit")
    body = parse_body(router, ServiceDone)
    s = _get(cid, f"SERVICE#{sid}", "service")
    if s["status"] not in ACTIVE:
        raise BadRequestError("service is not open")
    if body.date.isoformat() < s["date"]:
        raise BadRequestError("done date is before the request date")
    if any(not p.itemId for p in body.parts):
        raise BadRequestError("parts need itemId")
    if body.counters and not s.get("assetId") and any(v is not None for v in body.counters.model_dump().values()):
        raise BadRequestError("counters need an asset")
    lines = [*body.parts, *body.fees]
    if lines:
        b = build_txn(
            ctx,
            cid,
            TxnCreate(type="service", date=body.date, partnerId=s["partnerId"], lines=lines, memo=f"{s['no']} {body.action}"[:500]),
            extra={"serviceId": s["id"], "serviceNo": s["no"], **({"assetIds": [s["assetId"]], "assetCodes": [s["assetCode"]], "assetNames": [s.get("itemName", "")]} if s.get("assetId") else {})},
        )
        _done_ops(ctx, cid, s, body, b.tx, b.txn)
        res = finish_txn(b)
    else:
        tx = Tx()
        _done_ops(ctx, cid, s, body, tx, None)
        tx.put(company_audit(cid, ctx.sub, "service_done", s["no"]))
        tx.run()
        res = {}
    notify(cid, "service_done", f"{_label(s)} 완료 {s['no']}", f"{s['partnerName']} · {body.action[:60]}", f"/company/{cid}/services/{sid}", exclude=ctx.sub)
    return {"service": _out(_strip(_get(cid, f"SERVICE#{sid}", "service")), member_names(cid)), **res}


@router.post("/company/<cid>/services/<sid>/cancel")
def cancel_service(cid: str, sid: str) -> dict[str, Any]:
    """서비스 취소 (접수·진행 중만). 완료한 서비스는 A/S 거래를 취소하면 접수 상태로 돌아간다"""
    ctx = company_ctx(router, cid, "assets", "edit")
    reason = parse_body(router, CancelBody).reason
    s = _get(cid, f"SERVICE#{sid}", "service")
    tx = Tx()
    tx.update({"PK": pk(cid), "SK": f"SERVICE#{sid}"}, "SET #st = :c, cancelReason = :r, canceledAt = :at, canceledBy = :by, ver = ver + :one", {"#st": "status"}, {":c": "canceled", ":r": reason, ":one": 1, ":o": "open", ":p": "in_progress", ":at": now_iso(), ":by": ctx.sub}, "#st = :o OR #st = :p", "접수·진행 중인 서비스만 취소할 수 있습니다")
    tx.put(_hist(cid, sid, ctx.sub, "cancel", {"reason": {"from": "", "to": reason}}))
    if s.get("assetId"):
        tx.put(asset_log(cid, s["assetId"], ctx.sub, "service_cancel", serviceNo=s["no"], note=reason))
    tx.put(company_audit(cid, ctx.sub, "service_cancel", s["no"], {"reason": reason}))
    tx.run()
    return {"service": _out(_strip(_get(cid, f"SERVICE#{sid}", "service")), member_names(cid))}


# ── 설치(신규 설치·기기 교체·수거) ↔ 계약 출고·수거 ───────

def link_contract_op(ctx: CompanyCtx, cid: str, sid: str, partner_id: str, tx: Tx, day: str, op: Literal["out", "return"], txn: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """계약 출고·수거를 설치 접수에서 했을 때 같은 트랜잭션에서 서비스를 넘긴다.
    수거 접수는 수거로, 신규 설치는 출고로 완료. 기기 교체는 수거하면 진행, 새 기기 출고하면 완료. (서비스, 완료했는지)"""
    s = _get(cid, f"SERVICE#{sid}", "service")
    if s["status"] not in ACTIVE:
        raise BadRequestError("service is not open")
    if s.get("type") != "설치" or s["partnerId"] != partner_id:
        raise BadRequestError("only an install service of the same partner can be linked")
    if (s.get("subtype"), op) in (("신규 설치", "return"), ("수거", "out")):
        raise BadRequestError("this install service does not match the contract operation")
    finish = not (s.get("subtype") == "기기 교체" and op == "return")
    what = f"{'출고' if op == 'out' else '수거'} {txn['no']}"
    link = {"id": txn["id"], "date": txn["date"], "no": txn["no"], "op": op}
    key = {"PK": pk(cid), "SK": f"SERVICE#{sid}"}
    vals: dict[str, Any] = {":l": [link], ":empty": [], ":one": 1, ":v": s["ver"], ":at": now_iso(), ":by": ctx.sub}
    if finish:
        vals |= {":d": "done", ":done": {"date": day, "action": what, "method": "방문", "by": ctx.sub, "at": now_iso()}, ":f": False}
        expr = "SET #st = :d, done = :done, needsBilling = :f, links = list_append(if_not_exists(links, :empty), :l), ver = ver + :one"
    else:
        vals |= {":p": "in_progress"}
        expr = "SET #st = :p, startedAt = if_not_exists(startedAt, :at), startedBy = if_not_exists(startedBy, :by), links = list_append(if_not_exists(links, :empty), :l), ver = ver + :one"
    tx.update(key, expr, {"#st": "status"}, vals, "ver = :v", "서비스 기록이 바뀌었습니다. 새로 고친 뒤 다시 시도하세요")
    tx.put(_hist(cid, sid, ctx.sub, "done" if finish else "link", {"action": {"from": "", "to": what}}))
    return s, finish


def notify_linked(cid: str, actor: str, s: dict[str, Any], finished: bool) -> None:
    if finished:
        notify(cid, "service_done", f"{_label(s)} 완료 {s['no']}", f"{s['partnerName']} · {s['symptom'][:60]}", f"/company/{cid}/services/{s['id']}", exclude=actor)


def unlink_on_cancel(cid: str, sid: str, tid: str, tx: Tx) -> None:
    """설치 접수로 한 출고·수거를 취소하면 완료했던 서비스는 다시 진행으로 (이력은 남김)"""
    s = table().get_item(Key={"PK": pk(cid), "SK": f"SERVICE#{sid}"}).get("Item")
    if s and s["status"] == "done" and any(x["id"] == tid for x in s.get("links", [])):
        tx.update({"PK": pk(cid), "SK": f"SERVICE#{sid}"}, "SET #st = :p, ver = ver + :one REMOVE done", {"#st": "status"}, {":p": "in_progress", ":one": 1, ":v": s["ver"]}, "ver = :v", "서비스 기록이 바뀌었습니다")
