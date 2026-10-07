"""행컴퍼니 기준 정보 (COMPANY.md 4·9장, C2): 거래처, 품목(개체/수량), 기기, 계좌.

- 기준 정보는 지우지 않고 "사용 안 함"(active=false)으로 숨긴다. 한 번도 쓰이지 않은 것만 삭제 가능 (장부에 남은 이름 보존)
- 재고 수량·거래처 잔액·계좌 잔액은 C3 거래가 바꾼다. 여기서는 처음 값(기초)만 정한다
- 기기 고유번호: <설정 assetPrefix>-<6자리 순번>, 회사별 순번은 SEQ#asset (원자적 증가)
- 금액 보기가 꺼진 직원에게는 단가·잔액 필드를 보내지 않는다 (company_core.redact)
"""

from datetime import date
from typing import Annotated, Any, Literal
from uuid import uuid4

from aws_lambda_powertools.event_handler.api_gateway import Router
from aws_lambda_powertools.event_handler.exceptions import BadRequestError, NotFoundError
from boto3.dynamodb.conditions import Key
from pydantic import BaseModel, ConfigDict, Field

from common.aws import table
from common.http import parse_body
from common.serialize import to_dynamo, to_plain
from common.users import now_iso
from domains.company_core import CompanyCtx, company_audit, company_ctx, pk, redact
from domains.sharing import query_all

router = Router()

ID = r"^[A-Za-z0-9_-]{1,40}$"
Day = date
Money = Annotated[int, Field(ge=0, le=10_000_000_000)]
MAX_BULK = 50

PARTNER_MONEY = ("receivable", "advance", "payable", "prepaid")
ITEM_MONEY = ("price", "rentPrice", "cost")
ASSET_MONEY = ("cost",)
ACCOUNT_MONEY = ("openingBalance", "balance")

AssetStatus = Literal["in_stock", "rented", "repair", "retired"]
# 직접 바꿀 수 있는 상태 (임대 중은 출고·수거 거래로만)
MANUAL_STATUS = ("in_stock", "repair", "retired")


# ── 공통 ─────────────────────────────────────────────

def _strip(item: dict[str, Any]) -> dict[str, Any]:
    return to_plain({k: v for k, v in item.items() if k not in ("PK", "SK", "GSI1PK", "GSI1SK")})


def _list(cid: str, prefix: str) -> list[dict[str, Any]]:
    return [_strip(i) for i in query_all(KeyConditionExpression=Key("PK").eq(pk(cid)) & Key("SK").begins_with(prefix)) if "#LOG#" not in i["SK"]]


def _get(cid: str, sk: str, what: str) -> dict[str, Any]:
    item = table().get_item(Key={"PK": pk(cid), "SK": sk}).get("Item")
    if item is None:
        raise NotFoundError(f"{what} not found")
    return item


def _save(ctx: CompanyCtx, sk: str, data: dict[str, Any], action: str, target_name: str, detail: dict[str, Any] | None = None) -> dict[str, Any]:
    item = {"PK": pk(ctx.cid), "SK": sk, **to_dynamo(data), "updatedAt": now_iso()}
    table().put_item(Item=item)
    table().put_item(Item=company_audit(ctx.cid, ctx.sub, action, target_name, detail))
    return _strip(item)


def _new_id() -> str:
    return uuid4().hex[:10]


# ── 거래처 ───────────────────────────────────────────

class PartnerFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=60)
    kind: Literal["customer", "supplier", "both"] | None = None  # 매출처 / 매입처 / 둘 다
    bizNo: str | None = Field(default=None, max_length=20)
    ceo: str | None = Field(default=None, max_length=30)
    contactName: str | None = Field(default=None, max_length=30)  # 담당자
    phone: str | None = Field(default=None, max_length=30)
    mobile: str | None = Field(default=None, max_length=30)
    email: str | None = Field(default=None, max_length=100)
    address: str | None = Field(default=None, max_length=200)
    memo: str | None = Field(default=None, max_length=1000)
    active: bool | None = None


