# A1 — 상담 에이전트

## 역할

고객 상담 내용을 분석하여 **질문지를 자동 생성**하고, 수기로 입력된 고객 정보를 바탕으로 **가견적을 자동 생성**합니다. 생성된 가견적은 Google Docs 문서로 저장되고 Google Sheets에 기록됩니다.

---

## 기능

### 1. 메일 분석 → 질문지 생성
- `action: analyze_email` 호출
- 고객 메일 내용을 Bedrock Claude가 분석
- 추가 확인이 필요한 사항을 질문지 형태로 자동 생성

### 2. 수기 입력 → 가견적 생성
- `action: generate_quote` 호출
- 영업 담당자가 입력한 고객 정보 및 요구사항 분석
- 가견적 내용 생성 후 Google Docs 문서 자동 생성
- Google Sheets에 고객 정보 및 가견적 기록

---

## AWS 리소스

| 항목 | 값 |
|------|-----|
| Lambda 함수명 | `sales-agent-a1` |
| 런타임 | Python 3.12 |
| 타임아웃 | 1분 |
| 메모리 | 128MB |
| Lambda Layer | `google-api-layer`, `openpyxl-layer` |

### IAM 권한
- `AmazonBedrockFullAccess`
- Secrets Manager 인라인 정책 (`sales-agent/google-credentials`)

### API Gateway
- 타입: HTTP API
- 엔드포인트: `POST /generate`

---

## 요청/응답 형식

### 가견적 생성 요청
```json
{
  "action": "generate_quote",
  "customer_info": "고객사명: ABC제조, 담당자: 김철수 부장, EC2 서버 3대 필요...",
  "customer_name": "ABC제조",
  "service_name": "AWS 클라우드 구축",
  "amount": "월 110만원",
  "sheet_id": "Google Sheets ID"
}
```

### 메일 분석 요청
```json
{
  "action": "analyze_email",
  "email_content": "안녕하세요, AWS 클라우드 도입을 검토 중입니다..."
}
```

---

## 기술 스택

- **Amazon Bedrock** — Claude Sonnet 4.6으로 문서 생성
- **Google Docs API** — 가견적 문서 자동 생성
- **Google Sheets API** — 고객 데이터 기록
- **AWS Secrets Manager** — Google OAuth 인증 정보
