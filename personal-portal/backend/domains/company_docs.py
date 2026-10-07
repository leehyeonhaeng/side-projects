"""행컴퍼니 문서 (COMPANY.md 7장, C5): 직인 PDF 발행·보관·다시 받기, 거래처 원장·기기 라벨 출력, 직인 관리.

발행 문서 DOC#<id> (번호 종류별 연도 순번 R- 영수증 / S- 거래명세서 / B- 청구서 / W- 작업 확인서)
- 필요할 때 버튼으로 발행. 영수증·명세서·작업 확인서는 원본 하나당 한 번(DOCREF#<종류>#<원본 id>) → 다시 누르면 같은 파일
- 발행할 때 그린 PDF를 S3(company/<cid>/docs/<번호>.pdf)에 보관 → 누가 언제 받아도 같은 파일
- 그릴 때 쓴 값(snapshot)과 직인 버전도 저장: 원본 거래가 취소되면(DOCSRC#<거래 id>#<문서 id>로 찾음) 같은 값으로 "취소됨" 워터마크 판을 그린다
- 거래처 원장·기기 라벨은 증빙이 아니라 출력물이라 번호 없이 그때그때 그린다
직인: 회사가 올린 이미지(S3 company/<cid>/seal.png, 버전 관리) 또는 예시 직인. 문서에는 발행 당시 버전이 찍힌다
PDF는 API로 base64(내려받기·공유용) + 10분짜리 서명 URL(새 탭에서 열어 인쇄용)을 같이 돌려준다.
그때그때 그리는 출력물(원장·라벨·취소 판)은 tmp/에 올려 서명 URL을 만들고, 버킷 수명 규칙이 하루 뒤 지운다
"""

import base64
import io
import os
from datetime import date
from typing import Annotated, Any, Literal
from urllib.parse import quote
from uuid import uuid4

from aws_lambda_powertools.event_handler.api_gateway import Router
from aws_lambda_powertools.event_handler.exceptions import BadRequestError, ForbiddenError
from boto3.dynamodb.conditions import Key
from pydantic import BaseModel, ConfigDict, Field

from common.aws import s3, table
from common.http import parse_body
from common.serialize import to_plain
from common.users import now_iso
from domains import company_pdf
from domains.company_core import CompanyCtx, company_audit, company_ctx, member_names, pk
from domains.company_master import next_seq
from domains.company_txn import CHARGE_TYPES, ID, TYPE_LABEL, Tx, _get, _open_charges, _partner_txns, _strip, _summary, _txn_sk
from domains.sharing import query_all

router = Router()

DOC_TYPES: dict[str, tuple[str, str]] = {"receipt": ("영수증", "R"), "statement": ("거래명세서", "S"), "invoice": ("청구서", "B"), "work": ("작업 확인서", "W")}
MONEY_DOCS = {"receipt", "statement", "invoice"}
STATEMENT_TYPES = {"sale", "charge", "rental_out", "rental_return", "service"}
COMPANY_FIELDS = ("name", "bizNo", "ceo", "address", "phone", "fax", "email", "bizType", "bizItem", "bankAccount")
PARTNER_FIELDS = ("name", "bizNo", "ceo", "address", "phone")
MAX_SEAL_BYTES = 1_000_000


def _bucket() -> str:
    return os.environ["DOCS_BUCKET"]


# ── 요청 본문 ────────────────────────────────────────

class DocIssue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["receipt", "statement", "work"]
    txnDate: date | None = None
    txnId: str | None = Field(default=None, pattern=ID)
    serviceId: str | None = Field(default=None, pattern=ID)


class TxnRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date: date
    id: str = Field(pattern=ID)


class InvoiceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    partnerId: str = Field(pattern=ID)
    date: date
    txns: list[TxnRef] = Field(min_length=1, max_length=50)
    previous: bool = True  # 고르지 않은 남은 청구(이전 미수) 합계
    counters: bool = True  # 정기 청구의 검침 카운터
    bank: bool = True  # 입금 계좌
    memo: str = Field(default="", max_length=300)


class LedgerIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    partnerId: str = Field(pattern=ID)
    from_: date = Field(alias="from")
    to: date


class LabelsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    assetIds: list[Annotated[str, Field(pattern=ID)]] = Field(min_length=1, max_length=200)
    kind: Literal["a4-21", "a4-24", "a4-14", "roll-50x30", "roll-60x40", "roll-40x30"] = "a4-21"
    start: int = Field(default=0, ge=0, le=40)  # A4 라벨지: 이미 쓴 칸 건너뛰기
    nudgeX: float = Field(default=0, ge=-10, le=10)  # 프린터마다 어긋나는 위치 보정 (mm)
    nudgeY: float = Field(default=0, ge=-10, le=10)
    outline: bool = False  # 칸 테두리 (맞춰 보기용)
    baseUrl: str = Field(pattern=r"^https?://[A-Za-z0-9.:\-]+$", max_length=100)  # QR이 여는 행포털 주소


class SealIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: str = Field(max_length=int(MAX_SEAL_BYTES * 1.4))  # base64 (PNG·JPG)


# ── 스냅샷·직인 ──────────────────────────────────────

def _meta(cid: str) -> dict[str, Any]:
    return to_plain(table().get_item(Key={"PK": pk(cid), "SK": "META"})["Item"])


def _company_snap(meta: dict[str, Any]) -> dict[str, Any]:
    return {k: meta.get(k, "") for k in COMPANY_FIELDS}


def _partner_snap(cid: str, pid: str) -> dict[str, Any]:
    p = _get(cid, f"PARTNER#{pid}", "partner")
    return {k: p.get(k, "") for k in PARTNER_FIELDS}


def _seal_key(cid: str) -> str:
    return f"company/{cid}/seal.png"


def _seal_at(cid: str, version: str) -> bytes | None:
    if not version:
        return None
    obj = s3().get_object(Bucket=_bucket(), Key=_seal_key(cid), VersionId=version)
    return bytes(obj["Body"].read())


def _line(ln: dict[str, Any]) -> dict[str, Any]:
    return {k: ln.get(k) for k in ("name", "qty", "unit", "unitPrice", "supply", "vat", "total", "memo") if ln.get(k) is not None}


def _txn_snap(t: dict[str, Any]) -> dict[str, Any]:
    keep = ("id", "no", "type", "date", "supply", "vat", "total", "paid", "amount", "accountName", "allocations", "unallocated", "assetCodes", "contractNo", "billMonth", "memo")
    return {k: t[k] for k in keep if k in t} | {"lines": [_line(ln) for ln in t.get("lines", [])]}


# ── 발행 ─────────────────────────────────────────────

def _can_issue(ctx: CompanyCtx, kind: str) -> None:
    if kind == "work":
        if not (ctx.can("docs", "edit") or ctx.can("assets", "edit")):
            raise ForbiddenError("no permission: docs")
        return
    if not ctx.can("docs", "edit"):
        raise ForbiddenError("no permission: docs")
    if not ctx.show_amounts:
        raise ForbiddenError("this document needs amount permission")


def _doc_view(ctx: CompanyCtx, d: dict[str, Any]) -> dict[str, Any]:
    out = {k: v for k, v in _strip(d).items() if k not in ("snapshot", "s3Key")}
    if not ctx.show_amounts:
        out.pop("total", None)
    return out


