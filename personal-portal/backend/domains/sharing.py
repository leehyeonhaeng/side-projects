"""공유 리소스(작업 보드·공용 체크리스트) 공통: 멤버·역할·초대·즐겨찾기 (DESIGN.md 4.2, 6.6·6.10 구현 결정).

- 키: <PREFIX>#<id> / MEMBER#<sub>, GSI1 USER#<sub> / <PREFIX>#<id> (내 목록)
- 실제 역할 = 모듈 권한과 리소스 역할 중 낮은 쪽 (모듈 view면 편집자라도 열람만)
- 만든 사람이 소유자: 멤버 관리·삭제는 소유자만. 멤버가 아니면 없는 것처럼 404
- 초대: 활성 계정 중 그 모듈 권한 view 이상(Host 포함)을 목록에서 골라 바로 추가
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal

from aws_lambda_powertools.event_handler.api_gateway import Router
from aws_lambda_powertools.event_handler.exceptions import BadRequestError, ForbiddenError, NotFoundError
from boto3.dynamodb.conditions import Key
from pydantic import BaseModel, ConfigDict, Field

from common.access import current_access
from common.aws import dynamodb, table
from common.http import parse_body
from common.perms import Level, Module, Role, Status, allows
from common.serialize import to_plain
from common.users import load_access, now_iso, user_pk

ID = r"^[A-Za-z0-9_-]{1,40}$"
SpaceRole = Literal["owner", "editor", "viewer"]
MemberRole = Literal["editor", "viewer"]
Need = Literal["view", "edit", "owner"]


class MemberAdd(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sub: str = Field(pattern=ID)
    role: MemberRole


class MemberPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: MemberRole


class FavoriteBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    favorite: bool


def effective(role: SpaceRole, level: Level) -> SpaceRole:
    return role if level == Level.EDIT else "viewer"


def profiles(subs: list[str]) -> dict[str, dict[str, Any]]:
    if not subs:
        return {}
    name = table().name
    out: dict[str, dict[str, Any]] = {}
    for i in range(0, len(subs), 100):
        keys = [{"PK": user_pk(s), "SK": "PROFILE"} for s in subs[i : i + 100]]
        res = dynamodb().batch_get_item(RequestItems={name: {"Keys": keys}})
        for p in res["Responses"].get(name, []):
            out[p["sub"]] = p
    return out


def person(p: dict[str, Any] | None, sub: str) -> dict[str, str]:
    return {"sub": sub, "name": (p or {}).get("name", ""), "email": (p or {}).get("email", "")}


def query_all(**kwargs: Any) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    start: dict[str, Any] | None = None
    while True:
        page = table().query(**kwargs, **({"ExclusiveStartKey": start} if start else {}))
        items.extend(page["Items"])
        start = page.get("LastEvaluatedKey")
        if not start:
            return items


def can_join(sub: str, module: Module) -> dict[str, Any] | None:
    """초대 가능한 계정: 활성 + 모듈 view 이상 (Host는 항상)"""
    profile, level = load_access(sub, module)
    if profile is None or profile.get("status") != Status.ACTIVE:
        return None
    if profile.get("role") != Role.HOST and not allows(level, Level.VIEW):
        return None
    return profile


@dataclass(frozen=True)
class Space:
    """공유 리소스 한 종류 (예: BOARD + boards 모듈)"""

    router: Router
    prefix: str
    module: Module

    def pk(self, rid: str) -> str:
        return f"{self.prefix}#{rid}"

    def authorize(self, rid: str, need: Need) -> tuple[str, SpaceRole]:
        access = current_access(self.router)
        sub = access.identity.sub
        member = table().get_item(Key={"PK": self.pk(rid), "SK": f"MEMBER#{sub}"}).get("Item")
        if member is None:
            raise NotFoundError(f"{self.module.value} not found")
        role = effective(member["role"], access.level)
        if need == "edit" and role == "viewer":
            raise ForbiddenError("read-only for you")
        if need == "owner" and role != "owner":
            raise ForbiddenError("only the owner can do this")
        return sub, role

    def member_item(self, rid: str, sub: str, role: SpaceRole) -> dict[str, Any]:
        return {"PK": self.pk(rid), "SK": f"MEMBER#{sub}", "sub": sub, "role": role, "addedAt": now_iso(), "GSI1PK": user_pk(sub), "GSI1SK": self.pk(rid)}

    def memberships(self, sub: str) -> list[dict[str, Any]]:
        """내가 멤버인 리소스의 멤버 항목들 (GSI1)"""
        return query_all(IndexName="GSI1", KeyConditionExpression=Key("GSI1PK").eq(user_pk(sub)) & Key("GSI1SK").begins_with(f"{self.prefix}#"))

    def members(self, rid: str) -> dict[str, dict[str, Any]]:
        items = query_all(KeyConditionExpression=Key("PK").eq(self.pk(rid)) & Key("SK").begins_with("MEMBER#"))
        return {i["sub"]: to_plain({k: v for k, v in i.items() if k not in ("PK", "SK", "GSI1PK", "GSI1SK")}) for i in items}

    @staticmethod
    def member_views(members: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
        """이름·이메일을 붙인 멤버 목록 (소유자 먼저)"""
        found = profiles(list(members))
        views = [{**person(found.get(s), s), "role": m["role"]} for s, m in members.items()]
        return sorted(views, key=lambda m: (m["role"] != "owner", m["name"]))

    def register_member_routes(self, base: str, on_remove: Callable[[str, str], None] | None = None) -> None:
        """base 예: "/boards/<rid>". 후보·추가·역할 변경·내보내기(나가기)·즐겨찾기 라우트를 등록한다.
        on_remove(rid, sub): 멤버가 빠질 때 정리 (예: 보드 카드 담당자 비우기)"""
        router = self.router

        @router.get(f"{base}/candidates")
        def candidates(rid: str) -> dict[str, Any]:
            """초대할 수 있는 계정 (이미 멤버인 계정 제외)"""
            self.authorize(rid, "owner")
            members = set(self.members(rid))
            active = query_all(IndexName="GSI1", KeyConditionExpression=Key("GSI1PK").eq(f"STATUS#{Status.ACTIVE}"))
            out = [person(p, p["sub"]) for p in active if p["sub"] not in members and can_join(p["sub"], self.module) is not None]
            return {"candidates": sorted(out, key=lambda p: p["name"])}

        @router.post(f"{base}/members")
        def add_member(rid: str) -> dict[str, Any]:
            self.authorize(rid, "owner")
            body = parse_body(router, MemberAdd)
            if table().get_item(Key={"PK": self.pk(rid), "SK": f"MEMBER#{body.sub}"}).get("Item"):
                raise BadRequestError("already a member")
            profile = can_join(body.sub, self.module)
            if profile is None:
                raise BadRequestError(f"this account cannot join {self.module.value}")
            table().put_item(Item=self.member_item(rid, body.sub, body.role))
            return {**person(profile, body.sub), "role": body.role}

        @router.patch(f"{base}/members/<msub>")
        def patch_member(rid: str, msub: str) -> dict[str, Any]:
            self.authorize(rid, "owner")
            body = parse_body(router, MemberPatch)
            member = table().get_item(Key={"PK": self.pk(rid), "SK": f"MEMBER#{msub}"}).get("Item")
            if member is None:
                raise NotFoundError("member not found")
            if member["role"] == "owner":
                raise BadRequestError("owner role cannot be changed")
            table().put_item(Item={**member, "role": body.role})
            return {"sub": msub, "role": body.role}

        @router.delete(f"{base}/members/<msub>")
        def remove_member(rid: str, msub: str) -> dict[str, Any]:
            """소유자가 내보내거나, 멤버가 스스로 나간다. 소유자는 나갈 수 없다 (삭제)"""
            access = current_access(router)
            me = access.identity.sub
            mine = table().get_item(Key={"PK": self.pk(rid), "SK": f"MEMBER#{me}"}).get("Item")
            if mine is None:
                raise NotFoundError(f"{self.module.value} not found")
            if msub != me and effective(mine["role"], access.level) != "owner":
                raise ForbiddenError("only the owner can do this")
            target = table().get_item(Key={"PK": self.pk(rid), "SK": f"MEMBER#{msub}"}).get("Item")
            if target is None:
                raise NotFoundError("member not found")
            if target["role"] == "owner":
                raise BadRequestError("owner cannot leave; delete it instead")
            table().delete_item(Key={"PK": self.pk(rid), "SK": f"MEMBER#{msub}"})
            if on_remove:
                on_remove(rid, msub)
            return {"removed": msub}

        @router.put(f"{base}/favorite")
        def set_favorite(rid: str) -> dict[str, Any]:
            """즐겨찾기는 내 멤버 항목에 저장 (사람마다 다름)"""
            sub, _ = self.authorize(rid, "view")
            favorite = parse_body(router, FavoriteBody).favorite
            table().update_item(Key={"PK": self.pk(rid), "SK": f"MEMBER#{sub}"}, UpdateExpression="SET favorite = :f", ExpressionAttributeValues={":f": favorite})
            return {"favorite": favorite}
