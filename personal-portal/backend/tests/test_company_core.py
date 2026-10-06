import json
import time
from typing import Any

import boto3
import pytest

from common import users
from common.aws import table
from common.perms import Level, Module, Role, Status
from handlers import auth_trigger, company
from tests.conftest import FakeContext, add_cognito_user, http_event


def call(ctx: FakeContext, sub: str | None, method: str, path: str, body: dict[str, Any] | None = None, host: bool = False) -> tuple[int, Any]:
    raw = json.dumps(body) if body is not None else None
    res = company.lambda_handler(http_event(method, f"/api/v1{path}", sub=sub, groups="[host]" if host else "", body=raw), ctx)
    return res["statusCode"], json.loads(res["body"])


@pytest.fixture
def people() -> None:
    users.create_profile("h1", "h@x.com", "호스트", "", Status.ACTIVE, Role.HOST)
    for sub in ("a1", "b1", "c1"):
        users.create_profile(sub, f"{sub}@x.com", sub.upper(), "", Status.ACTIVE, Role.MEMBER)
        users.set_perms(sub, {Module.TODO: Level.EDIT})


def new_company(ctx: FakeContext) -> str:
    status, body = call(ctx, "h1", "POST", "/company", {"name": "행컴퍼니"}, host=True)
    assert status == 200, body
    return body["id"]


def join(ctx: FakeContext, cid: str, sub: str, role: str) -> None:
    code = call(ctx, "h1", "POST", f"/company/{cid}/invites", {"roleId": role}, host=True)[1]["code"]
    assert call(ctx, sub, "POST", f"/company/invites/{code}/accept")[0] == 200


@pytest.mark.usefixtures("aws", "people")
class TestCompanyCore:
    def test_only_host_creates_and_host_sees_all(self, ctx: FakeContext) -> None:
        assert call(ctx, "a1", "POST", "/company", {"name": "x"})[0] == 403
        cid = new_company(ctx)
        assert call(ctx, "h1", "GET", "/company", host=True)[1]["companies"] == [{"id": cid, "name": "행컴퍼니", "isAdmin": True}]
        # 멤버가 아니면 없는 것처럼
        assert call(ctx, "a1", "GET", "/company")[1]["companies"] == []
        assert call(ctx, "a1", "GET", f"/company/{cid}")[0] == 404

    def test_invite_accept_and_role_permissions(self, ctx: FakeContext) -> None:
        cid = new_company(ctx)
        join(ctx, cid, "a1", "field")
        me = call(ctx, "a1", "GET", f"/company/{cid}")[1]["me"]
        assert (me["isAdmin"], me["showAmounts"], me["perms"]["assets"], me["perms"]["money"]) == (False, False, "edit", "none")
        assert call(ctx, "a1", "GET", "/company")[1]["companies"][0]["name"] == "행컴퍼니"
        # 현장 기사: 설정·직원 관리 불가
        assert call(ctx, "a1", "PATCH", f"/company/{cid}", {"ceo": "x"})[0] == 403
        assert call(ctx, "a1", "GET", f"/company/{cid}/members")[0] == 403

    def test_invite_single_use_and_expiry(self, ctx: FakeContext) -> None:
        cid = new_company(ctx)
        inv = call(ctx, "h1", "POST", f"/company/{cid}/invites", {"roleId": "office", "note": "김사무"}, host=True)[1]
        # 로그인 없이 초대 정보
        assert call(ctx, None, "GET", f"/invite/{inv['code']}")[1]["companyName"] == "행컴퍼니"
        assert [i["code"] for i in call(ctx, "h1", "GET", f"/company/{cid}/invites", host=True)[1]["invites"]] == [inv["code"]]
        assert call(ctx, "a1", "POST", f"/company/invites/{inv['code']}/accept")[0] == 200
        assert call(ctx, "b1", "POST", f"/company/invites/{inv['code']}/accept")[0] == 404  # 한 번만
        assert call(ctx, None, "GET", f"/invite/{inv['code']}")[0] == 404
        assert call(ctx, "h1", "GET", f"/company/{cid}/invites", host=True)[1]["invites"] == []
        # 기한 지난 초대
        inv2 = call(ctx, "h1", "POST", f"/company/{cid}/invites", {"roleId": "office"}, host=True)[1]
        table().update_item(Key={"PK": f"INVITE#{inv2['code']}", "SK": "META"}, UpdateExpression="SET #t = :t", ExpressionAttributeNames={"#t": "ttl"}, ExpressionAttributeValues={":t": int(time.time()) - 1})
        assert call(ctx, "b1", "POST", f"/company/invites/{inv2['code']}/accept")[0] == 404
        assert call(ctx, "h1", "POST", f"/company/{cid}/invites", {"roleId": "nope"}, host=True)[0] == 400

    def test_settings_and_member_changes(self, ctx: FakeContext) -> None:
        cid = new_company(ctx)
        join(ctx, cid, "a1", "admin")
        join(ctx, cid, "b1", "field")
        assert call(ctx, "a1", "PATCH", f"/company/{cid}", {"bizNo": "123-45-67890", "ceo": "이대표", "vatDefault": "included"})[1]["ceo"] == "이대표"
        assert call(ctx, "a1", "PATCH", f"/company/{cid}", {"vatDefault": "weird"})[0] == 400
        # 역할 바꾸기 → 그 역할 권한으로, 세부 조정
        m = call(ctx, "a1", "PATCH", f"/company/{cid}/members/b1", {"roleId": "accountant"})[1]
        assert (m["roleId"], m["showAmounts"], m["perms"]["money"]) == ("accountant", True, "edit")
        m = call(ctx, "a1", "PATCH", f"/company/{cid}/members/b1", {"showAmounts": False, "perms": {"money": "view"}})[1]
        assert (m["showAmounts"], m["perms"]["money"], m["perms"]["assets"]) == (False, "view", "none")
        assert call(ctx, "a1", "PATCH", f"/company/{cid}/members/b1", {"perms": {"hack": "edit"}})[0] == 400
        members = call(ctx, "a1", "GET", f"/company/{cid}/members")[1]["members"]
        # 관리자 먼저, 그다음 이름순
        assert [x["sub"] for x in members] == ["a1", "h1", "b1"] and members[1]["name"] == "호스트"
        # 역할 프리셋 수정 (관리자 역할은 불가)
        assert call(ctx, "a1", "PUT", f"/company/{cid}/roles/field", {"name": "기사", "showAmounts": False, "perms": {"assets": "edit"}})[0] == 200
        assert call(ctx, "a1", "PUT", f"/company/{cid}/roles/admin", {"name": "x", "showAmounts": True, "perms": {}})[0] == 400
        roles = {r["id"]: r for r in call(ctx, "a1", "GET", f"/company/{cid}/roles")[1]["roles"]}
        assert roles["field"]["name"] == "기사" and roles["office"]["name"] == "사무"
        logs = call(ctx, "a1", "GET", f"/company/{cid}/audit")[1]["logs"]
        assert {"settings_change", "member_change", "role_change", "invite_accept"} <= {log["action"] for log in logs}

    def test_last_admin_protected(self, ctx: FakeContext) -> None:
        cid = new_company(ctx)
        join(ctx, cid, "a1", "field")
        # 처음 관리자(h1) 하나뿐: 내보내기·관리자 해제 불가, 일반 직원은 스스로 나가기 가능
        assert call(ctx, "h1", "PATCH", f"/company/{cid}/members/h1", {"isAdmin": False}, host=True)[0] == 400
        assert call(ctx, "h1", "DELETE", f"/company/{cid}/members/h1", host=True)[0] == 400
        assert call(ctx, "a1", "DELETE", f"/company/{cid}/members/b1")[0] == 403
        assert call(ctx, "a1", "DELETE", f"/company/{cid}/members/a1")[0] == 200
        assert call(ctx, "a1", "GET", f"/company/{cid}")[0] == 404


