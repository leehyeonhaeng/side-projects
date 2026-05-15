"""
response_builder.py
───────────────────
Lambda 응답 양식 + AI 프롬프트를 관리하는 모듈.
Output 형식이나 프롬프트를 수정할 때 이 파일만 변경하면 됨.
"""

import json


# ─────────────────────────────────────────────────────────────────────────────
# AI 프롬프트 (수정 시 여기만 변경)
# ─────────────────────────────────────────────────────────────────────────────

MATCH_TAG_SYSTEM_PROMPT = (
    "당신은 이메일 내용을 분석하여 가장 적합한 담당자를 매칭하는 전문가입니다.\n"
    "규칙:\n"
    "1. 이메일 본문을 분석하세요.\n"
    "2. 제공된 Mapping Tag 목록 중 가장 관련 있는 태그를 선택하세요.\n"
    "3. 반드시 JSON 형식으로만 응답하세요:\n"
    '   {"matched_tag": "선택한 태그", "reason": "선택 이유 한 줄"}\n'
    "4. 매칭되는 태그가 없으면 matched_tag를 빈 문자열로 반환하세요.\n"
    "5. JSON 외 다른 텍스트는 절대 포함하지 마세요."
)

DRAFT_EMAIL_SYSTEM_PROMPT = (
    "당신은 비즈니스 이메일 작성 전문가입니다.\n"
    "규칙:\n"
    "1. 외부 고객이 보낸 이메일 내용을 요약하여 내부 담당자에게 전달하는 메일 초안을 작성하세요.\n"
    "2. 정중하고 간결한 비즈니스 한국어를 사용하세요.\n"
    "3. 반드시 JSON 형식으로만 응답하세요:\n"
    '   {"subject": "메일 제목", "body": "메일 본문"}\n'
    "4. JSON 외 다른 텍스트는 절대 포함하지 마세요."
)

RNR_UPDATE_SYSTEM_PROMPT = (
    "당신은 이메일 본문을 분석하여 업무 담당(R&R) 변경 사항을 파악하는 전문가입니다.\n"
    "규칙:\n"
    "1. 이메일 본문에서 업무 담당 변경, 인수인계, 역할 배정 관련 내용을 파악하세요.\n"
    "2. 현재 Internal 시트 데이터를 참고하세요.\n"
    "3. 반드시 JSON 형식으로만 응답하세요:\n"
    '   {"should_update": true/false, "target_email": "수정할 행의 담당자 이메일", "new_rnr": "새로운 R&R 값", "reason": "판단 이유"}\n'
    "4. 업무 담당 변경 내용이 없으면 should_update를 false로 반환하세요.\n"
    "5. JSON 외 다른 텍스트는 절대 포함하지 마세요."
)

EXTRACT_EMAIL_SYSTEM_PROMPT = (
    "당신은 이메일 본문에서 발신자 정보를 추출하는 전문가입니다.\n"
    "규칙:\n"
    "1. customer_name: 발신자가 소속된 회사명/기업명을 추출하세요.\n"
    "2. manager_name: 발신자의 이름(사람 이름)을 추출하세요.\n"
    "3. 각 항목을 찾을 수 없으면 빈 문자열을 반환하세요.\n"
    '4. 반드시 JSON 형식으로만 응답하세요: {"customer_name": "기업명", "manager_name": "담당자명"}\n'
    "5. JSON 외 다른 텍스트는 절대 포함하지 마세요."
)


# ─────────────────────────────────────────────────────────────────────────────
# Lambda 응답 빌더
# ─────────────────────────────────────────────────────────────────────────────


def build_success_response(data: dict) -> dict:
    """
    성공 응답 생성.

    Args:
        data: 응답에 포함할 데이터 dict

    Returns:
        Lambda 응답 형식 {"statusCode": 200, "body": "..."}
    """
    return {
        "statusCode": 200,
        "body": json.dumps(data, ensure_ascii=False),
    }


def build_error_response(message: str, status_code: int = 400) -> dict:
    """
    에러 응답 생성.

    Args:
        message: 에러 메시지
        status_code: HTTP 상태코드

    Returns:
        Lambda 응답 형식
    """
    return {
        "statusCode": status_code,
        "body": json.dumps({"message": message}, ensure_ascii=False),
    }


def build_external_response(
    category: str,
    sender_email: str,
    subject: str,
    customer_name: str,
    manager_name: str,
    matched_tag: str,
    matched_manager: str,
    matched_manager_email: str,
    draft_email: str,
    s3_uri: str,
    sheet_result: str,
) -> dict:
    """External 메일 처리 결과 응답."""
    return build_success_response({
        "category":              category.lower(),
        "sender":                sender_email,
        "subject":               subject,
        "customer_name":         customer_name,
        "manager_name":          manager_name,
        "matched_tag":           matched_tag,
        "matched_manager":       matched_manager,
        "matched_manager_email": matched_manager_email,
        "draft_email":           draft_email,
        "s3_uri":                s3_uri,
        "sheet":                 sheet_result,
    })


def build_internal_response(
    category: str,
    sender_email: str,
    subject: str,
    s3_uri: str,
    sheet_result: str,
    rnr_update: dict,
) -> dict:
    """Internal 메일 처리 결과 응답."""
    return build_success_response({
        "category":    category.lower(),
        "sender":      sender_email,
        "subject":     subject,
        "s3_uri":      s3_uri,
        "sheet":       sheet_result,
        "rnr_update":  rnr_update,
    })
