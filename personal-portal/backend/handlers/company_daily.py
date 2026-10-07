"""행컴퍼니 아침 확인 (EventBridge Scheduler, 매일 08:30 KST). 회사마다 새로 생긴 연체·만료 임박·청구 대기·검침·밀린 A/S 알림"""

from datetime import datetime, timedelta, timezone
from typing import Any

from aws_lambda_powertools import Logger
from aws_lambda_powertools.utilities.typing import LambdaContext
from boto3.dynamodb.conditions import Key

from domains import company_notify
from domains.sharing import query_all

logger = Logger(service="company-daily")
KST = timezone(timedelta(hours=9))


@logger.inject_lambda_context
def lambda_handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    today = datetime.now(KST).date()
    results = {}
    for c in query_all(IndexName="GSI1", KeyConditionExpression=Key("GSI1PK").eq("COMPANIES")):
        try:
            results[c["id"]] = company_notify.daily(c["id"], today)
        except Exception:  # 한 회사가 실패해도 나머지는 계속
            logger.exception("daily check failed", extra={"cid": c["id"]})
            results[c["id"]] = {"error": 1}
    logger.info("daily done", extra={"results": results})
    return {"companies": len(results), "results": results}
