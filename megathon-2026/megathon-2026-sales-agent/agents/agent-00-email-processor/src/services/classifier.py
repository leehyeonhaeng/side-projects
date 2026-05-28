"""
classifier.py
─────────────
발신자 이메일 도메인 기반으로 Internal / External 분류.
"""

INTERNAL_DOMAINS = {"mz.co.kr", "megazone.com"}
INTERNAL_SHEET   = "Internal"
EXTERNAL_SHEET   = "External"

# 테스트 계정 — 중복 체크 없이 항상 시트에 기록
TEST_ACCOUNTS = {
    "hyunhaeng@megazone.com",  # Internal 테스트 계정
    "yoo@takeda.com",         # External 테스트 계정
}


def is_test_account(sender_email: str) -> bool:
    """테스트 계정 여부 반환."""
    return sender_email.strip().lower() in TEST_ACCOUNTS


def classify_domain(sender_email: str) -> str:
    """
    발신자 이메일 도메인으로 Internal / External 분류.

    Returns:
        "Internal" or "External"
    """
    if "@" not in sender_email:
        return EXTERNAL_SHEET
    domain = sender_email.strip().split("@")[-1].lower()
    return INTERNAL_SHEET if domain in INTERNAL_DOMAINS else EXTERNAL_SHEET
