"""
Agent_00 - lambda_function.py
──────────────────────────────
이메일 스레드 JSON을 받아 처리하는 Lambda.

처리 흐름:
    1. 테스트 계정 여부 확인
    2. 발신자 도메인 → Internal / External 판별
    3. Bedrock으로 고객명 / 담당자명 추출
    4. 이메일 → Markdown 변환 후 S3 저장
    5. Google Sheets 해당 시트에 기록
    6. Agent 로직 실행:
       - External: Mapping Tag 매칭 → 담당자 메일 초안 작성
       - Internal: 본문 분석 → Assigned R&R 업데이트
"""

import json
import os
from datetime import datetime, timezone, timedelta

from services.classifier      import classify_domain, is_test_account
from services.bedrock_service import extract_email_info
from services.sheets_service  import log_to_sheet, get_internal_data, update_rnr
from services.s3_service      import process_email_to_s3
from services.agent_service   import match_mapping_tag, draft_email_for_manager, analyze_rnr_update
from services.response_builder import (
    build_error_response,
    build_external_response,
    build_internal_response,
)

# ── 설정 ──────────────────────────────────────────────────────────────────────
S3_BUCKET  = os.environ.get("S3_BUCKET", "agent-00-emails-238043188225")
S3_PREFIX  = os.environ.get("S3_PREFIX", "emails")
APP_REGION = os.environ.get("APP_REGION", "ap-northeast-2")
KST        = timezone(timedelta(hours=9))
# ─────────────────────────────────────────────────────────────────────────────


def _parse_sender(sender_raw: str) -> tuple[str, str]:
    """
    'sender' 필드에서 이름과 이메일을 파싱.
    형식: "홍길동 <hong@company.com>" 또는 "hong@company.com"

    Returns:
        (sender_name, sender_email)
    """
    import re
    match = re.match(r"^(.*?)\s*<(.+?)>$", sender_raw.strip())
    if match:
        return match.group(1).strip().strip('"'), match.group(2).strip()
    # <> 없이 이메일만 있는 경우
    return "", sender_raw.strip()


def lambda_handler(event, context):
    print(f"[agent_00] 수신 이벤트: {json.dumps(event, ensure_ascii=False)}")

    # ── payload 형식 파싱 ─────────────────────────────────────────────────────
    ctx = event.get("context", {})
    sender_raw   = ctx.get("sender", "") or event.get("sender_email", "")
    sender_name_parsed, sender_email = _parse_sender(sender_raw)

    # 하위 호환: 기존 flat 형식도 지원
    if not sender_email:
        sender_email = event.get("sender_email", "").strip()

    subject    = ctx.get("subject", "") or event.get("subject", "")
    body       = ctx.get("body_text", "") or event.get("body", "")
    date       = ctx.get("date", "") or event.get("date", "")
    sender_name = event.get("sender_name", "") or sender_name_parsed

    # ── 필수 필드 검증 ────────────────────────────────────────────────────────
    if not sender_email:
        return build_error_response("sender_email은 필수입니다.")

    # date 기본값
    if not date:
        date = datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S KST")

    # ── 1. 테스트 계정 여부 확인 ──────────────────────────────────────────────
    is_test = is_test_account(sender_email)
    if is_test:
        print(f"[agent_00] 테스트 계정 감지: '{sender_email}'")

    # ── 2. Internal / External 판별 ───────────────────────────────────────────
    category = classify_domain(sender_email)
    print(f"[agent_00] 분류: {category} ({sender_email})")

    # ── 3. Bedrock으로 고객명 / 담당자명 추출 ────────────────────────────────
    email_body = body
    ai_info    = extract_email_info(email_body)
    customer_name = ai_info["customer_name"]
    manager_name  = ai_info["manager_name"]
    sender_name   = sender_name or manager_name

    # 통합 이벤트 dict (하위 서비스에 전달용)
    normalized_event = {
        "subject":      subject,
        "body":         body,
        "sender_email": sender_email,
        "sender_name":  sender_name,
        "recipients":   event.get("recipients", []),
        "date":         date,
    }

    # ── 4. S3에 Markdown 저장 ─────────────────────────────────────────────────
    s3_uri = process_email_to_s3(
        email     = normalized_event,
        category  = category,
        bucket    = S3_BUCKET,
        s3_prefix = S3_PREFIX,
        region    = APP_REGION,
    )

    # ── 5. Google Sheets 기록 ─────────────────────────────────────────────────
    sheet_result = log_to_sheet(
        sheet_name   = category,
        sender_email = sender_email,
        extra        = {
            "sender_name": sender_name,
            "account":     customer_name,
        },
        force = is_test,
    )

    # ── 6. Agent 로직 ────────────────────────────────────────────────────────
    if category == "External":
        return _handle_external(normalized_event, sender_email, sender_name, customer_name, manager_name, s3_uri, sheet_result)
    else:
        return _handle_internal(normalized_event, sender_email, s3_uri, sheet_result)


