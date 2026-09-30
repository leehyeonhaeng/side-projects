from typing import Any

from aws_lambda_powertools.utilities.typing import LambdaContext

from common import users
from common.access import current_access
from common.app import create_app
from common.perms import all_edit

app, logger = create_app("personal")


@app.get("/me")
def me() -> dict[str, Any]:
    """로그인한 사용자의 프로필과 모듈 권한. 프론트는 이걸로 메뉴 노출·Host 여부를 정한다."""
    access = current_access(app)
    profile = access.profile
    perms = all_edit() if access.identity.is_host else users.get_perms(access.identity.sub)
    return {
        "sub": profile["sub"],
        "email": profile["email"],
        "name": profile["name"],
        "role": profile["role"],
        "isHost": access.identity.is_host,
        "perms": perms,
    }


@logger.inject_lambda_context
def lambda_handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    return app.resolve(event, context)
