"""AWS 클라이언트. 콜드 스타트 이후 재사용하고, 테스트에서 moto가 먼저 켜지도록 지연 생성한다."""

import os
from functools import cache
from typing import Any

import boto3


@cache
def dynamodb() -> Any:
    return boto3.resource("dynamodb")


@cache
def table() -> Any:
    return dynamodb().Table(os.environ["TABLE_NAME"])


@cache
def cognito() -> Any:
    return boto3.client("cognito-idp")


@cache
def sns() -> Any:
    return boto3.client("sns")


def reset_clients() -> None:
    for fn in (dynamodb, table, cognito, sns):
        fn.cache_clear()