def _issue(ctx: CompanyCtx, cid: str, kind: str, day: str, snapshot: dict[str, Any], partner_id: str, sources: list[dict[str, Any]], ref: str | None, total: int, replace_ref: str | None = None) -> dict[str, Any]:
    """번호 매기고 → PDF 그려 S3에 → 문서·참조·활동 기록을 한 트랜잭션으로"""
    title, prefix = DOC_TYPES[kind]
    year = day[:4]
    no = f"{prefix}-{year}-{next_seq(cid, f'doc#{prefix}#{year}'):04d}"
    meta = _meta(cid)
    seal_version = str(meta.get("sealVersion", ""))
    snapshot = {**snapshot, "no": no, "date": day, "company": _company_snap(meta), "partner": _partner_snap(cid, partner_id), "issuedAt": now_iso()}
    pdf = company_pdf.RENDER[kind](snapshot, _seal_at(cid, seal_version))
    key = f"company/{cid}/docs/{no}.pdf"
    s3().put_object(Bucket=_bucket(), Key=key, Body=pdf, ContentType="application/pdf")
    did = uuid4().hex[:10]
    doc = {
        "PK": pk(cid),
        "SK": f"DOC#{did}",
        "id": did,
        "no": no,
        "type": kind,
        "title": title,
        "date": day,
        "partnerId": partner_id,
        "partnerName": snapshot["partner"]["name"],
        "sources": sources,
        "total": total,
        "canceled": False,
        "s3Key": key,
        "sealVersion": seal_version,
        "snapshot": snapshot,
        "issuedBy": ctx.sub,
        "issuedAt": snapshot["issuedAt"],
    }
    tx = Tx()
    tx.put(doc, "attribute_not_exists(PK)")
    if ref:
        item = {"PK": pk(cid), "SK": ref, "docId": did}
        if replace_ref:  # 취소된 문서의 원본을 다시 완료한 경우 (A/S) → 새 문서로 바꿔 단다
            tx.put(item, "docId = :old", values={":old": replace_ref}, fail="__exists__")
        else:
            tx.put(item, "attribute_not_exists(PK)", fail="__exists__")
    for s in sources:
        if s.get("kind") == "txn":
            tx.put({"PK": pk(cid), "SK": f"DOCSRC#{s['id']}#{did}", "docId": did})
    tx.put(company_audit(cid, ctx.sub, "doc_issue", no, {"type": title, "partner": snapshot["partner"]["name"]}))
    try:
        tx.run()
    except BadRequestError as exc:
        if str(exc.msg) != "__exists__" or not ref:
            raise
        s3().delete_object(Bucket=_bucket(), Key=key)  # 동시에 누른 다른 발행이 먼저 저장됨 → 그 문서를 쓴다
        existing = table().get_item(Key={"PK": pk(cid), "SK": ref})["Item"]
        return _strip(_get(cid, f"DOC#{existing['docId']}", "document"))
    return doc


def _existing(cid: str, ref: str) -> dict[str, Any] | None:
    item = table().get_item(Key={"PK": pk(cid), "SK": ref}).get("Item")
    return _get(cid, f"DOC#{item['docId']}", "document") if item else None


@router.post("/company/<cid>/docs")
def issue_doc(cid: str) -> dict[str, Any]:
    """영수증(입금)·거래명세서(판매·청구·임대·A/S)·작업 확인서(완료한 A/S). 이미 발행했으면 그 문서"""
    ctx = company_ctx(router, cid)
    body = parse_body(router, DocIssue)
    _can_issue(ctx, body.type)
    if body.type == "work":
        if not body.serviceId:
            raise BadRequestError("serviceId is required")
        ref = f"DOCREF#work#{body.serviceId}"
        old = _existing(cid, ref)
        if old and not old.get("canceled"):
            return {"doc": _doc_view(ctx, old), "created": False}
        sv = _get(cid, f"SERVICE#{body.serviceId}", "service")
        if sv["status"] != "done":
            raise BadRequestError("only completed A/S has a work confirmation")
        parts: list[dict[str, Any]] = []
        sources: list[dict[str, Any]] = [{"kind": "service", "id": sv["id"], "no": sv["no"]}]
        if sv.get("txn"):
            t = _get(cid, _txn_sk(sv["txn"]["date"], sv["txn"]["id"]), "transaction")
            parts = [{"name": ln.get("name", ""), "qty": ln.get("qty"), "unit": ln.get("unit", "")} for ln in t.get("lines", []) if ln.get("itemId")]
            sources.append({"kind": "txn", "id": t["id"], "date": t["date"], "no": t["no"]})
        done = sv.get("done", {})
        snap = {
            "service": {"no": sv["no"], "assetCode": sv.get("assetCode", ""), "itemName": sv.get("itemName", ""), "date": sv["date"], "symptom": sv["symptom"], "doneDate": done.get("date", ""), "action": done.get("action", ""), "technician": member_names(cid).get(done.get("by", ""), "")},
            "parts": parts,
            "billable": bool(sv.get("needsBilling") or sv.get("chargeTxn")),
        }
        doc = _issue(ctx, cid, "work", done.get("date") or date.today().isoformat(), snap, sv["partnerId"], sources, ref, 0, replace_ref=old["id"] if old else None)
        return {"doc": _doc_view(ctx, doc), "created": True}

    if not (body.txnDate and body.txnId):
        raise BadRequestError("txnDate and txnId are required")
    ref = f"DOCREF#{body.type}#{body.txnId}"
    old = _existing(cid, ref)
    if old:
        return {"doc": _doc_view(ctx, old), "created": False}
    t = _get(cid, _txn_sk(body.txnDate.isoformat(), body.txnId), "transaction")
    if t["status"] != "confirmed":
        raise BadRequestError("canceled transaction")
    if body.type == "receipt" and t["type"] != "receipt":
        raise BadRequestError("receipts are for incoming payments")
    if body.type == "statement" and (t["type"] not in STATEMENT_TYPES or not t.get("lines")):
        raise BadRequestError("this transaction has no statement")
    if not t.get("partnerId"):
        raise BadRequestError("transaction has no partner")
    doc = _issue(ctx, cid, body.type, t["date"], {"txn": _txn_snap(t)}, t["partnerId"], [{"kind": "txn", "id": t["id"], "date": t["date"], "no": t["no"]}], ref, int(t.get("total") or t.get("amount") or 0))
    return {"doc": _doc_view(ctx, doc), "created": True}


