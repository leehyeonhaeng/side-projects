"""관리자 API (DESIGN.md 4.4). Host 그룹 + TOTP MFA 등록 계정만 호출할 수 있다."""

import os
import re
import time
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from aws_lambda_powertools.event_handler import APIGatewayHttpResolver, Response
from aws_lambda_powertools.event_handler.exceptions import BadRequestError, ForbiddenError, NotFoundError
from aws_lambda_powertools.event_handler.middlewares import NextMiddleware
from aws_lambda_powertools.utilities.typing import LambdaContext
from boto3.dynamodb.conditions import Key
from pydantic import BaseModel, Field, ValidationError

from common import audit, users
from common.access import Access, current_access
from common.app import create_app
from common.aws import cognito, table
from common.perms import DEFAULT_PRESETS, Level, Module, Status

app, logger = create_app("admin")

MFA_CACHE_SECONDS = 300
_mfa_verified_at: dict[str, float] = {}


def pool_id() -> str:
    return os.environ["USER_POOL_ID"]


def has_totp(sub: str) -> bool:
    user = cognito().admin_get_user(UserPoolId=pool_id(), Username=sub)
    return "SOFTWARE_TOKEN_MFA" in user.get("UserMFASettingList", [])


def host_only(app: APIGatewayHttpResolver, next_middleware: NextMiddleware) -> Response:
    if app.current_event.path.endswith("/health"):
        return next_middleware(app)
    access = current_access(app)
    if not access.identity.is_host:
        raise ForbiddenError("host only")
    sub = access.identity.sub
    if time.monotonic() - _mfa_verified_at.get(sub, -MFA_CACHE_SECONDS) >= MFA_CACHE_SECONDS:
        if not has_totp(sub):
            raise ForbiddenError("mfa required")
        _mfa_verified_at[sub] = time.monotonic()
    return next_middleware(app)


app.use(middlewares=[host_only])


# ── 입력 모델 ───────────────────────────────────────

class ApproveBody(BaseModel):
    presetId: str = Field(min_length=1, max_length=64)


class PermissionsBody(BaseModel):
    perms: dict[Module, Level]


class PresetBody(BaseModel):
    name: str = Field(min_length=1, max_length=30)
    perms: dict[Module, Level]


def parse[T: BaseModel](model: type[T]) -> T:
    try:
        return model.model_validate(app.current_event.json_body or {})
    except (ValidationError, ValueError) as exc:
        raise BadRequestError(str(exc)) from exc


def actor() -> Access:
    return current_access(app)


def log(action: str, target: str, detail: dict[str, Any] | None = None) -> None:
    a = actor()
    audit.record(action, actor=a.identity.sub, actor_email=a.profile.get("email", ""), target=target, detail=detail)


def user_view(item: dict[str, Any]) -> dict[str, Any]:
    return {k: item.get(k, "") for k in ("sub", "email", "name", "signupNote", "status", "role", "createdAt")}


def target_profile(sub: str) -> dict[str, Any]:
    profile = users.get_profile(sub)
    if profile is None:
        raise NotFoundError("user not found")
    return profile


def ensure_not_host(profile: dict[str, Any]) -> None:
    if profile.get("role") == "host" or profile["sub"] == actor().identity.sub:
        raise BadRequestError("host account cannot be changed here")


def full_perms(perms: dict[Module, Level]) -> dict[Module, Level]:
    return {m: perms.get(m, Level.NONE) for m in Module}


# ── 계정 ────────────────────────────────────────────

@app.get("/admin/users")
def list_users() -> dict[str, Any]:
    status = app.current_event.get_query_string_value("status")
    statuses = [Status(status)] if status in Status.__members__.values() else list(Status)
    items = [user_view(i) for s in statuses for i in users.list_by_status(s)]
    return {"users": items}


@app.post("/admin/users/<sub>/approve")
def approve(sub: str) -> dict[str, Any]:
    body = parse(ApproveBody)
    profile = target_profile(sub)
    if profile["status"] != Status.PENDING:
        raise BadRequestError("user is not pending")
    preset = get_preset(body.presetId)
    perms = full_perms({Module(k): Level(v) for k, v in preset["perms"].items()})
    users.set_perms(sub, perms)
    cognito().admin_enable_user(UserPoolId=pool_id(), Username=sub)
    users.set_status(sub, Status.ACTIVE)
    log("approve", sub, {"email": profile["email"], "preset": preset["name"]})
    return {"ok": True}


@app.post("/admin/users/<sub>/reject")
def reject(sub: str) -> dict[str, Any]:
    profile = target_profile(sub)
    if profile["status"] != Status.PENDING:
        raise BadRequestError("user is not pending")
    cognito().admin_delete_user(UserPoolId=pool_id(), Username=sub)
    users.delete_user_data(sub)
    log("reject", sub, {"email": profile["email"]})
    return {"ok": True}


@app.post("/admin/users/<sub>/suspend")
def suspend(sub: str) -> dict[str, Any]:
    profile = target_profile(sub)
    ensure_not_host(profile)
    cognito().admin_disable_user(UserPoolId=pool_id(), Username=sub)
    cognito().admin_user_global_sign_out(UserPoolId=pool_id(), Username=sub)
    users.set_status(sub, Status.SUSPENDED)
    log("suspend", sub, {"email": profile["email"]})
    return {"ok": True}


