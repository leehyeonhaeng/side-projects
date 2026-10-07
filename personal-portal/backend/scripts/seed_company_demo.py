"""행컴퍼니 데모 데이터 (COMPANY.md 10장, C7)

실제 company Lambda 코드(handlers.company)를 로컬에서 Host로 호출해 데모 회사를 만든다.
모든 값이 거래 엔진·계약·청구·문서를 거치므로 재고·기기·미수·선수·계좌·청구한 달이 서로 맞는다.
실행일 기준 4달 전부터 오늘까지를 날짜 순서대로 입력한다 (검침 → 청구 → 입금 순서가 실제처럼).

    $env:AWS_PROFILE="personal-portal"; aws sts get-caller-identity
    .venv\\Scripts\\python scripts\\seed_company_demo.py --table portal-dev --bucket portal-dev-docs-lhhportal [--reset]

- --reset: 이름이 --name(기본 "데모 프린텍")과 같은 회사를 먼저 지운다 (회사 파티션·초대·문서 파일). 다른 회사는 건드리지 않음
- 문서 PDF는 --bucket에 올라간다. 푸시 키를 주지 않으므로 폰 알림은 보내지 않고 앱 안 알림만 남긴다
- prod 테이블에는 실행하지 않는다
"""

import argparse
import json
import os
import random
import sys
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@dataclass
class _Ctx:
    function_name: str = "seed"
    memory_limit_in_mb: int = 512
    invoked_function_arn: str = "arn:aws:lambda:ap-northeast-2:000000000000:function:seed"
    aws_request_id: str = "seed"


def _event(method: str, path: str, sub: str, body: Any = None) -> dict[str, Any]:
    path, _, qs = path.partition("?")
    return {
        "version": "2.0",
        "routeKey": f"{method} {path}",
        "rawPath": path,
        "rawQueryString": qs,
        "queryStringParameters": dict(kv.split("=", 1) for kv in qs.split("&")) if qs else None,
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
    """months_ago달 전의 day일 (그 달 말일·오늘을 넘지 않게)"""
    y, m = TODAY.year, TODAY.month - months_ago
    while m <= 0:
        y, m = y - 1, m + 12
    last = (date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1)).day
    return min(date(y, m, min(day, last)), TODAY).isoformat()


def ym(months_ago: int) -> str:
    return md(months_ago, 1)[:7]


def reset(bucket: str, name: str) -> None:
    """같은 이름의 데모 회사 지우기: 회사 파티션 전체 + 초대(별도 파티션) + 문서·직인·임시 파일(모든 버전)"""
    import boto3
    from boto3.dynamodb.conditions import Key

    from common.aws import table

    if "데모" not in name:
        sys.exit("--reset은 이름에 '데모'가 들어간 회사만 지운다")
    companies = [c for c in table().query(IndexName="GSI1", KeyConditionExpression=Key("GSI1PK").eq("COMPANIES"))["Items"] if c.get("name") == name]
    s3 = boto3.client("s3")
    for c in companies:
        cid = c["id"]
        items, kw = [], {"KeyConditionExpression": Key("PK").eq(f"COMPANY#{cid}")}
        while True:
            r = table().query(**kw)
            items += r["Items"]
            if "LastEvaluatedKey" not in r:
                break
            kw["ExclusiveStartKey"] = r["LastEvaluatedKey"]
        invites = table().query(IndexName="GSI1", KeyConditionExpression=Key("GSI1PK").eq(f"COMPANY#{cid}") & Key("GSI1SK").begins_with("INVITE#"))["Items"]
        with table().batch_writer() as batch:
            for i in items + invites:
                batch.delete_item(Key={"PK": i["PK"], "SK": i["SK"]})
        files = 0
        for prefix in (f"company/{cid}/", f"tmp/{cid}/"):
            for page in s3.get_paginator("list_object_versions").paginate(Bucket=bucket, Prefix=prefix):
                objs = [{"Key": v["Key"], "VersionId": v["VersionId"]} for v in page.get("Versions", []) + page.get("DeleteMarkers", [])]
                if objs:
                    s3.delete_objects(Bucket=bucket, Delete={"Objects": objs})
                    files += len(objs)
        print(f"지움: {name} ({cid}) 항목 {len(items)} · 초대 {len(invites)} · 파일 {files}")


