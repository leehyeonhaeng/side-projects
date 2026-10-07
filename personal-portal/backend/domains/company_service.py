"""행컴퍼니 A/S·점검 (COMPANY.md 5장, C4). 접수 → 완료 두 단계.

SERVICE#<id> (번호 AS-YYYY-NNNN): 거래처, 기기(선택), 증상, 연락처, 담당자, 상태 open → done | canceled
완료할 때 사용 부품·작업비가 있으면 A/S 거래(type=service)를 만든다 → 부품 재고 감소, 금액이 있으면 미수.
금액을 못 보는 현장 기사는 부품만 넣고 "유상"으로 표시 → 사무실이 나중에 청구(청구 거래의 serviceId)
A/S 거래를 취소하면 접수 상태로 돌아간다 (company_txn 취소)
"""

from datetime import date
from typing import Any
from uuid import uuid4

from aws_lambda_powertools.event_handler.api_gateway import Router
from aws_lambda_powertools.event_handler.exceptions import BadRequestError
from boto3.dynamodb.conditions import Key
from pydantic import BaseModel, ConfigDict, Field

from common.aws import table
from common.http import parse_body
from common.users import now_iso
from domains.company_core import CompanyCtx, company_audit, company_ctx, member_names, pk
from domains.company_master import asset_log, next_seq
from domains.company_txn import ID, LineIn, Tx, TxnCreate, _get, _strip, _view, build_txn, finish_txn
from domains.sharing import query_all

router = Router()


class ServiceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    partnerId: str = Field(pattern=ID)
    assetId: str | None = Field(default=None, pattern=ID)
    date: date  # 접수일
    symptom: str = Field(min_length=1, max_length=500)
    contact: str = Field(default="", max_length=60)  # 현장 연락처
    assignee: str | None = Field(default=None, max_length=60)  # 담당 직원 sub


class ServicePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symptom: str | None = Field(default=None, min_length=1, max_length=500)
    contact: str | None = Field(default=None, max_length=60)
    assignee: str | None = Field(default=None, max_length=60)