class PartnerCreate(PartnerFields):
    name: str = Field(min_length=1, max_length=60)
    kind: Literal["customer", "supplier", "both"] = "customer"


def _partner_view(ctx: CompanyCtx, p: dict[str, Any]) -> dict[str, Any]:
    return redact(ctx, p, PARTNER_MONEY)


@router.get("/company/<cid>/partners")
def list_partners(cid: str) -> dict[str, Any]:
    ctx = company_ctx(router, cid, "partners")
    items = sorted(_list(cid, "PARTNER#"), key=lambda p: p["name"])
    return {"partners": [_partner_view(ctx, p) for p in items]}


@router.post("/company/<cid>/partners")
def create_partner(cid: str) -> dict[str, Any]:
    ctx = company_ctx(router, cid, "partners", "edit")
    data = parse_body(router, PartnerCreate).model_dump(exclude_none=True)
    if any(p["name"] == data["name"] for p in _list(cid, "PARTNER#")):
        raise BadRequestError("a partner with the same name exists")
    pid = _new_id()
    item = {"id": pid, "active": True, "receivable": 0, "advance": 0, "payable": 0, "prepaid": 0, **data, "createdAt": now_iso()}
    return _partner_view(ctx, _save(ctx, f"PARTNER#{pid}", item, "partner_create", data["name"]))


@router.get("/company/<cid>/partners/<pid>")
def get_partner(cid: str, pid: str) -> dict[str, Any]:
    """거래처 + 지금 그 거래처에 나가 있는 기기"""
    ctx = company_ctx(router, cid, "partners")
    partner = _partner_view(ctx, _strip(_get(cid, f"PARTNER#{pid}", "partner")))
    assets = [a for a in _list(cid, "ASSET#") if a.get("partnerId") == pid] if ctx.can("assets") else []
    return {"partner": partner, "assets": [redact(ctx, a, ASSET_MONEY) for a in assets]}


@router.patch("/company/<cid>/partners/<pid>")
def patch_partner(cid: str, pid: str) -> dict[str, Any]:
    ctx = company_ctx(router, cid, "partners", "edit")
    changes = parse_body(router, PartnerFields).model_dump(exclude_unset=True)
    if not changes or any(changes.get(k, "") is None for k in ("name", "kind", "active")):
        raise BadRequestError("nothing to update or empty required field")
    current = _strip(_get(cid, f"PARTNER#{pid}", "partner"))
    if "name" in changes and changes["name"] != current["name"] and any(p["name"] == changes["name"] for p in _list(cid, "PARTNER#")):
        raise BadRequestError("a partner with the same name exists")
    merged = {k: v for k, v in {**current, **changes}.items() if v is not None}
    return _partner_view(ctx, _save(ctx, f"PARTNER#{pid}", merged, "partner_change", merged["name"], {"fields": sorted(changes)}))


@router.delete("/company/<cid>/partners/<pid>")
def delete_partner(cid: str, pid: str) -> dict[str, Any]:
    """한 번도 쓰이지 않은 거래처만 (기기 이력·거래가 있으면 "사용 안 함"으로)"""
    ctx = company_ctx(router, cid, "partners", "edit")
    current = _get(cid, f"PARTNER#{pid}", "partner")
    if current.get("used") or any(a.get("partnerId") == pid for a in _list(cid, "ASSET#")):
        raise BadRequestError("partner has history; deactivate it instead")
    table().delete_item(Key={"PK": pk(cid), "SK": f"PARTNER#{pid}"})
    table().put_item(Item=company_audit(cid, ctx.sub, "partner_delete", current["name"]))
    return {"deleted": pid}


# ── 품목 ─────────────────────────────────────────────

class ItemFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=80)
    category: str | None = Field(default=None, max_length=30)  # 복합기·프린터·토너·잉크·드럼·용지·부품 등
    maker: str | None = Field(default=None, max_length=30)
    modelNo: str | None = Field(default=None, max_length=40)
    spec: str | None = Field(default=None, max_length=200)
    unit: str | None = Field(default=None, max_length=10)
    price: Money | None = None  # 판매 정가
    rentPrice: Money | None = None  # 기본 월 임대료 (개체 품목, 계약마다 달라질 수 있는 기본값)
    cost: Money | None = None  # 기준 매입가
    minStock: Annotated[float, Field(ge=0, le=1_000_000)] | None = None  # 수량 품목: 이보다 적으면 부족 표시
    compatibleWith: list[Annotated[str, Field(pattern=ID)]] | None = Field(default=None, max_length=50)  # 호환 기종(개체 품목 id)
    memo: str | None = Field(default=None, max_length=1000)
    active: bool | None = None


class ItemCreate(ItemFields):
    name: str = Field(min_length=1, max_length=80)
    tracking: Literal["asset", "stock"]  # 개체 관리(기기 한 대씩) / 수량 관리 — 만든 뒤 바꿀 수 없음
    openingQty: Annotated[float, Field(ge=0, le=1_000_000)] = 0  # 수량 품목의 기초 재고


