"""Web Push 보내기 (RFC 8291 메시지 암호화 aes128gcm + RFC 8292 VAPID). 외부 라이브러리는 cryptography만.

pywebpush는 의존성(http-ece, py-vapid)이 소스 배포뿐이라 Lambda(arm64) 레이어에 휠로 넣을 수 없어서 직접 구현했다.
비밀 키: SSM Parameter Store SecureString(PEM, 환경 변수 VAPID_PARAM)에서 콜드 스타트 때 한 번 읽는다.
"""

import base64
import json
import os
import struct
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from functools import cache
from typing import Any
from urllib.parse import urlsplit

from cryptography.hazmat.primitives import hashes, hmac, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def b64u_decode(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _hmac(key: bytes, data: bytes) -> bytes:
    h = hmac.HMAC(key, hashes.SHA256())
    h.update(data)
    return h.finalize()


def _raw_public(key: ec.EllipticCurvePublicKey) -> bytes:
    return key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)


def encrypt(payload: bytes, p256dh: str, auth: str, salt: bytes | None = None, server_key: ec.EllipticCurvePrivateKey | None = None) -> bytes:
    """RFC 8291: 받는 쪽 공개 키(p256dh)·인증 비밀(auth)로 메시지를 암호화한 본문 (헤더 + 암호문, 레코드 하나)"""
    ua_public = b64u_decode(p256dh)
    auth_secret = b64u_decode(auth)
    as_private = server_key or ec.generate_private_key(ec.SECP256R1())
    as_public = _raw_public(as_private.public_key())
    ecdh = as_private.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_public))
    prk_key = _hmac(auth_secret, ecdh)
    ikm = _hmac(prk_key, b"WebPush: info\x00" + ua_public + as_public + b"\x01")
    salt = salt or os.urandom(16)
    prk = _hmac(salt, ikm)
    cek = _hmac(prk, b"Content-Encoding: aes128gcm\x00\x01")[:16]
    nonce = _hmac(prk, b"Content-Encoding: nonce\x00\x01")[:12]
    record = AESGCM(cek).encrypt(nonce, payload + b"\x02", None)  # 0x02 = 마지막 레코드 구분자
    rs = 4096
    return salt + struct.pack("!IB", rs, len(as_public)) + as_public + record


@dataclass(frozen=True)
class Vapid:
    key: ec.EllipticCurvePrivateKey
    subject: str  # mailto: 또는 https: (보내는 쪽 연락처)

    @property
    def public_key(self) -> str:
        """브라우저 구독(applicationServerKey)에 쓰는 공개 키 (base64url, 65바이트)"""
        return b64u(_raw_public(self.key.public_key()))

    def header(self, endpoint: str, ttl: int = 12 * 3600) -> str:
        u = urlsplit(endpoint)
        claims = {"aud": f"{u.scheme}://{u.netloc}", "exp": int(time.time()) + ttl, "sub": self.subject}
        signing = f"{b64u(json.dumps({'typ': 'JWT', 'alg': 'ES256'}).encode())}.{b64u(json.dumps(claims).encode())}"
        r, s = decode_dss_signature(self.key.sign(signing.encode(), ec.ECDSA(hashes.SHA256())))
        token = f"{signing}.{b64u(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))}"
        return f"vapid t={token}, k={self.public_key}"


@cache
def vapid() -> Vapid | None:
    """SSM의 비밀 키. 설정이 없으면(테스트·로컬) None → 푸시는 건너뛴다"""
    name = os.environ.get("VAPID_PARAM")
    if not name:
        return None
    import boto3  # noqa: PLC0415

    pem = boto3.client("ssm").get_parameter(Name=name, WithDecryption=True)["Parameter"]["Value"]
    key = serialization.load_pem_private_key(pem.encode(), password=None)
    assert isinstance(key, ec.EllipticCurvePrivateKey)
    return Vapid(key, os.environ.get("PUSH_SUBJECT", "mailto:noreply@example.com"))


def send(sub: dict[str, Any], message: dict[str, Any], v: Vapid, timeout: float = 5) -> int:
    """구독 하나에 보내고 HTTP 상태를 돌려준다. 404·410이면 만료된 구독(지워야 함)"""
    body = encrypt(json.dumps(message, ensure_ascii=False).encode(), sub["keys"]["p256dh"], sub["keys"]["auth"])
    req = urllib.request.Request(
        sub["endpoint"],
        data=body,
        method="POST",
        headers={"Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", "TTL": str(12 * 3600), "Urgency": "normal", "Authorization": v.header(sub["endpoint"])},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:  # noqa: S310 (구독 주소는 브라우저 푸시 서비스)
            return int(res.status)
    except urllib.error.HTTPError as exc:
        return int(exc.code)