def main() -> None:  # noqa: PLR0915 (날짜 순서대로 쭉 입력하는 각본)
    ap = argparse.ArgumentParser()
    ap.add_argument("--table", required=True)
    ap.add_argument("--bucket", required=True)
    ap.add_argument("--name", default="데모 프린텍")
    ap.add_argument("--reset", action="store_true")
    args = ap.parse_args()
    if "prod" in args.table or "prod" in args.bucket:
        sys.exit("prod에는 데모 데이터를 넣지 않는다")
    os.environ["TABLE_NAME"] = args.table
    os.environ["DOCS_BUCKET"] = args.bucket
    os.environ.setdefault("AWS_DEFAULT_REGION", "ap-northeast-2")
    os.environ.pop("VAPID_PARAM", None)

    from boto3.dynamodb.conditions import Attr

    from common.aws import table
    from domains import company_notify
    from handlers import company

    if args.reset:
        reset(args.bucket, args.name)

    hosts = table().scan(FilterExpression=Attr("SK").eq("PROFILE") & Attr("role").eq("host"))["Items"]
    if len(hosts) != 1:
        sys.exit(f"Host 계정을 하나로 정할 수 없음: {len(hosts)}명")
    sub = hosts[0]["sub"]
    ctx = _Ctx()
    rnd = random.Random(20261007)
    calls = [0]

    def api(method: str, path: str, body: Any = None) -> Any:
        calls[0] += 1
        res = company.lambda_handler(_event(method, f"/api/v1{path}", sub, body), ctx)
        out = json.loads(res["body"])
        if res["statusCode"] != 200:
            raise SystemExit(f"{method} {path} → {res['statusCode']} {out}")
        return out

    # ── 회사·계좌 ──
    cid = api("POST", "/company", {"name": args.name})["id"]
    c = f"/company/{cid}"
    api("PATCH", c, {
        "bizNo": "000-00-00000", "ceo": "홍길동", "address": "서울시 성동구 성수이로 00 (데모)", "phone": "02-555-0100", "fax": "02-555-0101",
        "email": "demo@example.com", "bizType": "도소매, 임대업", "bizItem": "사무기기, 복합기 임대", "bankAccount": "국민 000000-00-000000 데모프린텍",
        "vatDefault": "excluded", "assetPrefix": "DP", "overdueDays": 30,
    })
    start = md(4, 1)
    kb = api("POST", f"{c}/accounts", {"name": "국민 주거래", "kind": "bank", "bank": "국민은행", "openingBalance": 40_000_000, "openingDate": start})["id"]
    ibk = api("POST", f"{c}/accounts", {"name": "기업 운영비", "kind": "bank", "bank": "기업은행", "openingBalance": 5_000_000, "openingDate": start})["id"]
    cash = api("POST", f"{c}/accounts", {"name": "현금 시재", "kind": "cash", "openingBalance": 500_000, "openingDate": start})["id"]
    card = api("POST", f"{c}/accounts", {"name": "법인카드", "kind": "card", "openingBalance": 0, "openingDate": start})["id"]

    # ── 거래처 (학교·병원·법률·세무·관공서·학원·건설·매입처) ──
    def partner(name: str, kind: str = "customer", **kw: Any) -> str:
        return api("POST", f"{c}/partners", {"name": name, "kind": kind, **kw})["id"]

    P = {
        "school": partner("서울중앙초등학교", contactName="김행정 주무관", phone="02-555-0201", address="서울시 중구 (데모)", memo="교무실 컬러 1대, 행정실 흑백 2대"),
        "clinic": partner("한빛정형외과의원", contactName="이원무 실장", phone="02-555-0202", mobile="010-0000-0202", memo="접수처 컬러. 토너 자주 주문"),
        "law": partner("법무법인 정의", contactName="박사무장", phone="02-555-0203", memo="A3 출력 많음. 입금 늦음 → 독촉"),
        "tax": partner("미래세무회계", contactName="최세무사", phone="02-555-0204", memo="계약 종료"),
        "kids": partner("푸른하늘어린이집", contactName="정원장", phone="02-555-0205"),
        "cafe": partner("강남 스터디카페", contactName="한사장", mobile="010-0000-0206", memo="선입금 고객"),
        "office": partner("성동구청 민원실", contactName="오주무관", phone="02-555-0207", memo="관공서 단가 적용. 계약 갱신 확인 필요"),
        "math": partner("해법수학학원", contactName="윤원장", phone="02-555-0208"),
        "eng": partner("대치 영어학원", contactName="서실장", phone="02-555-0209"),
        "med": partner("새봄내과의원", contactName="장간호사", phone="02-555-0210"),
        "build": partner("동부건설 현장사무소", contactName="임소장", mobile="010-0000-0211", memo="도면 출력 (플로터). 12월 철수"),
        "print": partner("대성인쇄소", "both", contactName="오대표", phone="02-555-0212", memo="용지 사고팔고 함"),
        "dh": partner("(주)대한오피스솔루션", "supplier", contactName="윤과장", phone="02-555-0301", memo="복합기 도매"),
        "ink": partner("잉크나라 유통", "supplier", contactName="서대리", phone="02-555-0302", memo="토너·잉크·드럼·부품"),
        "paper": partner("한국용지", "supplier", contactName="장부장", phone="02-555-0303", memo="용지·라벨지. 바로 결제"),
    }

    # ── 품목 ──
    def item(name: str, tracking: str, **kw: Any) -> str:
        return api("POST", f"{c}/items", {"name": name, "tracking": tracking, **kw})["id"]

    M = {
        "d420": item("신도리코 D420 컬러복합기", "asset", category="복합기", maker="신도리코", modelNo="D420", unit="대", rentPrice=120_000, cost=3_200_000, spec="A3 컬러 분당 30매"),
        "m400": item("신도리코 M400 흑백복합기", "asset", category="복합기", maker="신도리코", modelNo="M400", unit="대", rentPrice=60_000, cost=1_500_000),
        "c3530": item("캐논 iR-ADV C3530 컬러복합기", "asset", category="복합기", maker="캐논", modelNo="C3530", unit="대", rentPrice=150_000, cost=4_100_000),
        "k2554": item("교세라 TASKalfa 2554ci 컬러복합기", "asset", category="복합기", maker="교세라", modelNo="2554ci", unit="대", rentPrice=130_000, cost=3_600_000),
        "m404": item("HP 레이저젯 M404 프린터", "asset", category="프린터", maker="HP", modelNo="M404dn", unit="대", rentPrice=30_000, cost=420_000),
        "l6290": item("엡손 L6290 잉크젯 복합기", "asset", category="프린터", maker="엡손", modelNo="L6290", unit="대", rentPrice=25_000, cost=380_000),
        "t650": item("HP 디자인젯 T650 플로터", "asset", category="플로터", maker="HP", modelNo="T650", unit="대", rentPrice=90_000, cost=2_300_000, spec="A1 36인치"),
    }
    S: dict[str, str] = {}

    def stock(key: str, name: str, opening: float, price: int, cost: int, min_stock: float, compat: list[str], category: str, unit: str = "개") -> None:
        S[key] = item(name, "stock", openingQty=opening, price=price, cost=cost, minStock=min_stock, compatibleWith=[M[x] for x in compat], category=category, unit=unit)

    stock("d420_k", "D420 토너 검정", 14, 85_000, 45_000, 6, ["d420"], "토너")
    stock("d420_c", "D420 토너 파랑", 5, 120_000, 65_000, 3, ["d420"], "토너")
    stock("d420_m", "D420 토너 빨강", 5, 120_000, 65_000, 3, ["d420"], "토너")
    stock("d420_y", "D420 토너 노랑", 4, 120_000, 65_000, 3, ["d420"], "토너")
    stock("d420_drum", "D420 드럼 유닛", 3, 230_000, 140_000, 1, ["d420"], "드럼")
    stock("m400_t", "M400 토너", 12, 60_000, 30_000, 5, ["m400"], "토너")
    stock("c3530_k", "C3530 토너 검정", 4, 95_000, 52_000, 2, ["c3530"], "토너")
    stock("c3530_set", "C3530 토너 컬러 3색 세트", 2, 310_000, 180_000, 1, ["c3530"], "토너", "세트")
    stock("c3530_drum", "C3530 드럼 유닛", 2, 260_000, 160_000, 1, ["c3530"], "드럼")
    stock("k2554_k", "2554ci 토너 검정", 4, 90_000, 48_000, 2, ["k2554"], "토너")
    stock("hp26a", "HP 26A 토너", 8, 110_000, 70_000, 4, ["m404"], "토너")
    for color in ("검정", "파랑", "빨강", "노랑"):
        stock(f"ink_{color}", f"엡손 정품 잉크 (액상) {color} 70ml", 10, 18_000, 9_000, 6, ["l6290"], "잉크", "병")
    stock("t650_ink", "디자인젯 잉크 검정 80ml", 4, 65_000, 38_000, 2, ["t650"], "잉크")
    stock("fuser", "D420 정착기 유닛", 1, 320_000, 190_000, 1, ["d420"], "부품")
    stock("roller", "급지 롤러 (공용)", 6, 25_000, 9_000, 3, ["d420", "m400", "k2554"], "부품")
    stock("a4", "A4 복사용지 80g (2,500매 박스)", 60, 28_000, 21_000, 20, [], "용지", "박스")
    stock("a3", "A3 복사용지 80g (박스)", 12, 42_000, 32_000, 5, [], "용지", "박스")
    stock("b4", "B4 복사용지 80g (박스)", 6, 36_000, 27_000, 3, [], "용지", "박스")
    stock("label", "A4 라벨지 21칸 (100매)", 10, 15_000, 8_000, 4, [], "라벨지", "권")
    stock("staple", "스테이플 카트리지", 15, 15_000, 8_000, 5, ["d420", "c3530", "k2554"], "부품")

    # ── 기기 기초 등록 (작년에 산 기기) ──
    pool: dict[str, list[str]] = {}
    for model, n, sn, cost in [("d420", 8, "SD420", 3_000_000), ("m400", 7, "SM400", 1_400_000), ("c3530", 3, "CN3530", 4_000_000), ("k2554", 4, "KY2554", 3_500_000), ("m404", 6, "HP404", 400_000), ("l6290", 4, "EP6290", 360_000), ("t650", 2, "HPT650", 2_200_000)]:
        r = api("POST", f"{c}/assets", {"itemId": M[model], "count": n, "serials": [f"{sn}-{1001 + i}" for i in range(n)], "acquiredAt": "2025-09-01", "cost": cost, "location": "본사 창고"})
        pool[model] = [a["id"] for a in r["assets"]]

    # ── 도우미 ──
    def txn(body: dict[str, Any]) -> dict[str, Any]:
        return api("POST", f"{c}/txns", body)

    def line(key: str | None = None, qty: float = 1, price: int = 0, name: str = "", vat: str = "excluded") -> dict[str, Any]:
        return {**({"itemId": S.get(key) or M.get(key)} if key else {"name": name}), "qty": qty, "unitPrice": price, "vatMode": vat}

    counters: dict[str, list[int]] = {}  # 기기 → [흑백, 컬러]
    K: dict[str, str] = {}
    K_assets: dict[str, list[str]] = {}

    def contract(key: str, pkey: str, day: str, billing: int, machines: list[tuple[str, dict[str, Any]]], term_end: str | None = None, setup: int = 0, memo: str = "") -> None:
        ms = []
        for model, terms in machines:
            aid = pool[model].pop(0)
            if terms.get("counter"):
                counters[aid] = [rnd.randint(8_000, 60_000), rnd.randint(1_000, 15_000) if terms.get("freeColor") or terms.get("overColor") else 0]
                terms = {**terms, "startMono": counters[aid][0], "startColor": counters[aid][1]}
            ms.append({"assetId": aid, **terms})
        body = {"partnerId": P[pkey], "date": day, "billingDay": billing, "machines": ms, "memo": memo, **({"termEnd": term_end} if term_end else {}), "lines": [line(name="설치비", price=setup)] if setup else []}
        r = api("POST", f"{c}/contracts", body)
        K[key] = r["contract"]["id"]
        K_assets[key] = [m["assetId"] for m in ms]

    def read_all(day: str, skip: frozenset[str] = frozenset()) -> None:
        """진행 중 카운터 기기 검침 (사용량은 기기마다 달리)"""
        for key, kid in K.items():
            if key in skip:
                continue
            k = api("GET", f"{c}/contracts/{kid}")["contract"]
            for aid, m in k["machines"].items():
                if not m.get("counter") or m.get("endedAt") or aid not in counters:
                    continue
                counters[aid][0] += rnd.randint(900, 4_200)
                if counters[aid][1] or m.get("freeColor") or m.get("overColor"):
                    counters[aid][1] += rnd.randint(150, 900)
                api("POST", f"{c}/assets/{aid}/readings", {"date": day, "mono": counters[aid][0], "color": counters[aid][1]})

    def issue_due(upto: str, skip: frozenset[str] = frozenset()) -> list[dict[str, Any]]:
        """청구 대기에서 upto 달까지 차례로 발행 (사람이 확인한 것처럼 제안 금액 그대로)"""
        issued: list[dict[str, Any]] = []
        skip_ids = {K[s] for s in skip}
        while True:
            rows = [r for r in api("GET", f"{c}/billing")["pending"] if r["month"] <= upto and r["contractId"] not in skip_ids]
            if not rows:
                return issued
            items = [{"contractId": r["contractId"], "month": r["month"], "date": min(r["dueOn"], TODAY.isoformat()), "lines": [{k: ln[k] for k in ("name", "qty", "unitPrice", "vatMode", "memo")} for ln in r["lines"]]} for r in rows]
            res = api("POST", f"{c}/billing", {"items": items})["results"]
            bad = [x for x in res if not x["ok"]]
            if bad:
                raise SystemExit(f"청구 실패: {bad}")
            issued += [x["txn"] for x in res]

    def receivable(pkey: str) -> int:
        return int(api("GET", f"{c}/partners/{P[pkey]}")["partner"].get("receivable", 0))

    def pay(pkey: str, day: str, ratio: float = 1.0, acc: str | None = None) -> dict[str, Any] | None:
        amount = int(round(receivable(pkey) * ratio, -3))
        if amount <= 0:
            return None
        return txn({"type": "receipt", "date": day, "partnerId": P[pkey], "accountId": acc or kb, "amount": amount})["txn"]

    def expense(day: str, cat: str, amount: int, memo: str, acc: str) -> None:
        txn({"type": "expense", "date": day, "accountId": acc, "amount": amount, "category": cat, "memo": memo})

    def monthly_costs(mo: int) -> None:
        expense(md(mo, 1), "임차료", 1_200_000, "창고·사무실 월세", kb)
        expense(md(mo, 10), "인건비", 2_900_000, "현장 기사 급여", kb)
        expense(md(mo, 12), "통신비", 92_000, "인터넷·전화", ibk)
        for d in rnd.sample(range(2, 27), 3):
            expense(md(mo, d), "유류비", rnd.randint(55, 85) * 1000, "배송·출장 차량 주유", card)
        expense(md(mo, rnd.randint(3, 25)), "식대", rnd.randint(40, 90) * 1000, "현장 점심", card)
        expense(md(mo, rnd.randint(3, 25)), "운반비", rnd.randint(2, 6) * 10_000, "퀵 배송", cash)

    def doc(kind: str, t: dict[str, Any]) -> dict[str, Any]:
        return api("POST", f"{c}/docs", {"type": kind, "txnDate": t["date"], "txnId": t["id"]})["doc"]

    sale_mix = [("d420_k", 85_000), ("d420_c", 120_000), ("m400_t", 60_000), ("hp26a", 110_000), ("a4", 28_000), ("a3", 42_000), ("ink_검정", 18_000), ("label", 15_000), ("staple", 15_000)]

    def sales(mo: int, n: int) -> list[dict[str, Any]]:
        out = []
        for _ in range(n):
            pkey = rnd.choice(["school", "clinic", "law", "kids", "math", "eng", "med", "print", "office"])
            picks = rnd.sample(sale_mix, rnd.randint(1, 2))
            body: dict[str, Any] = {"type": "sale", "date": md(mo, rnd.randint(2, 26)), "partnerId": P[pkey], "lines": [line(k, rnd.randint(2, 8) if k == "a4" else rnd.randint(1, 3), p) for k, p in picks]}
            if pkey in ("kids", "math"):
                body["payNow"] = {"accountId": cash}
            try:
                out.append(txn(body)["txn"])
            except SystemExit:
                pass  # 재고가 모자라면 그 판매는 건너뜀
        return out

    # ════════ 4달 전 ════════
    txn({"type": "purchase", "date": md(4, 2), "partnerId": P["ink"], "lines": [line("d420_k", 10, 45_000), line("m400_t", 10, 30_000), line("hp26a", 6, 70_000), line("roller", 6, 9_000)], "payNow": {"accountId": kb}})
    txn({"type": "purchase", "date": md(4, 3), "partnerId": P["paper"], "lines": [line("a4", 40, 21_000), line("a3", 10, 32_000)], "payNow": {"accountId": ibk}})
    office_end = md(0, 1) if TODAY.day > 1 else md(1, 28)  # 만료일이 지났는데 아직 진행 중 (갱신 확인 필요)
    contract("tax", "tax", md(4, 1), 5, [("m400", {"monthly": 60_000})], setup=30_000)
    color_terms = {"counter": True, "freeMono": 3000, "freeColor": 400, "overMono": 9, "overColor": 60}
    contract("office", "office", md(4, 1), 31, [("d420", {"monthly": 100_000, **color_terms}), ("d420", {"monthly": 100_000, **color_terms}), ("m404", {"monthly": 25_000}), ("m404", {"monthly": 25_000})], term_end=office_end, memo="관공서 단가 (정가 대비 할인)")
    contract("school", "school", md(4, 3), 25, [("d420", {"monthly": 110_000, "counter": True, "freeMono": 2000, "freeColor": 300, "overMono": 10, "overColor": 70}), ("m400", {"monthly": 55_000}), ("m400", {"monthly": 55_000})], term_end="2027-02-28", setup=50_000, memo="교무실 D420, 행정실 M400 2대")
    contract("clinic", "clinic", md(4, 10), 10, [("d420", {"monthly": 100_000, "counter": True, "freeMono": 1000, "freeColor": 200, "overMono": 12, "overColor": 80})], term_end=(TODAY + timedelta(days=20)).isoformat(), setup=50_000)
    contract("law", "law", md(4, 15), 31, [("c3530", {"monthly": 150_000, "counter": True, "freeMono": 3000, "freeColor": 500, "overMono": 9, "overColor": 60}), ("m404", {"monthly": 30_000})])
    sales(4, 5)
    read_all(md(4, 22))
    issue_due(ym(4))
    for pk_ in ("school", "tax", "clinic"):
        pay(pk_, md(4, 28))
    monthly_costs(4)

    # ════════ 3달 전 ════════
    buy = txn({"type": "purchase", "date": md(3, 3), "partnerId": P["dh"], "lines": [line("d420", 2, 3_200_000)], "memo": "신규 계약용"})
    pool["d420"].extend(a["id"] for a in buy["createdAssets"])
    txn({"type": "payment", "date": md(3, 5), "partnerId": P["dh"], "accountId": kb, "amount": 3_520_000, "memo": "계약금"})
    contract("math", "math", md(3, 1), 1, [("m400", {"monthly": 50_000, "counter": True, "freeMono": 3000, "overMono": 8})])
    contract("kids", "kids", md(3, 5), 5, [("l6290", {"monthly": 25_000})], setup=20_000)
    contract("cafe", "cafe", md(3, 12), 15, [("k2554", {"monthly": 130_000, "counter": True, "freeMono": 1500, "freeColor": 500, "overMono": 10, "overColor": 70})], setup=30_000)
    txn({"type": "receipt", "date": md(3, 12), "partnerId": P["cafe"], "accountId": kb, "amount": 900_000, "memo": "6개월 선입금"})
    contract("print", "print", md(3, 20), 20, [("t650", {"monthly": 80_000}), ("c3530", {"monthly": 140_000, "counter": True, "freeMono": 4000, "freeColor": 800, "overMono": 8, "overColor": 55})])
    txn({"type": "purchase", "date": md(3, 18), "partnerId": P["print"], "lines": [line("b4", 6, 25_000)], "memo": "B4 사 옴"})
    sales(3, 6)
    read_all(md(3, 22))
    issue_due(ym(3))
    for pk_, ratio in (("school", 1), ("clinic", 1), ("tax", 1), ("office", 1), ("law", 0.5), ("math", 1), ("kids", 1), ("print", 1)):
        r = pay(pk_, md(3, rnd.randint(26, 30)), ratio)
        if r and pk_ in ("school", "office"):
            doc("receipt", r)
    txn({"type": "payment", "date": md(3, 28), "partnerId": P["print"], "accountId": ibk, "amount": 165_000})
    monthly_costs(3)

    # ════════ 2달 전 ════════
    txn({"type": "payment", "date": md(2, 2), "partnerId": P["dh"], "accountId": kb, "amount": 3_520_000, "memo": "잔금"})
    txn({"type": "purchase", "date": md(2, 4), "partnerId": P["ink"], "lines": [line("d420_c", 3, 65_000), line("d420_m", 3, 65_000), line("c3530_k", 3, 52_000), line("k2554_k", 3, 48_000)]})
    contract("eng", "eng", md(2, 10), 10, [("k2554", {"monthly": 130_000, "counter": True, "freeMono": 2000, "freeColor": 600, "overMono": 10, "overColor": 70})], setup=30_000)
    contract("med", "med", md(2, 20), 20, [("m404", {"monthly": 28_000}), ("m404", {"monthly": 28_000})])
    txn({"type": "adjust", "date": md(2, 16), "lines": [{"itemId": S["d420_k"], "qty": -1, "memo": "배송 중 파손"}, {"itemId": S["a4"], "qty": 2, "memo": "실사 결과 남음"}]})
    sv = api("POST", f"{c}/services", {"partnerId": P["law"], "assetId": K_assets["law"][0], "date": md(2, 6), "symptom": "인쇄물에 세로 줄", "contact": "박사무장"})["service"]
    api("POST", f"{c}/services/{sv['id']}/complete", {"date": md(2, 7), "action": "드럼 유닛 교체, 내부 청소", "parts": [{"itemId": S["c3530_drum"], "qty": 1}]})
    api("POST", f"{c}/docs", {"type": "work", "serviceId": sv["id"]})
    sales(2, 6)
    read_all(md(2, 22))
    issue_due(ym(2))
    api("POST", f"{c}/contracts/{K['tax']}/return", {"date": md(2, 28), "assetIds": K_assets["tax"], "returnLocation": "본사 창고", "memo": "계약 종료"})
    issue_due(ym(2))  # 종료 정산
    for pk_, ratio in (("school", 1), ("clinic", 1), ("office", 1), ("law", 0.3), ("math", 1), ("kids", 1), ("print", 1), ("eng", 1), ("tax", 1)):
        pay(pk_, md(2, rnd.randint(26, 30)), ratio)
    monthly_costs(2)

    # ════════ 지난달 ════════
    txn({"type": "purchase", "date": md(1, 3), "partnerId": P["paper"], "lines": [line("a4", 30, 21_000), line("label", 6, 8_000)], "payNow": {"accountId": ibk}})
    txn({"type": "purchase", "date": md(1, 4), "partnerId": P["ink"], "lines": [line("hp26a", 4, 70_000), line("t650_ink", 4, 38_000), line("ink_검정", 10, 9_000)]})
    contract("build", "build", md(1, 5), 5, [("t650", {"monthly": 90_000}), ("m400", {"monthly": 60_000})], term_end="2026-12-31", setup=50_000, memo="도면 출력")
    api("POST", f"{c}/contracts/{K['school']}/return", {"date": md(1, 15), "assetIds": [K_assets["school"][2]], "returnLocation": "본사 창고", "memo": "행정실 1대로 줄임"})
    sv2 = api("POST", f"{c}/services", {"partnerId": P["school"], "assetId": K_assets["school"][0], "date": md(1, 8), "symptom": "2단 카세트 용지 걸림", "contact": "행정실 김주무관"})["service"]
    api("POST", f"{c}/services/{sv2['id']}/complete", {"date": md(1, 9), "action": "급지 롤러 교체", "parts": [{"itemId": S["roller"], "qty": 2}], "billable": True})
    api("POST", f"{c}/docs", {"type": "work", "serviceId": sv2["id"]})
    sv3 = api("POST", f"{c}/services", {"partnerId": P["cafe"], "assetId": K_assets["cafe"][0], "date": md(1, 18), "symptom": "토너 교체 요청"})["service"]
    api("POST", f"{c}/services/{sv3['id']}/complete", {"date": md(1, 18), "action": "토너 교체 (계약 포함, 무상)", "parts": [{"itemId": S["k2554_k"], "qty": 1}]})
    sv4 = api("POST", f"{c}/services", {"partnerId": P["kids"], "date": md(1, 21), "symptom": "잉크 교체 요청"})["service"]
    api("POST", f"{c}/services/{sv4['id']}/cancel", {"reason": "원장님이 직접 교체"})
    for t in sales(1, 6)[:3]:
        doc("statement", t)
    dup = txn({"type": "charge", "date": md(1, 20), "partnerId": P["med"], "lines": [line(name="토너 교체비", price=30_000)]})["txn"]
    api("POST", f"{c}/txns/{dup['date']}/{dup['id']}/cancel", {"reason": "중복 입력"})
    read_all(md(1, 22), skip=frozenset({"eng"}))
    for t in issue_due(ym(1), skip=frozenset({"math"}))[:2]:
        doc("statement", t)
    for pk_, ratio in (("school", 1), ("clinic", 1), ("office", 0.6), ("kids", 1), ("print", 1), ("eng", 1), ("med", 1)):
        r = pay(pk_, md(1, rnd.randint(25, 30)), ratio)
        if r and pk_ == "clinic":
            doc("receipt", r)
    wrong = txn({"type": "receipt", "date": md(1, 29), "partnerId": P["build"], "accountId": cash, "amount": 165_000})["txn"]
    doc("receipt", wrong)
    api("POST", f"{c}/txns/{wrong['date']}/{wrong['id']}/cancel", {"reason": "계좌 잘못 선택"})
    txn({"type": "receipt", "date": md(1, 29), "partnerId": P["build"], "accountId": kb, "amount": 165_000})
    txn({"type": "payment", "date": md(1, 28), "partnerId": P["ink"], "accountId": kb, "amount": 500_000, "memo": "토너 대금 일부"})
    txn({"type": "charge", "date": md(1, 25), "partnerId": P["school"], "serviceId": sv2["id"], "lines": [line(name="A/S 출장·부품비 (급지 롤러 2개)", price=60_000)]})
    monthly_costs(1)

    # ════════ 이번 달 (오늘까지) ════════
    sales(0, 3)
    txn({"type": "purchase", "date": md(0, 2), "partnerId": P["paper"], "lines": [line("a4", 20, 21_000), line("a3", 5, 32_000)], "payNow": {"accountId": ibk}})
    expense(md(0, 1), "임차료", 1_200_000, "창고·사무실 월세", kb)
    expense(md(0, 3), "유류비", 68_000, "배송 차량 주유", card)
    read_all(md(0, 3), skip=frozenset({"school", "law", "eng", "print"}))  # 일부만 → '검침 필요'가 남게
    sv5 = api("POST", f"{c}/services", {"partnerId": P["eng"], "assetId": K_assets["eng"][0], "date": md(0, 2), "symptom": "스캔이 안 됨"})["service"]
    api("POST", f"{c}/services/{sv5['id']}/complete", {"date": md(0, 2), "action": "스캔 폴더 공유 설정 다시 잡음"})
    for s in [
        {"partnerId": P["school"], "assetId": K_assets["school"][1], "date": (TODAY - timedelta(days=5)).isoformat(), "symptom": "출력할 때 소음", "contact": "행정실"},
        {"partnerId": P["build"], "assetId": K_assets["build"][0], "date": (TODAY - timedelta(days=1)).isoformat(), "symptom": "잉크 노즐 막힘, 도면 줄 생김", "contact": "임소장 010-0000-0211"},
        {"partnerId": P["med"], "date": TODAY.isoformat(), "symptom": "새 PC에 프린터 드라이버 설치 요청"},
    ]:
        api("POST", f"{c}/services", s)
    opens = api("GET", f"{c}/open-charges?partnerId={P['law']}")["charges"]
    if opens:
        api("POST", f"{c}/docs/invoice", {"partnerId": P["law"], "date": TODAY.isoformat(), "txns": [{"date": o["date"], "id": o["id"]} for o in opens], "memo": "미납 금액 확인 후 입금 부탁드립니다."})

    for mo in (4, 3):  # 오래된 두 달은 월 마감
        api("POST", f"{c}/closes", {"month": ym(mo)})
    sent = company_notify.daily(cid, TODAY)  # 앱 안 알림 (푸시 키가 없어 폰 알림은 안 감)
    print(f"완료: {args.name} ({cid}) · API {calls[0]}회 · 아침 확인 알림 {sent}")


if __name__ == "__main__":
    main()
