"""Cognito 트리거 (DESIGN.md 4.1 가입 처리 흐름).

- PostConfirmation: 이메일 인증 직후 계정 비활성화 + PROFILE(pending) + Host에게 알림.
  HOST_EMAIL로 가입한 계정은 바로 활성화하고 host 그룹·전체 권한을 준다.
  행컴퍼니 초대 코드(clientMetadata.inviteCode)가 유효하면 Host 승인 없이 활성 + 회사 멤버 + "회사 직원" 프리셋 (COMPANY.md 8장)
- PostAuthentication: 로그인 활동 로그
"""

import os
from typing import Any

from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext

from common import audit, users
from common.aws import cognito, sns
from common.aws import table
from common.perms import DEFAULT_PRESETS, Level, Module, Role, Status, all_edit
from domains import company_core

logger = Logger(service="auth-trigger")


def on_signup_confirmed(event: dict[str, Any]) -> None:
    attrs = event["request"]["userAttributes"]
    pool_id = event["userPoolId"]
    username = event["userName"]
    sub = attrs["sub"]
    email = attrs["email"].lower()
    name = attrs.get("name", "")
    note = attrs.get("custom:signup_note", "")

    if email == os.environ["HOST_EMAIL"].lower():
        cognito().admin_add_user_to_group(UserPoolId=pool_id, Username=username, GroupName="host")
        users.create_profile(sub, email, name, note, Status.ACTIVE, Role.HOST)
        users.set_perms(sub, all_edit())
        logger.info("host account activated", extra={"sub": sub})
        return

    code = (event["request"].get("clientMetadata") or {}).get("inviteCode", "")
    if code:
        # 초대 가입: 프로필을 먼저 만들고(회사 기록에 이름이 보이게) 초대를 쓴다. 초대가 무효면 일반 가입(승인 대기)으로
        users.create_profile(sub, email, name, note, Status.ACTIVE, Role.MEMBER)
        joined = company_core.use_invite(code, sub)
        if joined is not None:
            users.set_perms(sub, staff_perms())
            audit.record("invite_signup", actor=sub, actor_email=email, target=joined["cid"], detail={"company": joined["companyName"]})
            logger.info("invited account activated", extra={"sub": sub, "cid": joined["cid"]})
            return
        # 무효 초대: 아래에서 승인 대기 프로필로 덮어쓴다

    # 로그인 차단이 가장 중요하므로 먼저 처리한다
    cognito().admin_disable_user(UserPoolId=pool_id, Username=username)
    users.create_profile(sub, email, name, note, Status.PENDING, Role.MEMBER)

    try:
        sns().publish(
            TopicArn=os.environ["SIGNUP_TOPIC_ARN"],
            Subject="[Personal Portal] 가입 승인 요청",
            Message=f"새 가입 신청이 있습니다.\n\n이름: {name}\n이메일: {email}\n메모: {note or '-'}\n\n관리자 화면에서 승인하거나 거절하세요.",
        )
    except Exception:
        # 알림 실패로 가입을 막지 않는다 (관리자 화면 배지로도 확인 가능)
        logger.exception("signup notification failed")


def staff_perms() -> dict[Module, Level]:
    """초대 가입 직원의 행포털 개인 권한: Host가 고친 "회사 직원" 프리셋, 없으면 기본값"""
    item = table().get_item(Key={"PK": "PRESET", "SK": "PRESET#staff"}).get("Item")
    raw = item["perms"] if item else next(p["perms"] for p in DEFAULT_PRESETS if p["id"] == "staff")
    perms = {Module(k): Level(v) for k, v in raw.items()}  # type: ignore[union-attr]
    return {m: perms.get(m, Level.NONE) for m in Module}


def on_login(event: dict[str, Any]) -> None:
    attrs = event["request"]["userAttributes"]
    audit.record("login", actor=attrs["sub"], actor_email=attrs.get("email", ""))


@logger.inject_lambda_context
def lambda_handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    source = event.get("triggerSource")
    if source == "PostConfirmation_ConfirmSignUp":
        on_signup_confirmed(event)
    elif source == "PostAuthentication_Authentication":
        on_login(event)
    return event