class ServiceDone(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date: date
    action: str = Field(min_length=1, max_length=500)  # 조치 내용
    parts: list[LineIn] = Field(default_factory=list, max_length=20)  # 사용 부품 (수량 품목)
    fees: list[LineIn] = Field(default_factory=list, max_length=10)  # 출장비·작업비
    billable: bool = False  # 유상 (금액은 사무실이 나중에 청구할 때)


class CancelBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(default="", max_length=200)


def _list(cid: str) -> list[dict[str, Any]]:
    return [_strip(s) for s in query_all(KeyConditionExpression=Key("PK").eq(pk(cid)) & Key("SK").begins_with("SERVICE#"))]


def _members(cid: str) -> dict[str, str]:
    return member_names(cid)


def _out(s: dict[str, Any], names: dict[str, str]) -> dict[str, Any]:
    out = {**s}
    if s.get("assignee"):
        out["assigneeName"] = names.get(s["assignee"], "")
    return out


@router.get("/company/<cid>/services")
def list_services(cid: str) -> dict[str, Any]:
    """?status=open|done|canceled, ?assetId, ?partnerId"""
    company_ctx(router, cid, "assets")
    q = router.current_event.get_query_string_value
    items = [s for s in _list(cid) if all(not q(k) or s.get(k) == q(k) for k in ("status", "assetId", "partnerId"))]
    items.sort(key=lambda s: (s["status"] != "open", s["date"] if s["status"] == "open" else "", s["no"]), reverse=False)
    open_ = [s for s in items if s["status"] == "open"]
    rest = sorted([s for s in items if s["status"] != "open"], key=lambda s: s["no"], reverse=True)
    names = _members(cid)
    return {"services": [_out(s, names) for s in open_ + rest]}


@router.get("/company/<cid>/services/<sid>")
def get_service(cid: str, sid: str) -> dict[str, Any]:
    ctx = company_ctx(router, cid, "assets")
    s = _strip(_get(cid, f"SERVICE#{sid}", "service"))
    txn = None
    if s.get("txn"):
        t = table().get_item(Key={"PK": pk(cid), "SK": f"TXN#{s['txn']['date']}#{s['txn']['id']}"}).get("Item")
        txn = _view(ctx, t) if t else None
    return {"service": _out(s, _members(cid)), "txn": txn}


@router.post("/company/<cid>/services")
def create_service(cid: str) -> dict[str, Any]:
    ctx = company_ctx(router, cid, "assets", "edit")
    body = parse_body(router, ServiceCreate)
    partner = _get(cid, f"PARTNER#{body.partnerId}", "partner")
    asset = _get(cid, f"ASSET#{body.assetId}", "asset") if body.assetId else None
    item = _get(cid, f"ITEM#{asset['itemId']}", "item") if asset else None
    day = body.date.isoformat()
    sid = uuid4().hex[:10]
    s = {
        "PK": pk(cid),
        "SK": f"SERVICE#{sid}",
        "id": sid,
        "no": f"AS-{day[:4]}-{next_seq(cid, f'service#{day[:4]}'):04d}",
        "status": "open",
        "date": day,
        "partnerId": partner["id"],
        "partnerName": partner["name"],
        "symptom": body.symptom,
        "contact": body.contact,
        "createdBy": ctx.sub,
        "createdAt": now_iso(),
        "ver": 1,
        **({"assetId": asset["id"], "assetCode": asset["code"], "itemName": item["name"]} if asset and item else {}),  # type: ignore[index]
        **({"assignee": body.assignee} if body.assignee else {}),
    }
    tx = Tx()
    tx.put(s, "attribute_not_exists(PK)")
    if asset:
        tx.put(asset_log(cid, asset["id"], ctx.sub, "service_open", serviceNo=s["no"], note=body.symptom))
    tx.put(company_audit(cid, ctx.sub, "service_create", s["no"], {"partner": partner["name"]}))
    tx.run()
    return {"service": _strip(s)}


@router.patch("/company/<cid>/services/<sid>")
def patch_service(cid: str, sid: str) -> dict[str, Any]:
    ctx = company_ctx(router, cid, "assets", "edit")
    changes = parse_body(router, ServicePatch).model_dump(exclude_unset=True)
    s = _get(cid, f"SERVICE#{sid}", "service")
    if s["status"] != "open":
        raise BadRequestError("only open A/S can be edited")
    merged = {**s, **{k: v for k, v in changes.items() if v is not None}, "ver": s["ver"] + 1}
    if changes.get("assignee") == "":
        merged.pop("assignee", None)
    tx = Tx()
    tx.put({**merged, "PK": pk(cid), "SK": f"SERVICE#{sid}"}, "ver = :v", values={":v": s["ver"]}, fail="A/S 기록이 바뀌었습니다. 새로 고친 뒤 다시 시도하세요")
    tx.run()
    return {"service": _out(_strip(merged), _members(cid))}


def _done_ops(ctx: CompanyCtx, cid: str, s: dict[str, Any], body: ServiceDone, tx: Tx, txn: dict[str, Any] | None) -> None:
    day = body.date.isoformat()
    done = {"date": day, "action": body.action, "by": ctx.sub, "at": now_iso()}
    vals: dict[str, Any] = {":d": "done", ":done": done, ":v": s["ver"], ":one": 1, ":o": "open", ":nb": body.billable and not (txn or {}).get("total")}
    expr = "SET #st = :d, done = :done, needsBilling = :nb, ver = ver + :one"
    if txn:
        vals[":t"] = {"id": txn["id"], "date": txn["date"], "no": txn["no"]}
        expr += ", txn = :t"
    tx.update({"PK": pk(cid), "SK": f"SERVICE#{s['id']}"}, expr, {"#st": "status"}, vals, "#st = :o AND ver = :v", "A/S 기록이 바뀌었습니다. 새로 고친 뒤 다시 시도하세요")
    if s.get("assetId"):
        tx.put(asset_log(cid, s["assetId"], ctx.sub, "service_done", serviceNo=s["no"], note=body.action, txnNo=(txn or {}).get("no", "")))


@router.post("/company/<cid>/services/<sid>/complete")
def complete_service(cid: str, sid: str) -> dict[str, Any]:
    """완료: 부품·작업비가 있으면 A/S 거래(재고 감소, 금액이 있으면 미수)와 함께"""
    ctx = company_ctx(router, cid, "assets", "edit")
    body = parse_body(router, ServiceDone)
    s = _get(cid, f"SERVICE#{sid}", "service")
    if s["status"] != "open":
        raise BadRequestError("A/S is not open")
    if body.date.isoformat() < s["date"]:
        raise BadRequestError("done date is before the request date")
    if any(not p.itemId for p in body.parts):
        raise BadRequestError("parts need itemId")
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
    return {"service": _strip(_get(cid, f"SERVICE#{sid}", "service")), **res}


@router.post("/company/<cid>/services/<sid>/cancel")
def cancel_service(cid: str, sid: str) -> dict[str, Any]:
    """접수 취소 (완료 전만). 완료한 A/S는 A/S 거래를 취소하면 접수 상태로 돌아간다"""
    ctx = company_ctx(router, cid, "assets", "edit")
    reason = parse_body(router, CancelBody).reason
    s = _get(cid, f"SERVICE#{sid}", "service")
    tx = Tx()
    tx.update({"PK": pk(cid), "SK": f"SERVICE#{sid}"}, "SET #st = :c, cancelReason = :r, ver = ver + :one", {"#st": "status"}, {":c": "canceled", ":r": reason, ":one": 1, ":o": "open"}, "#st = :o", "접수 상태인 A/S만 취소할 수 있습니다")
    if s.get("assetId"):
        tx.put(asset_log(cid, s["assetId"], ctx.sub, "service_cancel", serviceNo=s["no"], note=reason))
    tx.put(company_audit(cid, ctx.sub, "service_cancel", s["no"], {"reason": reason}))
    tx.run()
    return {"service": _strip(_get(cid, f"SERVICE#{sid}", "service"))}
