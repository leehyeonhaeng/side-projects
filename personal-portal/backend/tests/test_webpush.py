"""Web Push 직접 구현 검증: 다른 구현(http_ece, 브라우저 쪽 복호화)으로 풀리는지, VAPID 서명이 맞는지"""

import base64
import json
import os

import http_ece
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

from common import webpush


def test_encrypt_decrypts_with_http_ece() -> None:
    ua = ec.generate_private_key(ec.SECP256R1())  # 브라우저 구독 키
    ua_pub = ua.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    auth = os.urandom(16)
    msg = json.dumps({"title": "A/S 배정", "body": "학교 · 용지 걸림", "url": "/company/x/services/y"}, ensure_ascii=False).encode()
    body = webpush.encrypt(msg, webpush.b64u(ua_pub), webpush.b64u(auth))
    assert http_ece.decrypt(body, private_key=ua, dh=None, auth_secret=auth, version="aes128gcm") == msg


def test_vapid_header_signature() -> None:
    key = ec.generate_private_key(ec.SECP256R1())
    v = webpush.Vapid(key, "https://example.com")
    header = v.header("https://fcm.googleapis.com/fcm/send/abc")
    token = header.split("t=")[1].split(",")[0]
    k = header.split("k=")[1]
    head, claims, sig = token.split(".")
    assert json.loads(webpush.b64u_decode(claims)) | {"exp": 0} == {"aud": "https://fcm.googleapis.com", "sub": "https://example.com", "exp": 0}
    raw = webpush.b64u_decode(sig)
    pub = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), webpush.b64u_decode(k))
    pub.verify(encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big")), f"{head}.{claims}".encode(), ec.ECDSA(hashes.SHA256()))
    assert len(webpush.b64u_decode(v.public_key)) == 65 and base64.urlsafe_b64decode(k + "==")[0] == 4
