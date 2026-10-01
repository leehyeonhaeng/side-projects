"""AI 칼로리 추정 (DESIGN.md 6.3, ADR-06). ai Lambda에서만 import 한다 (Bedrock 권한·anthropic SDK가 이 Lambda에만 있음).

- 모델: Claude Haiku 4.5, Bedrock 교차 리전 추론 프로필(BEDROCK_MODEL_ID)
- 구조화 출력(messages.parse + Pydantic)으로 JSON 형식을 보장
- 계정당 하루 50회: USER#<sub> / AIUSAGE#<KST 날짜> (TTL로 자동 삭제)
"""

import os
import time
from datetime import datetime, timedelta, timezone
from functools import cache
from typing import Any

from anthropic import AnthropicBedrock, APIError
from aws_lambda_powertools import Logger
from aws_lambda_powertools.event_handler.api_gateway import Router
from aws_lambda_powertools.event_handler.exceptions import BadRequestError, ServiceError
from pydantic import BaseModel, ConfigDict, Field

from common.access import current_sub
from common.aws import table
from common.http import parse_body
from common.users import user_pk

router = Router()
logger = Logger(service="ai")

DAILY_LIMIT = 50
KST = timezone(timedelta(hours=9))

SYSTEM_PROMPT = """너는 한국 사용자의 식단 기록을 돕는 영양 추정기다.
사용자가 먹은 음식을 한 줄로 적으면, 음식마다 다음을 추정한다.
- name: 사용자가 쓴 음식 이름 그대로 (한국어)
- grams: 섭취량(g). 사용자가 양을 적었으면 그 값, 없으면 한국에서 흔한 1인분 기준
- kcal, carb, protein, fat: 그 섭취량 기준 열량(kcal)과 탄수화물·단백질·지방(g)

규칙:
- 입력에 나온 순서대로, 음식 하나당 항목 하나
- "공기", "그릇", "개", "조각" 같은 단위는 g으로 환산한다
- 숫자는 소수 첫째 자리까지
- 음식이 아닌 입력이면 items를 빈 배열로 둔다"""


class FoodEstimate(BaseModel):
    name: str
    grams: float
    kcal: float
    carb: float
    protein: float
    fat: float


class Estimate(BaseModel):
    items: list[FoodEstimate]


class EstimateBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=300)


@cache
def client() -> AnthropicBedrock:
    # Lambda가 AWS_REGION을 넣어준다. 자격 증명은 실행 역할을 쓴다
    return AnthropicBedrock(aws_region=os.environ["AWS_REGION"])


def kst_today() -> str:
    return datetime.now(KST).date().isoformat()


def _usage_key(sub: str) -> dict[str, str]:
    return {"PK": user_pk(sub), "SK": f"AIUSAGE#{kst_today()}"}


def used_today(sub: str) -> int:
    item = table().get_item(Key=_usage_key(sub)).get("Item") or {}
    return int(item.get("count", 0))


def reserve_call(sub: str) -> int:
    """호출 전에 1회를 먼저 차감한다 (동시 요청도 상한을 넘지 않게 조건부 증가). 넘으면 429."""
    try:
        res = table().update_item(
            Key=_usage_key(sub),
            UpdateExpression="SET #c = if_not_exists(#c, :zero) + :one, #t = :ttl",
            ConditionExpression="attribute_not_exists(#c) OR #c < :limit",
            ExpressionAttributeNames={"#c": "count", "#t": "ttl"},
            ExpressionAttributeValues={":zero": 0, ":one": 1, ":limit": DAILY_LIMIT, ":ttl": int(time.time()) + 3 * 86400},
            ReturnValues="UPDATED_NEW",
        )
    except table().meta.client.exceptions.ConditionalCheckFailedException as exc:
        raise ServiceError(429, f"오늘 AI 계산 횟수({DAILY_LIMIT}회)를 모두 썼습니다") from exc
    return int(res["Attributes"]["count"])


def release_call(sub: str) -> None:
    """AI 호출이 실패하면 차감을 되돌린다 (실패까지 횟수로 세지 않음)"""
    try:
        table().update_item(
            Key=_usage_key(sub),
            UpdateExpression="SET #c = #c - :one",
            ConditionExpression="#c > :zero",
            ExpressionAttributeNames={"#c": "count"},
            ExpressionAttributeValues={":one": 1, ":zero": 0},
        )
    except Exception:
        logger.exception("failed to release ai usage")


def estimate(text: str) -> Estimate:
    response = client().messages.parse(
        model=os.environ["BEDROCK_MODEL_ID"],
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": text}],
        output_format=Estimate,
    )
    if response.stop_reason != "end_turn" or response.parsed_output is None:
        raise ValueError(f"unexpected stop_reason: {response.stop_reason}")
    logger.info("estimated", extra={"items": len(response.parsed_output.items), "usage": response.usage.model_dump()})
    return response.parsed_output


def clean(items: list[FoodEstimate]) -> list[dict[str, Any]]:
    """모델 값 방어: 음수는 0, 소수 첫째 자리로"""
    out = []
    for i in items[:30]:
        row = i.model_dump()
        for k in ("grams", "kcal", "carb", "protein", "fat"):
            row[k] = round(max(0.0, float(row[k])), 1)
        row["name"] = row["name"].strip()[:100] or "음식"
        out.append(row)
    return out


@router.get("/ai/usage")
def usage_route() -> dict[str, Any]:
    return {"used": used_today(current_sub(router)), "limit": DAILY_LIMIT}


@router.post("/ai/estimate-calories")
def estimate_route() -> dict[str, Any]:
    body = parse_body(router, EstimateBody)
    text = body.text.strip()
    if not text:
        raise BadRequestError("text is required")
    sub = current_sub(router)
    used = reserve_call(sub)
    try:
        result = estimate(text)
    except (APIError, ValueError) as exc:
        release_call(sub)
        logger.exception("ai estimate failed")
        raise ServiceError(502, "AI 계산에 실패했습니다. 잠시 후 다시 시도하세요") from exc
    return {"items": clean(result.items), "usage": {"used": used, "limit": DAILY_LIMIT}}
