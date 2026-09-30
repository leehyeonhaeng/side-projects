from typing import Any

from aws_lambda_powertools.utilities.typing import LambdaContext

from common.app import create_app

app, logger = create_app("admin")


@logger.inject_lambda_context
def lambda_handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    return app.resolve(event, context)
