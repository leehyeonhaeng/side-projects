"""요청 본문·쿼리 검증 공통 헬퍼 (Pydantic)."""

from typing import TypeVar

from aws_lambda_powertools.event_handler.api_gateway import BaseRouter
from aws_lambda_powertools.event_handler.exceptions import BadRequestError
from pydantic import BaseModel, ValidationError

T = TypeVar("T", bound=BaseModel)


def parse_body(resolver: BaseRouter, model: type[T]) -> T:
    try:
        return model.model_validate(resolver.current_event.json_body or {})
    except (ValidationError, ValueError) as exc:
        raise BadRequestError(_message(exc)) from exc


def parse_query(resolver: BaseRouter, model: type[T]) -> T:
    params = resolver.current_event.query_string_parameters or {}
    try:
        return model.model_validate(params)
    except ValidationError as exc:
        raise BadRequestError(_message(exc)) from exc


def _message(exc: Exception) -> str:
    if isinstance(exc, ValidationError):
        return "; ".join(f"{'.'.join(map(str, e['loc'])) or 'body'}: {e['msg']}" for e in exc.errors())
    return str(exc)
