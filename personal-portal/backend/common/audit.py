"""활동 로그 (DESIGN.md 4.4: 로그인, 권한·계정 변경만 기록). AUDIT#<yyyy-mm> / <timestamp>#<id>"""

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from boto3.dynamodb.conditions import Key

from common.aws import table


def record(action: str, actor: str, actor_email: str = "", target: str = "", detail: dict[str, Any] | None = None) -> None:
    now = datetime.now(UTC)
    at = now.isoformat(timespec="milliseconds")
    table().put_item(
        Item={
            "PK": f"AUDIT#{now:%Y-%m}",
            "SK": f"{at}#{uuid4().hex[:8]}",
            "action": action,
            "actor": actor,
            "actorEmail": actor_email,
            "target": target,
            "detail": detail or {},
            "at": at,
        }
    )


def list_month(month: str) -> list[dict[str, Any]]:
    res = table().query(KeyConditionExpression=Key("PK").eq(f"AUDIT#{month}"), ScanIndexForward=False, Limit=500)
    return list(res["Items"])
