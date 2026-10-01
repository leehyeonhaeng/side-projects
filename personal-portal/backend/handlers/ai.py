from typing import Any

from aws_lambda_powertools.utilities.typing import LambdaContext

from common.app import create_app
from domains import ai

app, logger = create_app("ai")
# /ai/* 는 공통 미들웨어에서 health 모듈 편집 권한으로 검사한다
app.include_router(ai.router)


@logger.inject_lambda_context
def lambda_handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    return app.resolve(event, context)
