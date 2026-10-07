"""행컴퍼니 기반 (COMPANY.md 4·8·9장): 회사, 직원(멤버)·역할·권한, 초대, 회사 설정, 회사 활동 기록.

키 (회사 파티션 PK = COMPANY#<cid>)
- META: 회사 정보·설정·역할 프리셋 (GSI1 COMPANIES / <createdAt>: Host가 전체 회사 목록)
- MEMBER#<sub>: 역할·영역 권한·금액 보기·관리자 여부 (GSI1 USER#<sub> / COMPANY#<cid>: 내 회사 목록)
- AUDIT#<ts>: 회사 활동 기록
초대는 코드로 바로 찾도록 PK = INVITE#<code>, SK = META (GSI1 COMPANY#<cid> / INVITE#<createdAt>: 회사별 초대 목록, TTL 7일)

권한: Host는 모든 회사의 관리자. 그 외에는 회사 멤버만, 멤버가 아니면 회사가 없는 것처럼 404.
영역 권한은 none/view/edit, "금액 보기"가 꺼진 직원에게는 금액 필드를 보내지 않는다(C2부터 각 도메인이 redact 사용).
"""

import secrets
import time
from dataclasses import dataclass
from typing import Any, Literal
from uuid import uuid4

from aws_lambda_powertools.event_handler.api_gateway import Router
from aws_lambda_powertools.event_handler.exceptions import BadRequestError, ForbiddenError, NotFoundError
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError
from pydantic import BaseModel, ConfigDict, Field

from common.access import current_access
from common.aws import table
from common.http import parse_body
from common.serialize import to_dynamo, to_plain
from common.users import now_iso, user_pk
from domains.sharing import person, profiles, query_all

router = Router()

# 회사 안 영역 (COMPANY.md 8장). 새 영역을 만들면 여기에 추가한다
AREAS = ("partners", "assets", "items", "contracts", "txns", "money", "docs", "reports", "settings")
Level = Literal["none", "view", "edit"]
_RANK = {"none": 0, "view": 1, "edit": 2}
INVITE_DAYS = 7
MAX_MEMBERS = 50


def _perms(**over: str) -> dict[str, str]:
    return {a: over.get(a, "none") for a in AREAS}


# 역할 프리셋 기본값. 회사 관리자가 고칠 수 있고 META.roles에 저장된다
DEFAULT_ROLES: dict[str, dict[str, Any]] = {
    "admin": {"name": "관리자", "isAdmin": True, "showAmounts": True, "perms": {a: "edit" for a in AREAS}},
    "accountant": {
        "name": "경리",
        "isAdmin": False,
        "showAmounts": True,
        "perms": _perms(partners="edit", assets="view", items="view", contracts="view", txns="edit", money="edit", docs="edit", reports="edit"),
    },
    "office": {
        "name": "사무",
        "isAdmin": False,
        "showAmounts": True,
        "perms": _perms(partners="edit", assets="edit", items="edit", contracts="edit", txns="edit", money="view", docs="edit", reports="view"),
    },
    "field": {
        "name": "현장 기사",
        "isAdmin": False,
        "showAmounts": False,
        "perms": _perms(partners="view", assets="edit", items="view", contracts="view", txns="edit", docs="view"),
    },
}

ID = r"^[A-Za-z0-9_-]{1,40}$"


# ── 접근 확인 ────────────────────────────────────────

@dataclass(frozen=True)
class CompanyCtx:
    cid: str
    sub: str
    is_admin: bool
    perms: dict[str, str]
    show_amounts: bool

    def can(self, area: str, need: Level = "view") -> bool:
        return _RANK[self.perms.get(area, "none")] >= _RANK[need]


def pk(cid: str) -> str:
    return f"COMPANY#{cid}"


def _strip(item: dict[str, Any]) -> dict[str, Any]:
    return to_plain({k: v for k, v in item.items() if k not in ("PK", "SK", "GSI1PK", "GSI1SK", "ttl")})


def company_ctx(resolver: Router, cid: str, area: str | None = None, need: Level = "view", admin: bool = False) -> CompanyCtx:
    """회사 접근 확인. area를 주면 그 영역 권한(need 이상), admin=True면 관리자만"""
    access = current_access(resolver)
    sub = access.identity.sub
    meta = table().get_item(Key={"PK": pk(cid), "SK": "META"}).get("Item")
    if meta is None:
        raise NotFoundError("company not found")
    if access.identity.is_host:
        ctx = CompanyCtx(cid, sub, True, {a: "edit" for a in AREAS}, True)
    else:
        member = table().get_item(Key={"PK": pk(cid), "SK": f"MEMBER#{sub}"}).get("Item")
        if member is None:
            raise NotFoundError("company not found")
        ctx = CompanyCtx(cid, sub, bool(member.get("isAdmin")), dict(member.get("perms", {})), bool(member.get("showAmounts")))
    if admin and not ctx.is_admin:
        raise ForbiddenError("company admin only")
    if area and not ctx.can(area, need):
        raise ForbiddenError(f"no permission: {area}")
    return ctx


