"""행컴퍼니 데모 데이터 (COMPANY.md 10장)

실제 company Lambda 코드(handlers.company)를 로컬에서 호출해 데모 회사를 새로 만든다.
모든 거래가 C3 엔진을 거치므로 재고·기기·미수·선수·계좌 잔액이 서로 맞는다.

    $env:AWS_PROFILE="personal-portal"; aws sts get-caller-identity
    .venv\\Scripts\\python scripts\\seed_company_demo.py --table portal-dev

- 실행할 때마다 데모 회사가 하나 새로 생긴다 (기존 회사는 건드리지 않음)
- Host 계정으로 기록된다 (Host는 모든 회사의 관리자)
- 거래 날짜는 실행일 기준 지난 두 달 + 이번 달. 두 달 전은 마지막에 월 마감
- prod 테이블에는 실행하지 않는다
"""

import argparse
import json
import os
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@dataclass
class _Ctx:
    function_name: str = "seed"
    memory_limit_in_mb: int = 256
    invoked_function_arn: str = "arn:aws:lambda:ap-northeast-2:000000000000:function:seed"
    aws_request_id: str = "seed"


def _event(method: str, path: str, sub: str, body: Any = None) -> dict[str, Any]:
    return {
        "version": "2.0",
        "routeKey": f"{method} {path}",
        "rawPath": path,
        "rawQueryString": "",
        "headers": {"content-type": "application/json"},
        "requestContext": {
            "http": {"method": method, "path": path, "protocol": "HTTP/1.1", "sourceIp": "127.0.0.1", "userAgent": "seed"},
            "requestId": "seed",
            "routeKey": f"{method} {path}",
            "stage": "$default",
            "authorizer": {"jwt": {"claims": {"sub": sub, "cognito:groups": "[host]"}, "scopes": None}},
        },
        "body": json.dumps(body, ensure_ascii=False) if body is not None else None,
        "isBase64Encoded": False,
    }


TODAY = date.today()


def md(months_ago: int, day: int) -> str:
    """months_ago달 전의 day일 (이번 달은 오늘을 넘지 않게)"""
    y, m = TODAY.year, TODAY.month - months_ago
    while m <= 0:
        y, m = y - 1, m + 12
    if months_ago == 0:
        day = min(day, TODAY.day)
    return date(y, m, day).isoformat()


def ym(months_ago: int) -> str:
    return md(months_ago, 1)[:7]


