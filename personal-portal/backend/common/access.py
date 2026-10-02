"""공통 권한 미들웨어 (DESIGN.md 4.2).

검사 순서: JWT(API Gateway) → PROFILE status active → 모듈 PERM → (공유 리소스 멤버 여부는 각 도메인에서)
"""

from dataclasses import dataclass
from typing import Any

from aws_lambda_powertools.event_handler import APIGatewayHttpResolver, Response
from aws_lambda_powertools.event_handler.api_gateway import BaseRouter
from aws_lambda_powertools.event_handler.exceptions import ForbiddenError, UnauthorizedError
from aws_lambda_powertools.event_handler.middlewares import NextMiddleware

from common import users
from common.perms import Level, Status, allows, required_permission

API_PREFIX = "/api/v1"
PUBLIC_PATHS = {"/health"}


@dataclass(frozen=True)
class Identity:
    sub: str
    groups: frozenset[str]

    @property
    def is_host(self) -> bool:
        return "host" in self.groups


@dataclass(frozen=True)
class Access:
    identity: Identity
    profile: dict[str, Any]
    level: Level  # 요청 모듈에 대한 권한 (Host는 edit). 공유 리소스의 역할과 함께 쓴다


def identity_from_event(event: dict[str, Any]) -> Identity | None:
    claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims")
    if not claims or "sub" not in claims:
        return None
    raw = claims.get("cognito:groups", "")
    # HTTP API JWT 인증기는 배열 claim을 "[host member]" 형태의 문자열로 넘긴다
    groups = raw if isinstance(raw, list) else str(raw).strip("[]").replace(",", " ").split()
    return Identity(sub=claims["sub"], groups=frozenset(groups))


def relative_path(path: str) -> str:
    return path.removeprefix(API_PREFIX) or "/"


def access_control(app: APIGatewayHttpResolver, next_middleware: NextMiddleware) -> Response:
    event = app.current_event
    path = relative_path(event.path)
    if path in PUBLIC_PATHS:
        return next_middleware(app)

    identity = identity_from_event(event.raw_event)
    if identity is None:
        raise UnauthorizedError("Unauthorized")

    required = required_permission(path, event.http_method)
    profile, granted = users.load_access(identity.sub, required[0] if required else None)
    if profile is None or profile.get("status") != Status.ACTIVE:
        raise ForbiddenError("inactive account")
    if required and not identity.is_host and not allows(granted, required[1]):
        raise ForbiddenError(f"no permission: {required[0]}")

    level = Level.EDIT if identity.is_host else granted
    app.append_context(access=Access(identity=identity, profile=profile, level=level))
    return next_middleware(app)


def current_access(resolver: BaseRouter) -> Access:
    """app 또는 include된 Router 어디서든 미들웨어가 넣어둔 접근 정보를 꺼낸다"""
    return resolver.context["access"]


def current_sub(resolver: BaseRouter) -> str:
    return current_access(resolver).identity.sub