@pytest.mark.usefixtures("aws", "people")
class TestInviteSignup:
    def _event(self, pool_id: str, sub: str, code: str) -> dict[str, Any]:
        return {
            "triggerSource": "PostConfirmation_ConfirmSignUp",
            "userPoolId": pool_id,
            "userName": sub,
            "request": {"userAttributes": {"sub": sub, "email": f"{sub}@new.com", "name": "새직원"}, "clientMetadata": {"inviteCode": code}},
            "response": {},
        }

    def test_valid_invite_activates_without_host(self, aws: dict[str, str], ctx: FakeContext) -> None:
        cid = new_company(ctx)
        code = call(ctx, "h1", "POST", f"/company/{cid}/invites", {"roleId": "field"}, host=True)[1]["code"]
        add_cognito_user(aws["pool_id"], "n1", "n1@new.com")
        auth_trigger.lambda_handler(self._event(aws["pool_id"], "n1", code), ctx)
        assert boto3.client("cognito-idp").admin_get_user(UserPoolId=aws["pool_id"], Username="n1")["Enabled"] is True
        assert users.get_profile("n1")["status"] == "active"  # type: ignore[index]
        perms = users.get_perms("n1")
        assert (perms[Module.CALENDAR], perms[Module.HEALTH]) == ("edit", "none")  # "회사 직원" 프리셋
        assert call(ctx, "n1", "GET", f"/company/{cid}")[1]["me"]["perms"]["assets"] == "edit"

    def test_invalid_invite_falls_back_to_pending(self, aws: dict[str, str], ctx: FakeContext) -> None:
        add_cognito_user(aws["pool_id"], "n2", "n2@new.com")
        auth_trigger.lambda_handler(self._event(aws["pool_id"], "n2", "bogus-code"), ctx)
        assert boto3.client("cognito-idp").admin_get_user(UserPoolId=aws["pool_id"], Username="n2")["Enabled"] is False
        assert users.get_profile("n2")["status"] == "pending"  # type: ignore[index]