def redact(ctx: CompanyCtx, item: dict[str, Any], money_fields: tuple[str, ...]) -> dict[str, Any]:
    """금액 보기가 꺼진 직원에게는 금액 필드를 빼고 보낸다"""
    if ctx.show_amounts:
        return item
    return {k: v for k, v in item.items() if k not in money_fields}


def company_audit(cid: str, actor: str, action: str, target: str = "", detail: dict[str, Any] | None = None) -> dict[str, Any]:
    """회사 활동 기록 항목 (트랜잭션에 같이 넣을 수 있게 저장하지 않고 돌려준다)"""
    at = now_iso()
    return {"PK": pk(cid), "SK": f"AUDIT#{at}#{uuid4().hex[:6]}", "at": at, "actor": actor, "action": action, "target": target, "detail": to_dynamo(detail or {})}


def _member_item(cid: str, sub: str, role_id: str, role: dict[str, Any]) -> dict[str, Any]:
    return {
        "PK": pk(cid),
        "SK": f"MEMBER#{sub}",
        "sub": sub,
        "roleId": role_id,
        "isAdmin": bool(role["isAdmin"]),
        "showAmounts": bool(role["showAmounts"]),
        "perms": dict(role["perms"]),
        "joinedAt": now_iso(),
        "GSI1PK": user_pk(sub),
        "GSI1SK": f"COMPANY#{cid}",
    }


def _roles(meta: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {**DEFAULT_ROLES, **to_plain(meta.get("roles", {}))}


# ── 요청 본문 ────────────────────────────────────────

class CompanyCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=60)


class CompanyInfo(BaseModel):
    """회사 정보 (문서에 찍히는 값). 보낸 필드만 바뀐다"""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=60)
    bizNo: str | None = Field(default=None, max_length=20)  # 사업자등록번호
    ceo: str | None = Field(default=None, max_length=30)
    address: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=30)
    fax: str | None = Field(default=None, max_length=30)
    email: str | None = Field(default=None, max_length=100)
    bizType: str | None = Field(default=None, max_length=50)  # 업태
    bizItem: str | None = Field(default=None, max_length=50)  # 종목
    bankAccount: str | None = Field(default=None, max_length=100)  # 입금 계좌 (문서에 표시)
    vatDefault: Literal["included", "excluded", "exempt"] | None = None
    assetPrefix: str | None = Field(default=None, pattern=r"^[A-Z0-9]{1,5}$")  # 기기 고유번호 앞글자 (예: A → A-000001)


class RoleBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=20)
    showAmounts: bool
    perms: dict[str, Level]


class MemberPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    roleId: str | None = Field(default=None, pattern=ID)  # 역할을 바꾸면 그 역할의 권한으로 덮어씀
    perms: dict[str, Level] | None = None  # 세부 조정
    showAmounts: bool | None = None
    isAdmin: bool | None = None


class InviteCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    roleId: str = Field(pattern=ID)
    note: str = Field(default="", max_length=60)  # 누구 초대인지 메모


def _check_perms(perms: dict[str, str]) -> dict[str, str]:
    unknown = set(perms) - set(AREAS)
    if unknown:
        raise BadRequestError(f"unknown areas: {', '.join(sorted(unknown))}")
    return {a: perms.get(a, "none") for a in AREAS}


# ── 회사 ─────────────────────────────────────────────

@router.get("/company")
def my_companies() -> dict[str, Any]:
    """내가 들어갈 수 있는 회사 (Host는 전체)"""
    access = current_access(router)
    if access.identity.is_host:
        metas = query_all(IndexName="GSI1", KeyConditionExpression=Key("GSI1PK").eq("COMPANIES"))
        return {"companies": [{"id": m["id"], "name": m["name"], "isAdmin": True} for m in metas]}
    out = []
    for m in query_all(IndexName="GSI1", KeyConditionExpression=Key("GSI1PK").eq(user_pk(access.identity.sub)) & Key("GSI1SK").begins_with("COMPANY#")):
        cid = m["GSI1SK"].removeprefix("COMPANY#")
        meta = table().get_item(Key={"PK": pk(cid), "SK": "META"}).get("Item")
        if meta:
            out.append({"id": cid, "name": meta["name"], "isAdmin": bool(m.get("isAdmin"))})
    return {"companies": out}


