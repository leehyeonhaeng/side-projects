"""체중 (DESIGN.md 6.4, 7장: USER#<sub> / WEIGHT#<date>). 하루 한 기록, 같은 날 다시 저장하면 덮어쓴다."""

from datetime import date
from typing import Annotated, Any

from aws_lambda_powertools.event_handler.api_gateway import Router
from aws_lambda_powertools.event_handler.exceptions import BadRequestError, NotFoundError
from boto3.dynamodb.conditions import Key
from pydantic import BaseModel, ConfigDict, Field

from common.access import current_sub
from common.aws import table
from common.http import parse_body
from common.serialize import to_dynamo, to_plain
from common.users import now_iso, user_pk

router = Router()


class WeightBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    weight: Annotated[float, Field(ge=20, le=300)]
    # 인바디 수치는 선택 (DESIGN.md 6.4)
    bodyFat: Annotated[float, Field(ge=1, le=70)] | None = None  # 체지방률 %
    muscle: Annotated[float, Field(ge=5, le=100)] | None = None  # 골격근량 kg
    memo: str = Field(default="", max_length=500)


def _parse_day(raw: str) -> date:
    try:
        return date.fromisoformat(raw)
    except ValueError as exc:
        raise BadRequestError("date must be YYYY-MM-DD") from exc


def view(item: dict[str, Any]) -> dict[str, Any]:
    return to_plain({k: item[k] for k in ("date", "weight", "bodyFat", "muscle", "memo") if k in item})


def list_weights(sub: str, frm: date | None, to: date | None) -> list[dict[str, Any]]:
    if frm and to:
        cond = Key("PK").eq(user_pk(sub)) & Key("SK").between(f"WEIGHT#{frm}", f"WEIGHT#{to}")
    else:
        cond = Key("PK").eq(user_pk(sub)) & Key("SK").begins_with("WEIGHT#")
    items: list[dict[str, Any]] = []
    start: dict[str, Any] | None = None
    while True:
        page = table().query(KeyConditionExpression=cond, **({"ExclusiveStartKey": start} if start else {}))
        items.extend(page["Items"])
        start = page.get("LastEvaluatedKey")
        if not start:
            return [view(i) for i in items]  # SK가 날짜라 오래된 순


@router.get("/weights")
def list_route() -> dict[str, Any]:
    """?from&to 없으면 전체 (그래프 '전체' 기간)"""
    q = router.current_event.get_query_string_value
    frm, to = q("from"), q("to")
    if bool(frm) != bool(to):
        raise BadRequestError("give both from and to, or neither")
    return {"weights": list_weights(current_sub(router), _parse_day(frm) if frm else None, _parse_day(to) if to else None)}


@router.put("/weights/<day>")
def put_route(day: str) -> dict[str, Any]:
    d = _parse_day(day)
    body = parse_body(router, WeightBody).model_dump(exclude_none=True)
    item = {"PK": user_pk(current_sub(router)), "SK": f"WEIGHT#{d}", "date": d.isoformat(), **body, "updatedAt": now_iso()}
    table().put_item(Item=to_dynamo(item))
    return view(item)


@router.delete("/weights/<day>")
def delete_route(day: str) -> dict[str, Any]:
    d = _parse_day(day)
    key = {"PK": user_pk(current_sub(router)), "SK": f"WEIGHT#{d}"}
    if "Item" not in table().get_item(Key=key):
        raise NotFoundError("no record on that date")
    table().delete_item(Key=key)
    return {"ok": True}