@app.post("/admin/users/<sub>/reactivate")
def reactivate(sub: str) -> dict[str, Any]:
    profile = target_profile(sub)
    if profile["status"] != Status.SUSPENDED:
        raise BadRequestError("user is not suspended")
    cognito().admin_enable_user(UserPoolId=pool_id(), Username=sub)
    users.set_status(sub, Status.ACTIVE)
    log("reactivate", sub, {"email": profile["email"]})
    return {"ok": True}


@app.delete("/admin/users/<sub>")
def delete_user(sub: str) -> dict[str, Any]:
    profile = target_profile(sub)
    ensure_not_host(profile)
    cognito().admin_delete_user(UserPoolId=pool_id(), Username=sub)
    deleted = users.delete_user_data(sub)
    log("delete", sub, {"email": profile["email"], "items": deleted})
    return {"ok": True}


@app.post("/admin/users/<sub>/reset-password")
def reset_password(sub: str) -> dict[str, Any]:
    profile = target_profile(sub)
    cognito().admin_reset_user_password(UserPoolId=pool_id(), Username=sub)
    log("reset_password", sub, {"email": profile["email"]})
    return {"ok": True}


# ── 권한 매트릭스 ────────────────────────────────────

@app.get("/admin/permissions")
def permission_matrix() -> dict[str, Any]:
    rows = []
    for status in (Status.ACTIVE, Status.SUSPENDED):
        for item in users.list_by_status(status):
            rows.append({**user_view(item), "perms": users.get_perms(item["sub"])})
    return {"modules": list(Module), "users": rows}


@app.put("/admin/users/<sub>/permissions")
def update_permissions(sub: str) -> dict[str, Any]:
    body = parse(PermissionsBody)
    profile = target_profile(sub)
    if profile.get("role") == "host":
        raise BadRequestError("host has all permissions")
    before = users.get_perms(sub)
    changed = {m: lv for m, lv in body.perms.items() if before.get(m) != lv}
    if changed:
        users.set_perms(sub, changed)
        log("perm_change", sub, {"email": profile["email"], "changes": {m: f"{before[m]}→{lv}" for m, lv in changed.items()}})
    return {"perms": {**before, **changed}}


# ── 권한 프리셋 ──────────────────────────────────────

def list_presets_raw() -> list[dict[str, Any]]:
    res = table().query(KeyConditionExpression=Key("PK").eq("PRESET") & Key("SK").begins_with("PRESET#"))
    return list(res["Items"])


def put_preset(preset_id: str, name: str, perms: dict[Module, Level]) -> dict[str, Any]:
    item = {
        "PK": "PRESET",
        "SK": f"PRESET#{preset_id}",
        "id": preset_id,
        "name": name,
        "perms": {str(m): str(lv) for m, lv in full_perms(perms).items()},
    }
    table().put_item(Item=item)
    return item


def preset_view(item: dict[str, Any]) -> dict[str, Any]:
    return {"id": item["id"], "name": item["name"], "perms": item["perms"]}


def get_preset(preset_id: str) -> dict[str, Any]:
    item = table().get_item(Key={"PK": "PRESET", "SK": f"PRESET#{preset_id}"}).get("Item")
    if item is None:
        raise NotFoundError("preset not found")
    return item


@app.get("/admin/presets")
def list_presets() -> dict[str, Any]:
    items = list_presets_raw()
    if not items:
        # 최초 조회 시 기본 프리셋(가족, 팀)을 만든다
        items = [put_preset(str(p["id"]), str(p["name"]), p["perms"]) for p in DEFAULT_PRESETS]  # type: ignore[arg-type]
    return {"presets": [preset_view(i) for i in sorted(items, key=lambda i: i["name"])]}


@app.post("/admin/presets")
def create_preset() -> dict[str, Any]:
    body = parse(PresetBody)
    return preset_view(put_preset(uuid4().hex[:12], body.name, body.perms))


@app.put("/admin/presets/<preset_id>")
def update_preset(preset_id: str) -> dict[str, Any]:
    body = parse(PresetBody)
    get_preset(preset_id)
    return preset_view(put_preset(preset_id, body.name, body.perms))


@app.delete("/admin/presets/<preset_id>")
def delete_preset(preset_id: str) -> dict[str, Any]:
    get_preset(preset_id)
    table().delete_item(Key={"PK": "PRESET", "SK": f"PRESET#{preset_id}"})
    return {"ok": True}


# ── 활동 로그 ────────────────────────────────────────

MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


@app.get("/admin/audit")
def list_audit() -> dict[str, Any]:
    month = app.current_event.get_query_string_value("month") or f"{datetime.now(UTC):%Y-%m}"
    if not MONTH_RE.match(month):
        raise BadRequestError("month must be YYYY-MM")
    items = audit.list_month(month)
    return {
        "month": month,
        "logs": [{k: i.get(k) for k in ("at", "action", "actor", "actorEmail", "target", "detail")} for i in items],
    }


@logger.inject_lambda_context
def lambda_handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    return app.resolve(event, context)
