"""AWS 클라이언트. 콜드 스타트 이후 재사용하고, 테스트에서 moto가 먼저 켜지도록 지연 생성한다."""

import os
from functools import cache
from typing import Any

import boto3
from botocore.config import Config


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


@cache
def s3() -> Any:
    # 서명 URL: 리전 주소 + SigV4 (새 버킷도 리다이렉트 없이 열리게)
    return boto3.client("s3", config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}))


def reset_clients() -> None:
    for fn in (dynamodb, table, cognito, sns, s3):
        fn.cache_clear()