def _item_view(ctx: CompanyCtx, item: dict[str, Any], assets: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    out = dict(item)
    if item["tracking"] == "asset" and assets is not None:
        mine = [a for a in assets if a["itemId"] == item["id"]]
        out["assetCounts"] = {s: sum(1 for a in mine if a["status"] == s) for s in ("in_stock", "rented", "repair", "retired")}
    return redact(ctx, out, ITEM_MONEY)


def _check_compat(cid: str, ids: list[str] | None) -> None:
    if not ids:
        return
    models = {i["id"] for i in _list(cid, "ITEM#") if i["tracking"] == "asset"}
    if any(i not in models for i in ids):
        raise BadRequestError("compatibleWith must be asset-tracked items")


@router.get("/company/<cid>/items")
def list_items(cid: str) -> dict[str, Any]:
    ctx = company_ctx(router, cid, "items")
    assets = _list(cid, "ASSET#")
    items = sorted(_list(cid, "ITEM#"), key=lambda i: (i.get("category", ""), i["name"]))
    return {"items": [_item_view(ctx, i, assets) for i in items]}


@router.post("/company/<cid>/items")
def create_item(cid: str) -> dict[str, Any]:
    ctx = company_ctx(router, cid, "items", "edit")
    body = parse_body(router, ItemCreate)
    data = body.model_dump(exclude_none=True)
    opening = data.pop("openingQty")
    if body.tracking == "asset":
        if opening:
            raise BadRequestError("asset items are counted by registered assets")
        data.pop("minStock", None)
    else:
        data.pop("rentPrice", None)
        data["qty"] = opening
    _check_compat(cid, data.get("compatibleWith"))
    iid = _new_id()
    item = {"id": iid, "active": True, "unit": "대" if body.tracking == "asset" else "개", **data, "createdAt": now_iso()}
    return _item_view(ctx, _save(ctx, f"ITEM#{iid}", item, "item_create", data["name"], {"openingQty": opening} if opening else None), [])


@router.patch("/company/<cid>/items/<iid>")
def patch_item(cid: str, iid: str) -> dict[str, Any]:
    """재고 수량은 거래로만 바뀐다 (여기서는 못 바꿈)"""
    ctx = company_ctx(router, cid, "items", "edit")
    changes = parse_body(router, ItemFields).model_dump(exclude_unset=True)
    if not changes:
        raise BadRequestError("nothing to update")
    if any(changes.get(k, "") is None for k in ("name", "active")):
        raise BadRequestError("name/active cannot be empty")
    current = _strip(_get(cid, f"ITEM#{iid}", "item"))
    if not ctx.show_amounts and changes.keys() & set(ITEM_MONEY):
        raise BadRequestError("no permission to change amounts")
    if current["tracking"] == "asset":
        changes.pop("minStock", None)
    else:
        changes.pop("rentPrice", None)
    _check_compat(cid, changes.get("compatibleWith"))
    merged = {k: v for k, v in {**current, **changes}.items() if v is not None}
    return _item_view(ctx, _save(ctx, f"ITEM#{iid}", merged, "item_change", merged["name"], {"fields": sorted(changes)}), _list(cid, "ASSET#"))


@router.delete("/company/<cid>/items/<iid>")
def delete_item(cid: str, iid: str) -> dict[str, Any]:
    ctx = company_ctx(router, cid, "items", "edit")
    current = _get(cid, f"ITEM#{iid}", "item")
    if current.get("used") or any(a["itemId"] == iid for a in _list(cid, "ASSET#")):
        raise BadRequestError("item has history; deactivate it instead")
    table().delete_item(Key={"PK": pk(cid), "SK": f"ITEM#{iid}"})
    table().put_item(Item=company_audit(cid, ctx.sub, "item_delete", current["name"]))
    return {"deleted": iid}


# ── 기기 ─────────────────────────────────────────────

def next_seq(cid: str, name: str, count: int = 1) -> int:
    """회사별 순번을 count만큼 원자적으로 늘리고 마지막 값을 돌려준다"""
    res = table().update_item(
        Key={"PK": pk(cid), "SK": f"SEQ#{name}"},
        UpdateExpression="ADD #v :n",
        ExpressionAttributeNames={"#v": "value"},
        ExpressionAttributeValues={":n": count},
        ReturnValues="UPDATED_NEW",
    )
    return int(res["Attributes"]["value"])


def asset_prefix(cid: str) -> str:
    meta = table().get_item(Key={"PK": pk(cid), "SK": "META"})["Item"]
    return str(meta.get("assetPrefix") or "A")


def asset_log(cid: str, aid: str, actor: str, action: str, **detail: Any) -> dict[str, Any]:
    at = now_iso()
    return {"PK": pk(cid), "SK": f"ASSET#{aid}#LOG#{at}#{uuid4().hex[:4]}", "at": at, "actor": actor, "action": action, **to_dynamo(detail)}


class AssetRegister(BaseModel):
    """기초 등록: 이미 가지고 있는 기기를 한 번에 여러 대 (제조번호는 대수만큼, 비워도 됨)"""

    model_config = ConfigDict(extra="forbid")

    itemId: str = Field(pattern=ID)
    count: int = Field(ge=1, le=MAX_BULK)
    serials: list[Annotated[str, Field(max_length=60)]] = Field(default_factory=list, max_length=MAX_BULK)
    acquiredAt: Day | None = None
    cost: Money | None = None
    location: str = Field(default="", max_length=60)  # 창고 위치 메모
    memo: str = Field(default="", max_length=500)


class AssetPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    serial: str | None = Field(default=None, max_length=60)
    status: Literal["in_stock", "repair", "retired"] | None = None
    location: str | None = Field(default=None, max_length=60)
    acquiredAt: Day | None = None
    cost: Money | None = None
    memo: str | None = Field(default=None, max_length=500)


def _asset_view(ctx: CompanyCtx, a: dict[str, Any], names: dict[str, str]) -> dict[str, Any]:
    out = {**a, "itemName": names.get(a["itemId"], "(삭제된 품목)")}
    if a.get("partnerId"):
        out["partnerName"] = names.get(a["partnerId"], "")
    return redact(ctx, out, ASSET_MONEY)


def _names(cid: str) -> dict[str, str]:
    return {x["id"]: x["name"] for x in _list(cid, "ITEM#") + _list(cid, "PARTNER#")}


@router.get("/company/<cid>/assets")
def list_assets(cid: str) -> dict[str, Any]:
    ctx = company_ctx(router, cid, "assets")
    names = _names(cid)
    assets = sorted(_list(cid, "ASSET#"), key=lambda a: a["code"])
    return {"assets": [_asset_view(ctx, a, names) for a in assets]}


@router.post("/company/<cid>/assets")
def register_assets(cid: str) -> dict[str, Any]:
    ctx = company_ctx(router, cid, "assets", "edit")
    body = parse_body(router, AssetRegister)
    model = _strip(_get(cid, f"ITEM#{body.itemId}", "item"))
    if model["tracking"] != "asset":
        raise BadRequestError("item is not asset-tracked")
    if len(body.serials) > body.count:
        raise BadRequestError("more serials than count")
    if body.cost is not None and not ctx.show_amounts:
        raise BadRequestError("no permission to set amounts")
    serials = [s.strip() for s in body.serials] + [""] * (body.count - len(body.serials))
    existing = {a.get("serial") for a in _list(cid, "ASSET#") if a.get("serial")}
    dup = [s for s in serials if s and (s in existing or serials.count(s) > 1)]
    if dup:
        raise BadRequestError(f"duplicate serial: {dup[0]}")
    last = next_seq(cid, "asset", body.count)
    prefix = asset_prefix(cid)
    now = now_iso()
    created = []
    with table().batch_writer() as batch:
        for n, serial in enumerate(serials, start=last - body.count + 1):
            aid = _new_id()
            asset = {
                "PK": pk(cid),
                "SK": f"ASSET#{aid}",
                "id": aid,
                "code": f"{prefix}-{n:06d}",
                "itemId": body.itemId,
                "serial": serial,
                "status": "in_stock",
                "location": body.location,
                "memo": body.memo,
                "createdAt": now,
                "updatedAt": now,
                **({"acquiredAt": body.acquiredAt.isoformat()} if body.acquiredAt else {}),
                **({"cost": body.cost} if body.cost is not None else {}),
            }
            batch.put_item(Item=asset)
            batch.put_item(Item=asset_log(cid, aid, ctx.sub, "registered", note="기초 등록"))
            created.append(_strip(asset))
        batch.put_item(Item=company_audit(cid, ctx.sub, "asset_register", model["name"], {"count": body.count, "codes": f"{created[0]['code']}~{created[-1]['code']}"}))
    names = {model["id"]: model["name"]}
    return {"assets": [_asset_view(ctx, a, names) for a in created]}


@router.get("/company/<cid>/assets/<aid>")
def get_asset(cid: str, aid: str) -> dict[str, Any]:
    """기기 + 이력 (최신순). 라벨 QR이 이 화면을 연다"""
    ctx = company_ctx(router, cid, "assets")
    asset = _strip(_get(cid, f"ASSET#{aid}", "asset"))
    logs = [_strip(x) for x in query_all(KeyConditionExpression=Key("PK").eq(pk(cid)) & Key("SK").begins_with(f"ASSET#{aid}#LOG#"), ScanIndexForward=False)]
    return {"asset": _asset_view(ctx, asset, _names(cid)), "logs": [redact(ctx, x, ("amount",)) for x in logs]}


@router.patch("/company/<cid>/assets/<aid>")
def patch_asset(cid: str, aid: str) -> dict[str, Any]:
    ctx = company_ctx(router, cid, "assets", "edit")
    changes = parse_body(router, AssetPatch).model_dump(exclude_unset=True, mode="json")
    if not changes:
        raise BadRequestError("nothing to update")
    if "cost" in changes and not ctx.show_amounts:
        raise BadRequestError("no permission to change amounts")
    current = _strip(_get(cid, f"ASSET#{aid}", "asset"))
    if "status" in changes:
        if current["status"] == "rented":
            raise BadRequestError("rented asset changes status by return transaction")
        if changes["status"] is None:
            raise BadRequestError("status cannot be empty")
    if "serial" in changes and changes["serial"] and changes["serial"] != current.get("serial"):
        if any(a.get("serial") == changes["serial"] for a in _list(cid, "ASSET#")):
            raise BadRequestError(f"duplicate serial: {changes['serial']}")
    merged = {k: v for k, v in {**current, **changes}.items() if v is not None}
    item = {"PK": pk(cid), "SK": f"ASSET#{aid}", **to_dynamo(merged), "updatedAt": now_iso()}
    table().put_item(Item=item)
    if changes.get("status") and changes["status"] != current["status"]:
        table().put_item(Item=asset_log(cid, aid, ctx.sub, "status", **{"from": current["status"], "to": changes["status"]}))
    table().put_item(Item=company_audit(cid, ctx.sub, "asset_change", current["code"], {"fields": sorted(changes)}))
    return _asset_view(ctx, _strip(item), _names(cid))


@router.delete("/company/<cid>/assets/<aid>")
def delete_asset(cid: str, aid: str) -> dict[str, Any]:
    """잘못 등록한 기기만 (등록 이후 이력이 없을 때). 그 외에는 "폐기" 상태로"""
    ctx = company_ctx(router, cid, "assets", "edit")
    current = _get(cid, f"ASSET#{aid}", "asset")
    logs = query_all(KeyConditionExpression=Key("PK").eq(pk(cid)) & Key("SK").begins_with(f"ASSET#{aid}#LOG#"))
    if current["status"] != "in_stock" or any(x["action"] != "registered" for x in logs):
        raise BadRequestError("asset has history; retire it instead")
    with table().batch_writer() as batch:
        batch.delete_item(Key={"PK": pk(cid), "SK": f"ASSET#{aid}"})
        for x in logs:
            batch.delete_item(Key={"PK": x["PK"], "SK": x["SK"]})
        batch.put_item(Item=company_audit(cid, ctx.sub, "asset_delete", current["code"]))
    return {"deleted": aid}


# ── 계좌 ─────────────────────────────────────────────

class AccountFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=40)
    kind: Literal["cash", "bank", "card"] | None = None
    bank: str | None = Field(default=None, max_length=30)
    number: str | None = Field(default=None, max_length=40)
    holder: str | None = Field(default=None, max_length=30)
    memo: str | None = Field(default=None, max_length=300)
    active: bool | None = None


