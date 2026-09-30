"""Cognito 트리거 (DESIGN.md 4.1 가입 처리 흐름).

- PostConfirmation: 이메일 인증 직후 계정 비활성화 + PROFILE(pending) + Host에게 알림.
  HOST_EMAIL로 가입한 계정은 바로 활성화하고 host 그룹·전체 권한을 준다.
- PostAuthentication: 로그인 활동 로그
"""

import os
from typing import Any

from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext

from common import audit, users
from common.aws import cognito, sns
from common.perms import Role, Status, all_edit

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