def _handle_external(event, sender_email, sender_name, customer_name, manager_name, s3_uri, sheet_result):
    """External 메일: Mapping Tag 매칭 → 담당자 메일 초안 작성."""
    email_body = event.get("body", "")
    subject    = event.get("subject", "")

    # Internal 시트에서 Mapping Tag 목록 조회
    print("[agent_00] Internal 시트 데이터 조회 중...")
    internal_data = get_internal_data()
    print(f"[agent_00] Internal 시트 행 수: {len(internal_data)}")

    # AI: Mapping Tag 매칭
    print("[agent_00] Mapping Tag 매칭 중...")
    match_result = match_mapping_tag(email_body, internal_data)
    matched_tag       = match_result["matched_tag"]
    matched_manager   = match_result["manager"]
    matched_email     = match_result["manager_email"]

    # AI: 메일 초안 작성
    draft = {"subject": "", "body": ""}
    if matched_manager:
        print(f"[agent_00] 메일 초안 작성 중... (담당자: {matched_manager})")
        draft = draft_email_for_manager(
            original_body    = email_body,
            original_subject = subject,
            sender_name      = sender_name,
            sender_email     = sender_email,
            manager_name     = matched_manager,
        )

    draft_text = f"제목: {draft['subject']}\n\n{draft['body']}" if draft["body"] else ""

    print(f"[agent_00] External 처리 완료")
    return build_external_response(
        category              = "External",
        sender_email          = sender_email,
        subject               = event.get("subject", ""),
        customer_name         = customer_name,
        manager_name          = manager_name,
        matched_tag           = matched_tag,
        matched_manager       = matched_manager,
        matched_manager_email = matched_email,
        draft_email           = draft_text,
        s3_uri                = s3_uri,
        sheet_result          = sheet_result,
    )


def _handle_internal(event, sender_email, s3_uri, sheet_result):
    """Internal 메일: 본문 분석 → Assigned R&R 업데이트."""
    email_body = event.get("body", "")

    # Internal 시트 데이터 조회
    print("[agent_00] Internal 시트 데이터 조회 중...")
    internal_data = get_internal_data()

    # AI: R&R 업데이트 분석
    print("[agent_00] R&R 업데이트 분석 중...")
    rnr_result = analyze_rnr_update(email_body, sender_email, internal_data)

    # 업데이트 필요 시 실행
    if rnr_result["should_update"] and rnr_result["target_email"] and rnr_result["new_rnr"]:
        print(f"[agent_00] R&R 업데이트 실행: {rnr_result['target_email']} → '{rnr_result['new_rnr']}'")
        update_rnr(rnr_result["target_email"], rnr_result["new_rnr"])
    else:
        print("[agent_00] R&R 업데이트 불필요")

    print(f"[agent_00] Internal 처리 완료")
    return build_internal_response(
        category     = "Internal",
        sender_email = sender_email,
        subject      = event.get("subject", ""),
        s3_uri       = s3_uri,
        sheet_result = sheet_result,
        rnr_update   = rnr_result,
    )
