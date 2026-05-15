"""
agent_service.py
────────────────
Agent 로직 서비스.
- External: Mapping Tag 매칭 + 담당자 메일 초안 작성
- Internal: 본문 분석 → Assigned R&R 업데이트 판단

Bedrock Nova Lite 모델 사용.
프롬프트는 response_builder.py에서 관리.
"""

import json
import boto3
from .response_builder import (
    MATCH_TAG_SYSTEM_PROMPT,
    DRAFT_EMAIL_SYSTEM_PROMPT,
    RNR_UPDATE_SYSTEM_PROMPT,
)

MODEL_ID = "us.amazon.nova-lite-v1:0"
REGION   = "us-east-1"


def _invoke_bedrock(system_prompt: str, user_message: str) -> str:
    """Bedrock Nova Lite 호출 후 텍스트 응답 반환."""
    client = boto3.client("bedrock-runtime", region_name=REGION)

    body = json.dumps({
        "messages": [
            {"role": "user", "content": [{"text": user_message}]}
        ],
        "system": [{"text": system_prompt}],
        "inferenceConfig": {"max_new_tokens": 1024},
    })

    response = client.invoke_model(
        modelId=MODEL_ID,
        contentType="application/json",
        accept="application/json",
        body=body,
    )
    result = json.loads(response["body"].read())
    text   = result["output"]["message"]["content"][0]["text"].strip()
    return text


def _parse_json_response(text: str) -> dict:
    """AI 응답에서 JSON 파싱. ```json 블록 대비."""
    if "```" in text:
        text = text.split("```")[1].replace("json", "").strip()
    return json.loads(text)


# ─────────────────────────────────────────────────────────────────────────────
# External Agent: Mapping Tag 매칭 + 메일 초안 작성
# ─────────────────────────────────────────────────────────────────────────────


def match_mapping_tag(email_body: str, tag_list: list[dict]) -> dict:
    """
    이메일 본문과 Internal 시트의 Mapping Tag 목록을 비교하여 매칭.

    Args:
        email_body: 외부 고객 이메일 본문
        tag_list:   Internal 시트 데이터 [{"담당자": ..., "담당자 이메일": ..., "Assigned R&R": ..., "Mapping Tag": ...}, ...]

    Returns:
        {"matched_tag": str, "reason": str, "manager": str, "manager_email": str}
    """
    empty = {"matched_tag": "", "reason": "", "manager": "", "manager_email": ""}

    if not email_body or not tag_list:
        return empty

    # Mapping Tag 목록 텍스트 생성
    tags_text = "\n".join([
        f"- Tag: {row.get('Mapping Tag', '')} | 담당자: {row.get('담당자', '')} | R&R: {row.get('Assigned R&R', '')}"
        for row in tag_list if row.get("Mapping Tag")
    ])

    if not tags_text.strip():
        return empty

    user_msg = (
        f"이메일 본문:\n{email_body}\n\n"
        f"Mapping Tag 목록:\n{tags_text}"
    )

    try:
        text   = _invoke_bedrock(MATCH_TAG_SYSTEM_PROMPT, user_msg)
        parsed = _parse_json_response(text)
        matched_tag = parsed.get("matched_tag", "")
        reason      = parsed.get("reason", "")

        # 매칭된 태그에 해당하는 담당자 정보 찾기
        manager       = ""
        manager_email = ""
        for row in tag_list:
            if row.get("Mapping Tag", "").strip() == matched_tag.strip():
                manager       = row.get("담당자", "")
                manager_email = row.get("담당자 이메일", "")
                break

        print(f"[agent] Tag 매칭: '{matched_tag}' → {manager} ({manager_email}) | 이유: {reason}")
        return {
            "matched_tag":    matched_tag,
            "reason":         reason,
            "manager":        manager,
            "manager_email":  manager_email,
        }

    except Exception as e:
        print(f"[agent] Tag 매칭 실패: {e}")
        return empty


def draft_email_for_manager(
    original_body: str,
    original_subject: str,
    sender_name: str,
    sender_email: str,
    manager_name: str,
) -> dict:
    """
    외부 고객 메일을 기반으로 내부 담당자에게 보낼 메일 초안 작성.

    Returns:
        {"subject": str, "body": str}
    """
    empty = {"subject": "", "body": ""}

    user_msg = (
        f"외부 고객 정보:\n"
        f"- 이름: {sender_name}\n"
        f"- 이메일: {sender_email}\n"
        f"- 메일 제목: {original_subject}\n\n"
        f"외부 고객 메일 본문:\n{original_body}\n\n"
        f"내부 담당자 이름: {manager_name}\n\n"
        f"위 내용을 바탕으로 내부 담당자에게 전달할 메일 초안을 작성해주세요."
    )

    try:
        text   = _invoke_bedrock(DRAFT_EMAIL_SYSTEM_PROMPT, user_msg)
        parsed = _parse_json_response(text)
        result = {
            "subject": parsed.get("subject", ""),
            "body":    parsed.get("body", ""),
        }
        print(f"[agent] 메일 초안 작성 완료: 제목='{result['subject']}'")
        return result

    except Exception as e:
        print(f"[agent] 메일 초안 작성 실패: {e}")
        return empty


# ─────────────────────────────────────────────────────────────────────────────
# Internal Agent: 본문 분석 → Assigned R&R 업데이트 판단
# ─────────────────────────────────────────────────────────────────────────────


def analyze_rnr_update(email_body: str, sender_email: str, internal_data: list[dict]) -> dict:
    """
    Internal 메일 본문을 분석하여 Assigned R&R 업데이트 여부 판단.

    Args:
        email_body:    내부 직원 이메일 본문
        sender_email:  발신자 이메일
        internal_data: Internal 시트 데이터 목록

    Returns:
        {"should_update": bool, "target_email": str, "new_rnr": str, "reason": str}
    """
    empty = {"should_update": False, "target_email": "", "new_rnr": "", "reason": ""}

    if not email_body:
        return empty

    # 현재 시트 데이터 텍스트 생성
    sheet_text = "\n".join([
        f"- 담당자: {row.get('담당자', '')} | 이메일: {row.get('담당자 이메일', '')} | R&R: {row.get('Assigned R&R', '')} | Tag: {row.get('Mapping Tag', '')}"
        for row in internal_data
    ])

    user_msg = (
        f"발신자: {sender_email}\n\n"
        f"이메일 본문:\n{email_body}\n\n"
        f"현재 Internal 시트 데이터:\n{sheet_text}"
    )

    try:
        text   = _invoke_bedrock(RNR_UPDATE_SYSTEM_PROMPT, user_msg)
        parsed = _parse_json_response(text)
        result = {
            "should_update": parsed.get("should_update", False),
            "target_email":  parsed.get("target_email", ""),
            "new_rnr":       parsed.get("new_rnr", ""),
            "reason":        parsed.get("reason", ""),
        }
        print(f"[agent] R&R 분석: should_update={result['should_update']}, target={result['target_email']}, new_rnr='{result['new_rnr']}'")
        return result

    except Exception as e:
        print(f"[agent] R&R 분석 실패: {e}")
        return empty
