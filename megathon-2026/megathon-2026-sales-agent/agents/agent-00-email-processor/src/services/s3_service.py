"""
s3_service.py
─────────────
이메일 데이터를 Markdown으로 변환 후 S3에 저장하는 서비스.
"""

import os
import re
import boto3
from datetime import datetime, timezone, timedelta

KST = timezone(timedelta(hours=9))


def convert_to_markdown(email: dict, category: str) -> str:
    """이메일 dict를 Markdown 문자열로 변환."""
    subject      = email.get("subject", "(제목 없음)")
    sender_name  = email.get("sender_name", "")
    sender_email = email.get("sender_email", "")
    recipients   = email.get("recipients", [])
    date         = email.get("date", "")
    body         = email.get("body", "")

    sender_display = f"{sender_name} `{sender_email}`" if sender_name else f"`{sender_email}`"
    recipients_str = ", ".join(recipients) if recipients else "-"

    lines = [
        f"# {subject}",
        "",
        "## 메일 정보",
        f"- **분류**: {category.upper()}",
        f"- **발신자**: {sender_display}",
        f"- **수신자**: {recipients_str}",
        f"- **날짜**: {date}",
        "",
        "## 본문",
        "",
        body,
    ]
    return "\n".join(lines)


def _sanitize(value: str) -> str:
    """파일명/경로에 사용할 수 없는 문자 제거."""
    return re.sub(r'[\\/*?:"<>|]', "_", value).strip()


def build_s3_key(sender_email: str, category: str, s3_prefix: str, timestamp: str) -> str:
    """
    S3 저장 경로 생성.
    {prefix}/{internal|external}/{발신자 이메일}/{YYYYMMDD}/{timestamp}.md
    """
    date_dir     = datetime.now(KST).strftime("%Y%m%d")
    safe_email   = _sanitize(sender_email)
    return f"{s3_prefix}/{category.lower()}/{safe_email}/{date_dir}/{timestamp}.md"


PRESIGNED_EXPIRES = 7 * 24 * 60 * 60  # 7일 (초 단위)


def generate_presigned_url(s3_uri: str, region: str, expires: int = PRESIGNED_EXPIRES) -> str:
    """
    s3_uri로부터 Presigned URL을 생성한다.
    Lambda가 아닌 장기 자격증명 환경(로컬)에서 호출해야 유효기간이 보장됨.

    Args:
        s3_uri: "s3://bucket/key"
        region: AWS 리전
        expires: 유효기간 (초, 기본 7일)

    Returns:
        HTTPS Presigned URL
    """
    path   = s3_uri.replace("s3://", "")
    bucket = path.split("/")[0]
    key    = "/".join(path.split("/")[1:])

    s3 = boto3.client("s3", region_name=region)
    return s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=expires,
    )


def upload_markdown(content: str, s3_key: str, bucket: str, region: str) -> str:
    """
    Markdown 내용을 S3에 업로드하고 s3_uri를 반환.

    Returns:
        "s3://bucket/key"
    """
    s3 = boto3.client("s3", region_name=region)
    s3.put_object(
        Bucket=bucket,
        Key=s3_key,
        Body=content.encode("utf-8"),
        ContentType="text/markdown; charset=utf-8",
    )
    return f"s3://{bucket}/{s3_key}"


def process_email_to_s3(email: dict, category: str, bucket: str, s3_prefix: str, region: str) -> str:
    """
    이메일 dict를 Markdown으로 변환 후 S3에 저장.

    Returns:
        s3_uri ("s3://bucket/key")
    """
    markdown  = convert_to_markdown(email, category)
    timestamp = datetime.now(KST).strftime("%Y%m%d_%H%M%S")
    s3_key    = build_s3_key(email.get("sender_email", "unknown"), category, s3_prefix, timestamp)
    s3_uri    = upload_markdown(markdown, s3_key, bucket, region)
    print(f"[s3] 업로드 완료: {s3_uri}")
    return s3_uri