@router.post("/company/<cid>/docs/invoice")
def issue_invoice(cid: str) -> dict[str, Any]:
    """청구서: 거래처의 청구 건을 골라서 (이전 미수·카운터·입금 계좌는 선택). 낼 때마다 새 번호"""
    ctx = company_ctx(router, cid)
    _can_issue(ctx, "invoice")
    body = parse_body(router, InvoiceIn)
    picked: list[dict[str, Any]] = []
    for r in body.txns:
        t = _get(cid, _txn_sk(r.date.isoformat(), r.id), "transaction")
        if t.get("partnerId") != body.partnerId or t["type"] not in CHARGE_TYPES or t["status"] != "confirmed" or not t.get("total"):
            raise BadRequestError(f"{t['no']} is not a charge of this partner")
        picked.append(t)
    if len({t["id"] for t in picked}) != len(picked):
        raise BadRequestError("duplicate transactions")
    picked.sort(key=lambda t: (t["date"], t["createdAt"]))
    ids = {t["id"] for t in picked}
    previous = sum(int(c["total"]) - int(c["paid"]) for c in _open_charges(cid, body.partnerId, False) if c["id"] not in ids)
    items = [
        {"date": t["date"], "no": t["no"], "type": t["type"], "summary": _summary(t) if not t.get("billMonth") else f"{t.get('contractNo', '')} {int(t['billMonth'][5:7])}월 임대료", "total": int(t["total"]), "paid": int(t.get("paid") or 0), "lines": [_line(ln) for ln in t.get("lines", [])], "counters": t.get("billCounters", [])}
        for t in picked
    ]
    charged = sum(i["total"] for i in items)
    paid = sum(i["paid"] for i in items)
    totals = {"charged": charged, "paid": paid, "previous": previous, "due": charged - paid + (previous if body.previous else 0)}
    snap = {"items": items, "totals": totals, "options": {"previous": body.previous, "counters": body.counters, "bank": body.bank}, "memo": body.memo}
    sources = [{"kind": "txn", "id": t["id"], "date": t["date"], "no": t["no"]} for t in picked]
    doc = _issue(ctx, cid, "invoice", body.date.isoformat(), snap, body.partnerId, sources, None, totals["due"])
    return {"doc": _doc_view(ctx, doc), "created": True}


# ── 조회·받기 ────────────────────────────────────────

@router.get("/company/<cid>/docs")
def list_docs(cid: str) -> dict[str, Any]:
    """문서함 (번호 최신순). ?type ?partnerId ?source(원본 거래·A/S id)"""
    ctx = company_ctx(router, cid, "docs")
    q = router.current_event.get_query_string_value
    items = [d for d in query_all(KeyConditionExpression=Key("PK").eq(pk(cid)) & Key("SK").begins_with("DOC#"))]
    items = [d for d in items if (not q("type") or d["type"] == q("type")) and (not q("partnerId") or d["partnerId"] == q("partnerId")) and (not q("source") or any(s["id"] == q("source") for s in d.get("sources", [])))]
    items.sort(key=lambda d: d["issuedAt"], reverse=True)
    return {"docs": [_doc_view(ctx, d) for d in items]}