@router.post("/company")
def create_company() -> dict[str, Any]:
    """회사 개설은 Host만 (COMPANY.md 2장: 회사마다 배포, 개설은 운영자가)"""
    access = current_access(router)
    if not access.identity.is_host:
        raise ForbiddenError("host only")
    body = parse_body(router, CompanyCreate)
    cid = uuid4().hex[:10]
    now = now_iso()
    meta = {"PK": pk(cid), "SK": "META", "id": cid, "name": body.name, "vatDefault": "excluded", "createdAt": now, "GSI1PK": "COMPANIES", "GSI1SK": now}
    with table().batch_writer() as batch:
        batch.put_item(Item=meta)
        batch.put_item(Item=_member_item(cid, access.identity.sub, "admin", DEFAULT_ROLES["admin"]))
        batch.put_item(Item=company_audit(cid, access.identity.sub, "company_create", detail={"name": body.name}))
    return _strip(meta)


@router.get("/company/<cid>")
def get_company(cid: str) -> dict[str, Any]:
    ctx = company_ctx(router, cid)
    meta = _strip(table().get_item(Key={"PK": pk(cid), "SK": "META"})["Item"])
    meta.pop("roles", None)
    return {"company": meta, "me": {"isAdmin": ctx.is_admin, "perms": ctx.perms, "showAmounts": ctx.show_amounts}, "areas": list(AREAS)}


@router.patch("/company/<cid>")
def patch_company(cid: str) -> dict[str, Any]:
    ctx = company_ctx(router, cid, "settings", "edit")
    changes = parse_body(router, CompanyInfo).model_dump(exclude_unset=True)
    if not changes:
        raise BadRequestError("nothing to update")
    if "name" in changes and changes["name"] is None:
        raise BadRequestError("name cannot be empty")
    item = table().get_item(Key={"PK": pk(cid), "SK": "META"})["Item"]
    item = {k: v for k, v in {**item, **changes}.items() if v is not None}
    with table().batch_writer() as batch:
        batch.put_item(Item=item)
        batch.put_item(Item=company_audit(cid, ctx.sub, "settings_change", detail={"fields": sorted(changes)}))
    out = _strip(item)
    out.pop("roles", None)
    return out


# ── 역할 ─────────────────────────────────────────────

@router.get("/company/<cid>/roles")
def list_roles(cid: str) -> dict[str, Any]:
    company_ctx(router, cid, admin=True)
    meta = table().get_item(Key={"PK": pk(cid), "SK": "META"})["Item"]
    return {"roles": [{"id": rid, **r} for rid, r in _roles(meta).items()], "areas": list(AREAS)}


@router.put("/company/<cid>/roles/<rid>")
def put_role(cid: str, rid: str) -> dict[str, Any]:
    """역할 추가·수정 (관리자 역할은 바꿀 수 없음). 이미 그 역할인 직원의 권한은 그대로 — 역할은 초대·지정할 때의 기본값"""
    ctx = company_ctx(router, cid, admin=True)
    if rid == "admin":
        raise BadRequestError("admin role cannot be changed")
    body = parse_body(router, RoleBody)
    role = {"name": body.name, "isAdmin": False, "showAmounts": body.showAmounts, "perms": _check_perms(body.perms)}
    table().update_item(
        Key={"PK": pk(cid), "SK": "META"},
        UpdateExpression="SET #roles = if_not_exists(#roles, :empty)",
        ExpressionAttributeNames={"#roles": "roles"},
        ExpressionAttributeValues={":empty": {}},
    )
    table().update_item(
        Key={"PK": pk(cid), "SK": "META"},
        UpdateExpression="SET #roles.#rid = :r",
        ExpressionAttributeNames={"#roles": "roles", "#rid": rid},
        ExpressionAttributeValues={":r": role},
    )
    table().put_item(Item=company_audit(cid, ctx.sub, "role_change", rid, {"name": body.name}))
    return {"id": rid, **role}


# ── 직원 ─────────────────────────────────────────────

def _members(cid: str) -> list[dict[str, Any]]:
    return query_all(KeyConditionExpression=Key("PK").eq(pk(cid)) & Key("SK").begins_with("MEMBER#"))


@router.get("/company/<cid>/members")
def list_members(cid: str) -> dict[str, Any]:
    company_ctx(router, cid, admin=True)
    items = [_strip(m) for m in _members(cid)]
    found = profiles([m["sub"] for m in items])
    out = [{**person(found.get(m["sub"]), m["sub"]), **m} for m in items]
    return {"members": sorted(out, key=lambda m: (not m["isAdmin"], m["name"]))}


