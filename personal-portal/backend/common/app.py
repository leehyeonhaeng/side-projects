from aws_lambda_powertools import Logger
from aws_lambda_powertools.event_handler import APIGatewayHttpResolver

API_PREFIX = "/api/v1"


def create_app(service: str) -> tuple[APIGatewayHttpResolver, Logger]:
    """도메인 Lambda 공통 골격. 라우트 경로는 /api/v1 을 뺀 나머지로 등록한다."""
    logger = Logger(service=service)
    app = APIGatewayHttpResolver(strip_prefixes=[API_PREFIX])

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": service}

    return app, logger