def _pdf_out(cid: str, filename: str, data: bytes, key: str | None = None, **extra: Any) -> dict[str, Any]:
    if key is None:
        key = f"tmp/{cid}/{uuid4().hex}.pdf"
        s3().put_object(Bucket=_bucket(), Key=key, Body=data, ContentType="application/pdf")
    url = s3().generate_presigned_url(
        "get_object",
        Params={"Bucket": _bucket(), "Key": key, "ResponseContentType": "application/pdf", "ResponseContentDisposition": f"inline; filename*=UTF-8''{quote(filename)}"},
        ExpiresIn=600,
    )
    return {"filename": filename, "contentType": "application/pdf", "data": base64.b64encode(data).decode(), "url": url, **extra}


@router.get("/company/<cid>/docs/<did>/pdf")
def get_doc_pdf(cid: str, did: str) -> dict[str, Any]:
    """보관한 파일 그대로. 원본이 취소됐으면 같은 값으로 '취소됨' 판을 그려서"""
    ctx = company_ctx(router, cid)
    d = _get(cid, f"DOC#{did}", "document")
    if not (ctx.can("docs") or (d["type"] == "work" and ctx.can("assets"))):
        raise ForbiddenError("no permission: docs")
    if d["type"] in MONEY_DOCS and not ctx.show_amounts:
        raise ForbiddenError("this document needs amount permission")
    name = f"{d['title']}_{d['no']}_{d['partnerName']}.pdf".replace("/", "_")
    if d.get("canceled"):
        data = company_pdf.RENDER[d["type"]](d["snapshot"], _seal_at(cid, d.get("sealVersion", "")), canceled=True)
        return _pdf_out(cid, name.replace(".pdf", "_취소.pdf"), data, canceled=True, no=d["no"])
    obj = s3().get_object(Bucket=_bucket(), Key=d["s3Key"])
    return _pdf_out(cid, name, bytes(obj["Body"].read()), key=d["s3Key"], canceled=False, no=d["no"])


# ── 출력물: 거래처 원장, 기기 라벨 ───────────────────

def _ledger_sides(cid: str, pid: str, frm: str, to: str) -> list[dict[str, Any]]:
    txns = [t for t in _partner_txns(cid)(pid) if t.get("status") == "confirmed"]
    txns.sort(key=lambda t: (t["date"], t["createdAt"]))
    defs = [
        ("매출 (청구·입금)", "청구", "입금", CHARGE_TYPES, {"receipt"}),
        ("매입 (매입·지급)", "매입", "지급", {"purchase"}, {"payment"}),
    ]
    sides = []
    for title, plus, minus, plus_types, minus_types in defs:
        def delta(t: dict[str, Any], pt: set[str] = plus_types, mt: set[str] = minus_types) -> tuple[int, int]:
            if t["type"] in pt:
                return int(t.get("total") or 0), 0
            if t["type"] in mt:
                return 0, int(t.get("amount") or 0)
            return 0, 0

        opening = sum(p - m for p, m in (delta(t) for t in txns if t["date"] < frm))
        bal, rows, ps, ms = opening, [], 0, 0
        for t in txns:
            if not (frm <= t["date"] <= to):
                continue
            p, m = delta(t)
            if not p and not m:
                continue
            bal += p - m
            ps, ms = ps + p, ms + m
            rows.append({"date": t["date"], "no": t["no"], "type": TYPE_LABEL.get(t["type"], t["type"]), "summary": _summary(t) if t["type"] not in ("receipt", "payment") else t.get("accountName", ""), "plus": p, "minus": m, "balance": bal})
        if rows or opening:
            sides.append({"title": title, "plus": plus, "minus": minus, "opening": opening, "rows": rows, "plusSum": ps, "minusSum": ms, "closing": bal})
    return sides