class AccountCreate(AccountFields):
    name: str = Field(min_length=1, max_length=40)
    kind: Literal["cash", "bank", "card"] = "bank"
    openingBalance: Annotated[int, Field(ge=-10_000_000_000, le=10_000_000_000)] = 0
    openingDate: Day | None = None


@router.get("/company/<cid>/accounts")
def list_accounts(cid: str) -> dict[str, Any]:
    ctx = company_ctx(router, cid, "money")
    items = sorted(_list(cid, "ACCOUNT#"), key=lambda a: a["createdAt"])
    return {"accounts": [redact(ctx, a, ACCOUNT_MONEY) for a in items]}


@router.post("/company/<cid>/accounts")
def create_account(cid: str) -> dict[str, Any]:
    ctx = company_ctx(router, cid, "money", "edit")
    if not ctx.show_amounts:
        raise BadRequestError("no permission to set amounts")
    data = parse_body(router, AccountCreate).model_dump(exclude_none=True, mode="json")
    acc_id = _new_id()
    item = {"id": acc_id, "active": True, **data, "balance": data["openingBalance"], "createdAt": now_iso()}
    return _save(ctx, f"ACCOUNT#{acc_id}", item, "account_create", data["name"], {"openingBalance": data["openingBalance"]})


@router.patch("/company/<cid>/accounts/<acc_id>")
def patch_account(cid: str, acc_id: str) -> dict[str, Any]:
    """잔액은 거래로만 바뀐다"""
    ctx = company_ctx(router, cid, "money", "edit")
    changes = parse_body(router, AccountFields).model_dump(exclude_unset=True)
    if not changes or any(changes.get(k, "") is None for k in ("name", "kind", "active")):
        raise BadRequestError("nothing to update or empty required field")
    current = _strip(_get(cid, f"ACCOUNT#{acc_id}", "account"))
    merged = {k: v for k, v in {**current, **changes}.items() if v is not None}
    return redact(ctx, _save(ctx, f"ACCOUNT#{acc_id}", merged, "account_change", merged["name"], {"fields": sorted(changes)}), ACCOUNT_MONEY)
