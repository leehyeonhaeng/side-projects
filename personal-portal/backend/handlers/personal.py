from typing import Any

from aws_lambda_powertools.event_handler.exceptions import BadRequestError
from aws_lambda_powertools.utilities.typing import LambdaContext
from pydantic import BaseModel, ConfigDict, Field

from common import preferences, users
from common.access import current_access
from common.app import create_app
from common.http import parse_body
from common.perms import all_edit
from domains import events, exercise, meals, todos, weights

app, logger = create_app("personal")
# 모듈 권한은 공통 미들웨어가 경로로 판단한다 (todos→todo, events·event-series→calendar, meals·foods·meal-sets→health)
app.include_router(todos.router)
app.include_router(events.router)
app.include_router(meals.router)
app.include_router(weights.router)
app.include_router(exercise.router)


def me_view() -> dict[str, Any]:
    access = current_access(app)
    profile = users.get_profile(access.identity.sub) or access.profile
    perms = all_edit() if access.identity.is_host else users.get_perms(access.identity.sub)
    return {
        "sub": profile["sub"],
        "email": profile["email"],
        "name": profile["name"],
        "role": profile["role"],
        "isHost": access.identity.is_host,
        "perms": perms,
    }


class ProfilePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=50)


@app.get("/me")
def me() -> dict[str, Any]:
    """로그인한 사용자의 프로필과 모듈 권한. 프론트는 이걸로 메뉴 노출·Host 여부를 정한다."""
    return me_view()


@app.patch("/me")
def update_me() -> dict[str, Any]:
    body = parse_body(app, ProfilePatch)
    name = body.name.strip()
    if not name:
        raise BadRequestError("name is required")
    users.set_name(current_access(app).identity.sub, name)
    return me_view()


# ── 홈 레이아웃·설정 (모듈 권한과 무관, 본인 데이터만) ─────────

@app.get("/layout")
def get_layout() -> dict[str, Any]:
    return preferences.get_layout(current_access(app).identity.sub)


@app.put("/layout")
def put_layout() -> dict[str, Any]:
    return preferences.put_layout(current_access(app).identity.sub, parse_body(app, preferences.Layout))


@app.get("/settings")
def get_settings() -> dict[str, Any]:
    return preferences.get_settings(current_access(app).identity.sub).model_dump()


@app.patch("/settings")
def patch_settings() -> dict[str, Any]:
    patch = parse_body(app, preferences.SettingsPatch)
    return preferences.patch_settings(current_access(app).identity.sub, patch).model_dump()


@logger.inject_lambda_context
def lambda_handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    return app.resolve(event, context)
