# A4 — 기록관리 에이전트

## 역할

웹 페이지에서 업로드된 **계약서 PDF를 자동 분석**하여 계약 정보를 추출하고, 원본 파일은 **S3에 안전하게 보관**하며, 분석 결과는 **Google Sheets에 자동 기록**합니다.

---

## 처리 흐름

```
웹 페이지 (PDF 업로드)
    ↓
API Gateway (POST /process-contract)
    ↓
Lambda (sales-agent-a4)
    ├── 1. S3에 PDF 원본 저장
    ├── 2. Bedrock Claude로 계약서 분석
    └── 3. Google Sheets Sheet2에 결과 기록
```

---

## 계약서 분석 항목

| 항목 | 설명 |
|------|------|
| `account` | 고객사명 (법인 형태 제외, 예: 주식회사 코드잇 → 코드잇) |
| `brn` | 사업자등록번호 |
| `address` | 고객사 주소 |
| `representative` | 대표자명 |
| `contract_level` | 계약 레벨 (Lv1~Lv4) |
| `category` | 분류 (Infra / MS / AGR) |
| `service_name` | 서비스명 (AWS, GCP 등) |
| `contract_name` | 계약서 명칭 |
| `contract_period` | 계약 기간 |
| `written_date` | 작성일 |
| `effective_date` | 적용일 |
| `expiry_date` | 만료일 |
| `auto_renewal` | 자동갱신 여부 (O/X) |

### 계약레벨 판단 기준
- `통합 디지털 서비스` 포함 → **Lv1**
- `관리형서비스` 포함 → **Lv2**
- `추가 약정` 포함 → **Lv3**
- `합의서` 포함 → **Lv4**

### 분류(category) 판단 기준
- Lv4 → **AGR**
- Basic 등급 또는 인프라 관련 → **Infra**
- Standard/Premium 등급 → **MS**

---

## AWS 리소스

| 항목 | 값 |
|------|-----|
| Lambda 함수명 | `sales-agent-a4` |
| 런타임 | Python 3.12 |
| 타임아웃 | 3분 |
| 메모리 | 256MB |
| S3 버킷 | `sales-agent-contracts` |
| Lambda Layer | `google-api-layer`, `openpyxl-layer`, `pypdf-layer` |

### IAM 권한
- `AmazonBedrockFullAccess`
- `AmazonS3FullAccess`
- Secrets Manager 인라인 정책 (`sales-agent/google-credentials`)

### API Gateway
- 타입: HTTP API
- 엔드포인트: `POST /process-contract`
- CORS: 활성화 (웹 페이지에서 직접 호출)

---

## Google Sheets 기록 구조 (Sheet2, A~S열)

```
A: Idx
B: Upload Time
C: Account (고객사명)
D: 담당자
E: BRN (사업자등록번호)
F: 주소
G: 대표자
H: 계약레벨 (Lv1~Lv4)
I: 분류 (Infra/MS/AGR)
J: 계약기간
K: 작성일
L: 적용일
M: 만료일
N: 자동갱신 (O/X)
O: 계약서명 ([AWS] 계약명_고객사_YYMMDD)
P: docs (Drive)
Q: DMS
R: SFDC
S: 양사 날인본 (S3 HYPERLINK)
```

### 계약서명 형식
```
[AWS] MZC 관리형클라우드컴퓨팅서비스이용약정_코드잇_260201
```

---

## 요청/응답 형식

### 요청
```json
{
  "pdf_base64": "base64로 인코딩된 PDF...",
  "sheet_id": "1yXxzFMl5punfnvzpnc0l9xU_-EIhY_4cehun9FTfO0o",
  "recipient_email": ""
}
```

### 응답
```json
{
  "success": true,
  "contract_info": {
    "account": "코드잇",
    "contract_level": "Lv2",
    "category": "Infra",
    "effective_date": "2026.02.01",
    "expiry_date": "2027.01.31"
  },
  "s3_url": "https://sales-agent-contracts.s3.ap-northeast-2.amazonaws.com/...",
  "sheet_updated": true
}
```

---

## 기술 스택

- **Amazon Bedrock** — Claude Sonnet 4.6으로 계약서 분석
- **Amazon S3** — 계약서 원본 PDF 보관 (Presigned URL로 안전한 접근)
- **Google Sheets API** — 계약 데이터 자동 기록
- **AWS Secrets Manager** — Google OAuth 인증 정보