def mlabel(months_ago: int) -> str:
    return f"{int(ym(months_ago)[5:])}월"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--table", required=True)
    ap.add_argument("--name", default="데모 프린텍")
    args = ap.parse_args()
    if "prod" in args.table:
        sys.exit("prod 테이블에는 데모 데이터를 넣지 않는다")
    os.environ["TABLE_NAME"] = args.table
    os.environ.setdefault("AWS_DEFAULT_REGION", "ap-northeast-2")

    from boto3.dynamodb.conditions import Attr

    from common.aws import table
    from handlers import company

    hosts = table().scan(FilterExpression=Attr("SK").eq("PROFILE") & Attr("role").eq("host"))["Items"]
    if len(hosts) != 1:
        sys.exit(f"Host 계정을 하나로 정할 수 없음: {len(hosts)}명")
    sub = hosts[0]["sub"]
    ctx = _Ctx()

    def api(method: str, path: str, body: Any = None) -> Any:
        res = company.lambda_handler(_event(method, f"/api/v1{path}", sub, body), ctx)
        out = json.loads(res["body"])
        if res["statusCode"] != 200:
            raise SystemExit(f"{method} {path} → {res['statusCode']} {out}")
        return out

    # ── 회사 ──
    cid = api("POST", "/company", {"name": args.name})["id"]
    c = f"/company/{cid}"
    api("PATCH", c, {
        "bizNo": "000-00-00000", "ceo": "홍길동", "address": "서울시 성동구 성수이로 00 (데모)", "phone": "02-555-0100", "fax": "02-555-0101",
        "email": "demo@example.com", "bizType": "도소매, 임대업", "bizItem": "사무기기, 복합기 임대", "bankAccount": "국민 000000-00-000000 데모프린텍",
        "vatDefault": "excluded", "assetPrefix": "DP",
    })

    # ── 계좌 ──
    kb = api("POST", f"{c}/accounts", {"name": "국민 주거래", "kind": "bank", "bank": "국민은행", "openingBalance": 20_000_000, "openingDate": md(2, 1)})["id"]
    ibk = api("POST", f"{c}/accounts", {"name": "기업 운영비", "kind": "bank", "bank": "기업은행", "openingBalance": 3_000_000, "openingDate": md(2, 1)})["id"]
    cash = api("POST", f"{c}/accounts", {"name": "현금 시재", "kind": "cash", "openingBalance": 300_000, "openingDate": md(2, 1)})["id"]
    card = api("POST", f"{c}/accounts", {"name": "법인카드", "kind": "card", "openingBalance": 0, "openingDate": md(2, 1)})["id"]

    # ── 거래처 ──
    def partner(name: str, kind: str = "customer", **kw: Any) -> str:
        return api("POST", f"{c}/partners", {"name": name, "kind": kind, **kw})["id"]

    school = partner("서울중앙초등학교", contactName="김행정 주무관", phone="02-555-0201", address="서울시 중구 (데모)", memo="교무실·행정실 2대. 매월 25일 전후 청구")
    clinic = partner("한빛정형외과의원", contactName="이원무 실장", phone="02-555-0202", mobile="010-0000-0202", memo="접수처 컬러 1대, 토너 자주 주문")
    law = partner("법무법인 정의", contactName="박사무장", phone="02-555-0203", memo="A3 출력 많음")
    tax = partner("미래세무회계", contactName="최세무사", phone="02-555-0204", memo="9월 말 계약 종료(기기 수거)")
    kids = partner("푸른하늘어린이집", contactName="정원장", phone="02-555-0205", memo="소모품만 구매")
    cafe = partner("강남 스터디카페", contactName="한사장", mobile="010-0000-0206", memo="선입금 고객")
    print_shop = partner("대성인쇄소", "both", contactName="오대표", phone="02-555-0207", memo="용지 사고팔고 함")
    dh = partner("(주)대한오피스솔루션", "supplier", contactName="윤과장", phone="02-555-0301", memo="복합기 도매. 월말 결제")
    ink = partner("잉크나라 유통", "supplier", contactName="서대리", phone="02-555-0302", memo="토너·드럼")
    paper = partner("한국용지", "supplier", contactName="장부장", phone="02-555-0303", memo="용지. 바로 결제")

    # ── 품목: 기기 모델 ──
    def item(name: str, tracking: str, **kw: Any) -> str:
        return api("POST", f"{c}/items", {"name": name, "tracking": tracking, **kw})["id"]

    d420 = item("신도리코 D420 컬러복합기", "asset", category="복합기", maker="신도리코", modelNo="D420", unit="대", rentPrice=120_000, cost=3_200_000, spec="A3 컬러 분당 30매")
    m400 = item("신도리코 M400 흑백복합기", "asset", category="복합기", maker="신도리코", modelNo="M400", unit="대", rentPrice=60_000, cost=1_500_000)
    c3530 = item("캐논 iR-ADV C3530 컬러복합기", "asset", category="복합기", maker="캐논", modelNo="C3530", unit="대", rentPrice=150_000, cost=4_100_000)
    m404 = item("HP 레이저젯 M404 프린터", "asset", category="프린터", maker="HP", modelNo="M404dn", unit="대", rentPrice=30_000, cost=420_000)

    # ── 품목: 소모품 ──
    def stock(name: str, opening: float, price: int, cost: int, min_stock: float, compat: list[str], category: str, unit: str = "개") -> str:
        return item(name, "stock", openingQty=opening, price=price, cost=cost, minStock=min_stock, compatibleWith=compat, category=category, unit=unit)

    t_k = stock("D420 토너 검정", 12, 85_000, 45_000, 5, [d420], "토너")
    t_c = stock("D420 토너 파랑", 4, 120_000, 65_000, 3, [d420], "토너")
    t_m = stock("D420 토너 빨강", 4, 120_000, 65_000, 3, [d420], "토너")
    t_y = stock("D420 토너 노랑", 3, 120_000, 65_000, 3, [d420], "토너")
    drum = stock("D420 드럼 유닛", 2, 230_000, 140_000, 1, [d420], "드럼")
    m400_t = stock("M400 토너", 10, 60_000, 30_000, 4, [m400], "토너")
    c3530_k = stock("C3530 토너 검정", 3, 95_000, 52_000, 2, [c3530], "토너")
    hp_t = stock("HP 26A 토너", 6, 110_000, 70_000, 3, [m404], "토너")
    a4 = stock("A4 복사용지 80g (박스)", 40, 28_000, 21_000, 15, [], "용지", "박스")
    a3 = stock("A3 복사용지 80g (박스)", 8, 42_000, 32_000, 5, [], "용지", "박스")
    staple = stock("스테이플 카트리지", 15, 15_000, 8_000, 5, [d420, c3530], "부품")

    # ── 기기 기초 등록 (이미 갖고 있던 기기) ──
    def register(item_id: str, serials: list[str], cost: int, location: str = "본사 창고") -> list[str]:
        r = api("POST", f"{c}/assets", {"itemId": item_id, "count": len(serials), "serials": serials, "acquiredAt": md(6, 1), "cost": cost, "location": location})
        return [a["id"] for a in r["assets"]]

    d420s = register(d420, ["SD420-1001", "SD420-1002", "SD420-1003"], 3_000_000)
    m400s = register(m400, ["SM400-2001", "SM400-2002", "SM400-2003"], 1_400_000)
    c3530s = register(c3530, ["CN3530-301"], 4_000_000)
    m404s = register(m404, ["HP404-401", "HP404-402", "HP404-403"], 400_000)

    def txn(body: dict[str, Any]) -> dict[str, Any]:
        return api("POST", f"{c}/txns", body)

    def line(name: str = "", item_id: str | None = None, qty: float = 1, price: int = 0, vat: str = "excluded", **kw: Any) -> dict[str, Any]:
        return {**({"itemId": item_id} if item_id else {"name": name}), "qty": qty, "unitPrice": price, "vatMode": vat, **kw}

    def rent(pid: str, when: str, label: str, amount: int, *extra: dict[str, Any]) -> dict[str, Any]:
        return txn({"type": "charge", "date": when, "partnerId": pid, "lines": [line(f"{label} 임대료", price=amount), *extra]})["txn"]

    # ════ 두 달 전 ════
    M2 = 2
    # 새 기기 매입: D420 2대 (기기 자동 등록), 절반만 지급
    buy = txn({"type": "purchase", "date": md(M2, 3), "partnerId": dh, "lines": [line(item_id=d420, qty=2, price=3_200_000)], "memo": "신규 계약용"})
    new_d420s = [a["id"] for a in buy["createdAssets"]]
    txn({"type": "payment", "date": md(M2, 5), "partnerId": dh, "accountId": kb, "amount": 3_520_000, "memo": "계약금"})
    # 토너 매입 바로 결제
    txn({"type": "purchase", "date": md(M2, 4), "partnerId": ink, "lines": [line(item_id=t_k, qty=10, price=45_000), line(item_id=drum, qty=2, price=140_000)], "payNow": {"accountId": kb}})
    txn({"type": "purchase", "date": md(M2, 6), "partnerId": paper, "lines": [line(item_id=a4, qty=30, price=21_000)], "payNow": {"accountId": ibk}})

    # 임대 출고 (설치비 청구 포함 / 없음)
    txn({"type": "rental_out", "date": md(M2, 8), "partnerId": school, "assetIds": [new_d420s[0], m400s[0]], "lines": [line("설치비", price=50_000)], "memo": "교무실 D420, 행정실 M400"})
    txn({"type": "rental_out", "date": md(M2, 10), "partnerId": clinic, "assetIds": [new_d420s[1]], "lines": [line("설치비", price=50_000)]})
    txn({"type": "rental_out", "date": md(M2, 12), "partnerId": law, "assetIds": [c3530s[0], m404s[0]]})
    txn({"type": "rental_out", "date": md(M2, 14), "partnerId": tax, "assetIds": [m400s[1]]})
    txn({"type": "rental_out", "date": md(M2, 15), "partnerId": cafe, "assetIds": [d420s[0]], "lines": [line("설치비", price=30_000)]})

    # 소모품 판매
    s1 = txn({"type": "sale", "date": md(M2, 18), "partnerId": clinic, "lines": [line(item_id=t_k, qty=2, price=85_000, vat="included"), line(item_id=a4, qty=5, price=28_000)]})["txn"]
    txn({"type": "sale", "date": md(M2, 20), "partnerId": kids, "lines": [line(item_id=m400_t, qty=1, price=60_000), line(item_id=a4, qty=3, price=28_000)], "payNow": {"accountId": cash}})
    txn({"type": "sale", "date": md(M2, 21), "partnerId": print_shop, "lines": [line(item_id=a3, qty=4, price=42_000)]})

    # 월 임대료 청구 (25일)
    rent(school, md(M2, 25), mlabel(M2), 180_000)
    rent(clinic, md(M2, 25), mlabel(M2), 120_000)
    rent(law, md(M2, 25), mlabel(M2), 180_000, line("초과 매수 컬러 1,200매", qty=1200, price=80))
    rent(tax, md(M2, 25), mlabel(M2), 60_000)
    rent(cafe, md(M2, 25), mlabel(M2), 120_000)

    # 입금: 자동 배분(오래된 것부터), 선입금(남는 돈 → 선수금)
    txn({"type": "receipt", "date": md(M2, 27), "partnerId": school, "accountId": kb, "amount": 253_000})
    txn({"type": "receipt", "date": md(M2, 28), "partnerId": clinic, "accountId": kb, "amount": 170_000, "allocations": [{"txnId": s1["id"], "date": s1["date"], "amount": 170_000}], "memo": "토너값 먼저"})
    txn({"type": "receipt", "date": md(M2, 28), "partnerId": cafe, "accountId": kb, "amount": 500_000, "memo": "3개월치 선입금"})
    txn({"type": "receipt", "date": md(M2, 28), "partnerId": tax, "accountId": ibk, "amount": 66_000})

    # 경비
    for day, cat, amt, memo, acct in [(7, "유류비", 65_000, "배송 차량 주유", card), (11, "식대", 48_000, "설치팀 점심", card), (16, "운반비", 35_000, "퀵 배송", cash), (26, "임차료", 1_200_000, "창고 월세", kb), (27, "통신비", 88_000, "인터넷·전화", ibk)]:
        txn({"type": "expense", "date": md(M2, day), "accountId": acct, "amount": amt, "category": cat, "memo": memo})

    # ════ 한 달 전 ════
    M1 = 1
    txn({"type": "payment", "date": md(M1, 2), "partnerId": dh, "accountId": kb, "amount": 3_520_000, "memo": "잔금"})
    txn({"type": "purchase", "date": md(M1, 3), "partnerId": ink, "lines": [line(item_id=t_c, qty=3, price=65_000), line(item_id=t_m, qty=3, price=65_000), line(item_id=hp_t, qty=4, price=70_000)]})
    txn({"type": "rental_out", "date": md(M1, 5), "partnerId": print_shop, "assetIds": [m404s[1]]})

    s2 = txn({"type": "sale", "date": md(M1, 8), "partnerId": law, "lines": [line(item_id=c3530_k, qty=2, price=95_000), line(item_id=a3, qty=2, price=42_000)]})["txn"]
    txn({"type": "sale", "date": md(M1, 10), "partnerId": clinic, "lines": [line(item_id=t_c, qty=1, price=120_000, vat="included"), line(item_id=t_y, qty=1, price=120_000, vat="included")]})
    txn({"type": "sale", "date": md(M1, 12), "partnerId": school, "lines": [line(item_id=a4, qty=10, price=28_000), line(item_id=staple, qty=2, price=15_000)]})
    txn({"type": "sale", "date": md(M1, 14), "partnerId": kids, "lines": [line(item_id=a4, qty=4, price=28_000)], "payNow": {"accountId": cash}})
    # 용지 사주기 (대성인쇄소: 매입처로도 거래)
    txn({"type": "purchase", "date": md(M1, 15), "partnerId": print_shop, "lines": [line(item_id=a3, qty=5, price=30_000)]})
    # 재고 조정: 파손·실사
    txn({"type": "adjust", "date": md(M1, 16), "lines": [{"itemId": t_k, "qty": -1, "memo": "배송 중 파손"}, {"itemId": a4, "qty": 2, "memo": "실사 결과 남음"}]})

    m = mlabel(M1)
    rent(school, md(M1, 25), m, 180_000)
    rent(clinic, md(M1, 25), m, 120_000)
    rent(law, md(M1, 25), m, 180_000, line("초과 매수 컬러 2,050매", qty=2050, price=80))
    rent(tax, md(M1, 25), m, 60_000)
    rent(cafe, md(M1, 25), m, 120_000)
    rent(print_shop, md(M1, 25), m, 30_000)
    # 중복 입력 → 취소 예시
    dup = rent(school, md(M1, 25), m, 180_000)
    api("POST", f"{c}/txns/{dup['date']}/{dup['id']}/cancel", {"reason": "중복 입력"})

    # 계약 종료: 세무회계 기기 수거
    txn({"type": "rental_return", "date": md(M1, 28), "partnerId": tax, "assetIds": [m400s[1]], "returnLocation": "본사 창고", "memo": "계약 종료"})

    txn({"type": "receipt", "date": md(M1, 27), "partnerId": school, "accountId": kb, "amount": 296_000})
    txn({"type": "receipt", "date": md(M1, 28), "partnerId": law, "accountId": kb, "amount": 400_000, "memo": "일부 입금"})
    txn({"type": "receipt", "date": md(M1, 28), "partnerId": print_shop, "accountId": ibk, "amount": 100_000})
    txn({"type": "payment", "date": md(M1, 28), "partnerId": ink, "accountId": kb, "amount": 400_000, "memo": "토너 대금 일부"})
    txn({"type": "payment", "date": md(M1, 28), "partnerId": print_shop, "accountId": ibk, "amount": 165_000})

    for day, cat, amt, memo, acct in [(4, "유류비", 72_000, "배송 차량 주유", card), (9, "수리비", 150_000, "M400 정착기 부품", card), (18, "소모품비", 23_000, "사무용품", cash), (26, "임차료", 1_200_000, "창고 월세", kb), (27, "통신비", 88_000, "인터넷·전화", ibk), (28, "인건비", 2_800_000, "현장 기사 급여", kb)]:
        txn({"type": "expense", "date": md(M1, day), "accountId": acct, "amount": amt, "category": cat, "memo": memo})

    # 수리 중 기기
    api("PATCH", f"{c}/assets/{m400s[2]}", {"status": "repair", "memo": "급지 롤러 교체 대기"})

    # ════ 이번 달 ════
    txn({"type": "sale", "date": md(0, 2), "partnerId": cafe, "lines": [line(item_id=a4, qty=2, price=28_000)]})  # 선수금에서 자동 차감
    txn({"type": "sale", "date": md(0, 3), "partnerId": clinic, "lines": [line(item_id=t_k, qty=2, price=85_000, vat="included")]})
    txn({"type": "expense", "date": md(0, 3), "accountId": card, "amount": 58_000, "category": "유류비", "memo": "배송 차량 주유"})
    txn({"type": "purchase", "date": md(0, 4), "partnerId": paper, "lines": [line(item_id=a4, qty=20, price=21_000), line(item_id=a3, qty=5, price=32_000)], "payNow": {"accountId": ibk}})
    txn({"type": "rental_out", "date": md(0, 5), "partnerId": kids, "assetIds": [m400s[1]], "lines": [line("설치비", price=30_000)], "memo": "세무회계에서 수거한 기기 재출고"})

    # 두 달 전은 마감
    api("POST", f"{c}/closes", {"month": ym(M2)})
    print(f"완료: {args.name} ({cid}), 기기 자동 등록 {len(new_d420s)}대, 월 마감 {ym(M2)}")


if __name__ == "__main__":
    main()
