"""사용자 프로필·권한 저장소 (DESIGN.md 7장: USER#<sub> / PROFILE, PERM#<module>)."""

from datetime import UTC, datetime
from typing import Any

from boto3.dynamodb.conditions import Key

from common.aws import dynamodb, table
from common.perms import Level, Module, Role, Status


def user_pk(sub: str) -> str:
    return f"USER#{sub}"


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds")


def _status_keys(status: Status, created_at: str) -> dict[str, str]:
    return {"GSI1PK": f"STATUS#{status}", "GSI1SK": created_at}


def create_profile(sub: str, email: str, name: str, signup_note: str, status: Status, role: Role) -> dict[str, Any]:
    created_at = now_iso()
    item = {
        "PK": user_pk(sub),
        "SK": "PROFILE",
        "sub": sub,
        "email": email,
        "name": name,
        "signupNote": signup_note,
        "status": str(status),
        "role": str(role),
        "createdAt": created_at,
        **_status_keys(status, created_at),
    }
    table().put_item(Item=item)
    return item


def get_profile(sub: str) -> dict[str, Any] | None:
    return table().get_item(Key={"PK": user_pk(sub), "SK": "PROFILE"}).get("Item")


def set_status(sub: str, status: Status) -> None:
    profile = get_profile(sub)
    if profile is None:
        raise LookupError(sub)
    table().update_item(
        Key={"PK": user_pk(sub), "SK": "PROFILE"},
        UpdateExpression="SET #s = :s, GSI1PK = :pk",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":s": str(status), ":pk": f"STATUS#{status}"},
    )


def list_by_status(status: Status) -> list[dict[str, Any]]:
    res = table().query(
        IndexName="GSI1",
        KeyConditionExpression=Key("GSI1PK").eq(f"STATUS#{status}"),
        ScanIndexForward=False,
    )
    return list(res["Items"])


def get_perms(sub: str) -> dict[Module, Level]:
    res = table().query(KeyConditionExpression=Key("PK").eq(user_pk(sub)) & Key("SK").begins_with("PERM#"))
    perms = {m: Level.NONE for m in Module}
    for item in res["Items"]:
        module = item["SK"].removeprefix("PERM#")
        if module in Module.__members__.values():
            perms[Module(module)] = Level(item["level"])
    return perms


def set_perms(sub: str, perms: dict[Module, Level]) -> None:
    with table().batch_writer() as batch:
        for module, level in perms.items():
            batch.put_item(Item={"PK": user_pk(sub), "SK": f"PERM#{module}", "level": str(level)})


def load_access(sub: str, module: Module | None) -> tuple[dict[str, Any] | None, Level]:
    """권한 미들웨어용: PROFILE과 (필요하면) 해당 모듈 PERM을 한 번에 읽는다."""
    keys = [{"PK": user_pk(sub), "SK": "PROFILE"}]
    if module is not None:
        keys.append({"PK": user_pk(sub), "SK": f"PERM#{module}"})
    name = table().name
    res = dynamodb().batch_get_item(RequestItems={name: {"Keys": keys}})
    profile: dict[str, Any] | None = None
    level = Level.NONE
    for item in res["Responses"].get(name, []):
        if item["SK"] == "PROFILE":
            profile = item
        else:
            level = Level(item["level"])
    return profile, level


def delete_user_data(sub: str) -> int:
    """사용자의 개인 데이터(USER#<sub>)와 공유 리소스 멤버십(GSI1PK=USER#<sub>)을 모두 지운다."""
    keys: list[dict[str, str]] = []
    for kwargs in (
        {"KeyConditionExpression": Key("PK").eq(user_pk(sub))},
        {"IndexName": "GSI1", "KeyConditionExpression": Key("GSI1PK").eq(user_pk(sub))},
    ):
        start: dict[str, Any] | None = None
        while True:
            page = table().query(**kwargs, **({"ExclusiveStartKey": start} if start else {}))
            keys.extend({"PK": i["PK"], "SK": i["SK"]} for i in page["Items"])
            start = page.get("LastEvaluatedKey")
            if not start:
                break
    unique = {(k["PK"], k["SK"]): k for k in keys}.values()
    with table().batch_writer() as batch:
        for key in unique:
            batch.delete_item(Key=key)
    return len(unique)
