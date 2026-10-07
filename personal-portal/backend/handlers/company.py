from typing import Any

from aws_lambda_powertools.utilities.typing import LambdaContext

from common.app import create_app
from domains import company_core, company_master, company_rental, company_service, company_txn

# 행컴퍼니 (docs/COMPANY.md). 회사 데이터·문서만 다루는 별도 Lambda (최소 권한)
app, logger = create_app("company")
app.include_router(company_core.router)
app.include_router(company_master.router)
app.include_router(company_txn.router)
app.include_router(company_rental.router)
app.include_router(company_service.router)


@logger.inject_lambda_context
def lambda_handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    return app.resolve(event, context)