@router.post("/company/<cid>/print/ledger")
def print_ledger(cid: str) -> dict[str, Any]:
    ctx = company_ctx(router, cid, "money")
    if not ctx.show_amounts:
        raise ForbiddenError("needs amount permission")
    body = parse_body(router, LedgerIn)
    frm, to = body.from_.isoformat(), body.to.isoformat()
    if to < frm or (body.to - body.from_).days > 800:
        raise BadRequestError("range must be 0~800 days")
    meta = _meta(cid)
    snap = {"from": frm, "to": to, "company": _company_snap(meta), "partner": _partner_snap(cid, body.partnerId), "sides": _ledger_sides(cid, body.partnerId, frm, to), "issuedAt": now_iso()}
    return _pdf_out(cid, f"거래처원장_{snap['partner']['name']}_{frm}_{to}.pdf", company_pdf.ledger(snap))


@router.post("/company/<cid>/print/labels")
def print_labels(cid: str) -> dict[str, Any]:
    """기기 라벨: QR(기기 화면 주소) + 회사·고유번호·모델·제조번호·A/S 전화"""
    company_ctx(router, cid, "assets")
    body = parse_body(router, LabelsIn)
    meta = _meta(cid)
    items = {i["id"]: i["name"] for i in query_all(KeyConditionExpression=Key("PK").eq(pk(cid)) & Key("SK").begins_with("ITEM#"))}
    assets = []
    for aid in body.assetIds:
        a = _get(cid, f"ASSET#{aid}", "asset")
        assets.append({"cid": cid, "id": a["id"], "code": a["code"], "serial": a.get("serial", ""), "itemName": items.get(a["itemId"], "")})
    data = company_pdf.labels(assets, str(meta.get("name", "")), str(meta.get("phone", "")), body.baseUrl.rstrip("/"), body.kind, body.start, (body.nudgeX, body.nudgeY), body.outline)
    return _pdf_out(cid, f"기기라벨_{assets[0]['code']}{f'_외{len(assets) - 1}' if len(assets) > 1 else ''}.pdf", data)


# ── 직인 ─────────────────────────────────────────────

@router.get("/company/<cid>/seal")
def get_seal(cid: str) -> dict[str, Any]:
    """올린 직인 (없으면 null → 예시 직인)"""
    company_ctx(router, cid)
    meta = _meta(cid)
    data = _seal_at(cid, str(meta.get("sealVersion", "")))
    return {"data": base64.b64encode(data).decode() if data else None, "updatedAt": meta.get("sealUpdatedAt")}


@router.put("/company/<cid>/seal")
def put_seal(cid: str) -> dict[str, Any]:
    ctx = company_ctx(router, cid, "settings", "edit")
    raw = parse_body(router, SealIn).data.split(",")[-1]  # data URL도 받는다
    try:
        data = base64.b64decode(raw, validate=True)
    except ValueError as exc:
        raise BadRequestError("invalid image data") from exc
    if len(data) > MAX_SEAL_BYTES:
        raise BadRequestError("image is too large (max 1MB)")
    from PIL import Image  # noqa: PLC0415 (문서 레이어의 pillow)

    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception as exc:  # noqa: BLE001
        raise BadRequestError("not an image (PNG or JPG)") from exc
    if img.format not in ("PNG", "JPEG"):
        raise BadRequestError("PNG or JPG only")
    img.thumbnail((600, 600))
    out = io.BytesIO()
    img.convert("RGBA").save(out, format="PNG")
    res = s3().put_object(Bucket=_bucket(), Key=_seal_key(cid), Body=out.getvalue(), ContentType="image/png")
    version = res.get("VersionId", "")
    if not version:
        raise BadRequestError("seal storage is not versioned")
    at = now_iso()
    table().update_item(Key={"PK": pk(cid), "SK": "META"}, UpdateExpression="SET sealVersion = :v, sealUpdatedAt = :t", ExpressionAttributeValues={":v": version, ":t": at})
    table().put_item(Item=company_audit(cid, ctx.sub, "seal_change", "직인"))
    return {"data": base64.b64encode(out.getvalue()).decode(), "updatedAt": at}


@router.delete("/company/<cid>/seal")
def delete_seal(cid: str) -> dict[str, Any]:
    """예시 직인으로 되돌리기 (이미 발행한 문서는 그때 직인 그대로)"""
    ctx = company_ctx(router, cid, "settings", "edit")
    table().update_item(Key={"PK": pk(cid), "SK": "META"}, UpdateExpression="REMOVE sealVersion, sealUpdatedAt")
    table().put_item(Item=company_audit(cid, ctx.sub, "seal_change", "예시 직인으로"))
    return {"data": None}