def member_names(cid: str) -> dict[str, str]:
    """직원 sub → 이름 (A/S 담당자 표시)"""
    subs = [m["sub"] for m in _members(cid)]
    found = profiles(subs)
    return {sub: person(found.get(sub), sub)["name"] for sub in subs}


@router.get("/company/<cid>/staff")
def list_staff(cid: str) -> dict[str, Any]:
    """직원 이름 목록 (담당자 고르기). 권한 정보 없이 이름만 — 회사 멤버 누구나"""
    company_ctx(router, cid)
    return {"staff": sorted([{"sub": k, "name": v} for k, v in member_names(cid).items()], key=lambda x: x["name"])}


def _admin_count(cid: str) -> int:
    return sum(1 for m in _members(cid) if m.get("isAdmin"))


@router.patch("/company/<cid>/members/<msub>")
def patch_member(cid: str, msub: str) -> dict[str, Any]:
    ctx = company_ctx(router, cid, admin=True)
    body = parse_body(router, MemberPatch)
    item = table().get_item(Key={"PK": pk(cid), "SK": f"MEMBER#{msub}"}).get("Item")
    if item is None:
        raise NotFoundError("member not found")
    before = _strip(item)
    if body.roleId:
        meta = table().get_item(Key={"PK": pk(cid), "SK": "META"})["Item"]
        role = _roles(meta).get(body.roleId)
        if role is None:
            raise BadRequestError("unknown role")
        item = {**item, "roleId": body.roleId, "isAdmin": bool(role["isAdmin"]), "showAmounts": bool(role["showAmounts"]), "perms": dict(role["perms"])}
    if body.perms is not None:
        item["perms"] = _check_perms(body.perms)
    if body.showAmounts is not None:
        item["showAmounts"] = body.showAmounts
    if body.isAdmin is not None:
        item["isAdmin"] = body.isAdmin
    if before.get("isAdmin") and not item.get("isAdmin") and _admin_count(cid) <= 1:
        raise BadRequestError("a company needs at least one admin")
    changed = {k: f"{before.get(k)}→{item.get(k)}" for k in ("roleId", "isAdmin", "showAmounts") if before.get(k) != to_plain(item.get(k))}
    if before.get("perms") != to_plain(item.get("perms")):
        changed["perms"] = "changed"
    with table().batch_writer() as batch:
        batch.put_item(Item=item)
        batch.put_item(Item=company_audit(cid, ctx.sub, "member_change", msub, changed))
    return _strip(item)


@router.delete("/company/<cid>/members/<msub>")
def remove_member(cid: str, msub: str) -> dict[str, Any]:
    """관리자가 내보내거나 본인이 나간다. 마지막 관리자는 나갈 수 없다"""
    access = current_access(router)
    ctx = company_ctx(router, cid, admin=msub != access.identity.sub)
    item = table().get_item(Key={"PK": pk(cid), "SK": f"MEMBER#{msub}"}).get("Item")
    if item is None:
        raise NotFoundError("member not found")
    if item.get("isAdmin") and _admin_count(cid) <= 1:
        raise BadRequestError("a company needs at least one admin")
    table().delete_item(Key={"PK": pk(cid), "SK": f"MEMBER#{msub}"})
    table().put_item(Item=company_audit(cid, ctx.sub, "member_remove", msub))
    return {"removed": msub}


# ── 초대 ─────────────────────────────────────────────

def _invite_key(code: str) -> dict[str, str]:
    return {"PK": f"INVITE#{code}", "SK": "META"}


def _valid_invite(code: str) -> dict[str, Any] | None:
    inv = table().get_item(Key=_invite_key(code)).get("Item")
    if inv is None or inv.get("usedBy") or int(inv["ttl"]) < time.time():
        return None
    return inv


@router.post("/company/<cid>/invites")
def create_invite(cid: str) -> dict[str, Any]:
    ctx = company_ctx(router, cid, admin=True)
    body = parse_body(router, InviteCreate)
    meta = table().get_item(Key={"PK": pk(cid), "SK": "META"})["Item"]
    role = _roles(meta).get(body.roleId)
    if role is None:
        raise BadRequestError("unknown role")
    if len(_members(cid)) >= MAX_MEMBERS:
        raise BadRequestError(f"up to {MAX_MEMBERS} members")
    code = secrets.token_urlsafe(9)  # 12자, 추측 불가
    now = now_iso()
    item = {
        **_invite_key(code),
        "code": code,
        "cid": cid,
        "companyName": meta["name"],
        "roleId": body.roleId,
        "roleName": role["name"],
        "note": body.note,
        "createdBy": ctx.sub,
        "createdAt": now,
        "ttl": int(time.time()) + INVITE_DAYS * 86400,
        "GSI1PK": pk(cid),
        "GSI1SK": f"INVITE#{now}",
    }
    with table().batch_writer() as batch:
        batch.put_item(Item=item)
        batch.put_item(Item=company_audit(cid, ctx.sub, "invite_create", detail={"role": role["name"], "note": body.note}))
    return _invite_view(item)


