"""
bedrock_service.py
──────────────────
이메일 본문에서 고객명(기업명)과 담당자 이름을 추출하는 서비스.
Amazon Bedrock Nova Lite 모델 사용.

Lambda IAM Role에 아래 권한 필요:
    - bedrock:InvokeModel (us.amazon.nova-lite-v1:0)
"""

import json
import boto3
from .response_builder import EXTRACT_EMAIL_SYSTEM_PROMPT

MODEL_ID = "us.amazon.nova-lite-v1:0"
REGION   = "us-east-1"   # Nova Lite는 us-east-1에서 호출


def extract_email_info(email_body: str) -> dict:
    """
    이메일 본문에서 고객명(기업명)과 담당자 이름을 추출한다.

    Args:
        email_body: 이메일 본문 텍스트

    Returns:
        {"customer_name": str, "manager_name": str}
        추출 실패 시 빈 문자열 반환.
    """
    empty = {"customer_name": "", "manager_name": ""}

    if not email_body or not email_body.strip():
        return empty

    client = boto3.client("bedrock-runtime", region_name=REGION)

    body = json.dumps({
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "text": (
                            "다음 이메일 본문에서 발신자의 소속 기업명과 담당자 이름을 추출해주세요.\n\n"
                            f"이메일 본문:\n{email_body}"
                        )
                    }
                ]
            }
        ],
        "system": [{"text": EXTRACT_EMAIL_SYSTEM_PROMPT}],
        "inferenceConfig": {"max_new_tokens": 256},
    })

    try:
        response = client.invoke_model(
            modelId=MODEL_ID,
            contentType="application/json",
            accept="application/json",
            body=body,
        )
        result = json.loads(response["body"].read())
        text   = result["output"]["message"]["content"][0]["text"].strip()

        # ```json ... ``` 블록으로 감싸진 경우 대비
        if "```" in text:
            text = text.split("```")[1].replace("json", "").strip()

        parsed = json.loads(text)
        extracted = {
            "customer_name": parsed.get("customer_name", ""),
            "manager_name":  parsed.get("manager_name", ""),
        }
        print(f"[bedrock] 추출 완료 — customer: '{extracted['customer_name']}', manager: '{extracted['manager_name']}'")
        return extracted

    except Exception as e:
        print(f"[bedrock] 추출 실패: {e}")
        return empty
