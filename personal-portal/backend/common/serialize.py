"""DynamoDB 값 변환. boto3는 숫자를 Decimal로 돌려주는데, Powertools JSON 직렬화는 Decimal을 문자열로 만든다."""

from datetime import date
from decimal import Decimal
from typing import Any


def to_plain(value: Any) -> Any:
    """DynamoDB → 응답/계산용: Decimal을 int·float로"""
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, dict):
        return {k: to_plain(v) for k, v in value.items()}
    if isinstance(value, list):
        return [to_plain(v) for v in value]
    return value


def to_dynamo(value: Any) -> Any:
    """요청/계산 → DynamoDB: float는 Decimal, date는 ISO 문자열"""
    if isinstance(value, bool):
        return value
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: to_dynamo(v) for k, v in value.items()}
    if isinstance(value, list):
        return [to_dynamo(v) for v in value]
    return value