def _invite_view(inv: dict[str, Any]) -> dict[str, Any]:
    out = _strip(inv)
    out["expiresAt"] = int(inv["ttl"])
    return out


@router.get("/company/<cid>/invites")
def list_invites(cid: str) -> dict[str, Any]:
    """아직 쓰지 않았고 기한이 남은 초대"""
    company_ctx(router, cid, admin=True)
    items = query_all(IndexName="GSI1", KeyConditionExpression=Key("GSI1PK").eq(pk(cid)) & Key("GSI1SK").begins_with("INVITE#"), ScanIndexForward=False)
    return {"invites": [_invite_view(i) for i in items if not i.get("usedBy") and int(i["ttl"]) >= time.time()]}


@router.delete("/company/<cid>/invites/<code>")
def delete_invite(cid: str, code: str) -> dict[str, Any]:
    ctx = company_ctx(router, cid, admin=True)
    inv = table().get_item(Key=_invite_key(code)).get("Item")
    if inv is None or inv["cid"] != cid:
        raise NotFoundError("invite not found")
    table().delete_item(Key=_invite_key(code))
    table().put_item(Item=company_audit(cid, ctx.sub, "invite_delete", detail={"note": inv.get("note", "")}))
    return {"deleted": code}


@router.get("/invite/<code>")
def invite_info(code: str) -> dict[str, Any]:
    """로그인 없이: 가입 화면에서 어느 회사 초대인지 보여 주기"""
    inv = _valid_invite(code)
    if inv is None:
        raise NotFoundError("invite not found or expired")
    return {"companyName": inv["companyName"], "roleName": inv["roleName"], "expiresAt": int(inv["ttl"])}


def use_invite(code: str, sub: str) -> dict[str, Any] | None:
    """초대를 한 번만 쓰도록 표시하고 회사 멤버로 넣는다. 쓸 수 없는 초대면 None (가입 트리거·이미 가입한 사용자 공용)"""
    inv = _valid_invite(code)
    if inv is None:
        return None
    try:
        table().update_item(
            Key=_invite_key(code),
            UpdateExpression="SET usedBy = :s, usedAt = :t",
            ConditionExpression="attribute_not_exists(usedBy)",
            ExpressionAttributeValues={":s": sub, ":t": now_iso()},
        )
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None
        raise
    cid = inv["cid"]
    if table().get_item(Key={"PK": pk(cid), "SK": f"MEMBER#{sub}"}).get("Item") is None:
        meta = table().get_item(Key={"PK": pk(cid), "SK": "META"})["Item"]
        role = _roles(meta).get(inv["roleId"], DEFAULT_ROLES["field"])
        table().put_item(Item=_member_item(cid, sub, inv["roleId"], role))
    table().put_item(Item=company_audit(cid, sub, "invite_accept", sub, {"role": inv["roleName"], "note": inv.get("note", "")}))
    return {"cid": cid, "companyName": inv["companyName"]}


@router.post("/company/invites/<code>/accept")
def accept_invite(code: str) -> dict[str, Any]:
    """이미 행포털 계정이 있는 사람이 초대 링크로 회사에 들어오기"""
    joined = use_invite(code, current_access(router).identity.sub)
    if joined is None:
        raise NotFoundError("invite not found or expired")
    return joined


# ── 활동 기록 ────────────────────────────────────────

@router.get("/company/<cid>/audit")
def company_audit_list(cid: str) -> dict[str, Any]:
    company_ctx(router, cid, admin=True)
    res = table().query(KeyConditionExpression=Key("PK").eq(pk(cid)) & Key("SK").begins_with("AUDIT#"), ScanIndexForward=False, Limit=200)
    items = [_strip(i) for i in res["Items"]]
    found = profiles(sorted({i["actor"] for i in items} | {i["target"] for i in items if i.get("target")}))
    for i in items:
        i["actorName"] = (found.get(i["actor"]) or {}).get("name", "")
        if i.get("target") in found:
            i["targetName"] = found[i["target"]].get("name", "")
    return {"logs": items}
