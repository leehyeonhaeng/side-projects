# 시스템 아키텍처

## 전체 구조

```
┌─────────────────────────────────────────────────────────┐
│                      웹 페이지 (HTML UI)                  │
└───────────────┬─────────────────────┬───────────────────┘
                │                     │
         POST /generate        POST /process-contract
                │                     │
┌───────────────▼──────┐  ┌──────────▼──────────────────┐
│   API Gateway (A1)   │  │      API Gateway (A4)        │
└───────────────┬──────┘  └──────────┬───────────────────┘
                │                     │
┌───────────────▼──────┐  ┌──────────▼───────────────────┐
│  Lambda: sales-agent-a1 │  │  Lambda: sales-agent-a4     │
│                      │  │                               │
│  ┌────────────────┐  │  │  ┌─────────────────────────┐ │
│  │ Amazon Bedrock │  │  │  │     Amazon S3           │ │
│  │ Claude Sonnet  │  │  │  │  (계약서 PDF 보관)        │ │
│  └────────────────┘  │  │  └─────────────────────────┘ │
│  ┌────────────────┐  │  │  ┌─────────────────────────┐ │
│  │  Google Docs   │  │  │  │     Amazon Bedrock       │ │
│  │  (가견적 생성)  │  │  │  │   (계약서 분석)           │ │
│  └────────────────┘  │  │  └─────────────────────────┘ │
│  ┌────────────────┐  │  │  ┌─────────────────────────┐ │
│  │ Google Sheets  │  │  │  │     Google Sheets        │ │
│  │  (데이터 기록) │  │  │  │   (계약 정보 기록)         │ │
│  └────────────────┘  │  │  └─────────────────────────┘ │
└──────────────────────┘  └───────────────────────────────┘
                │                     │
┌───────────────▼─────────────────────▼───────────────────┐
│              AWS Secrets Manager                         │
│           (sales-agent/google-credentials)               │
│         client_id / client_secret / refresh_token        │
└─────────────────────────────────────────────────────────┘
```

---

## 인증 흐름 (OAuth 2.0)

```
Lambda 실행
    ↓
Secrets Manager에서 client_id, client_secret, refresh_token 조회
    ↓
Google OAuth 서버에 refresh_token으로 access_token 요청
    ↓
발급된 access_token으로 Google API 호출
(Docs / Sheets / Drive)
```

refresh_token은 만료되지 않으므로 한 번 발급 후 Secrets Manager에 저장하면 됩니다.

---

## A1 에이전트 상세 흐름

```
웹 UI → API Gateway → Lambda
    │
    ├── action: analyze_email
    │       ↓
    │   Bedrock Claude (메일 분석)
    │       ↓
    │   질문지 텍스트 반환
    │
    └── action: generate_quote
            ↓
        Bedrock Claude (가견적 내용 생성)
            ↓
        Google Docs (가견적 문서 생성)
            ↓
        Google Sheets (고객 정보 기록)
            ↓
        Docs URL + 성공 응답 반환
```

---

## A4 에이전트 상세 흐름

```
웹 UI (PDF 선택 → base64 변환)
    ↓
API Gateway POST /process-contract
    {
      "pdf_base64": "...",
      "sheet_id": "...",
      "recipient_email": ""
    }
    ↓
Lambda (sales-agent-a4)
    ↓
1. base64 → PDF 바이너리 디코딩
    ↓
2. S3 업로드 (contracts/YYYY/MM/DD/파일명.pdf)
    ↓
3. S3에서 PDF 읽어 Bedrock으로 분석
   → account, brn, contract_level, category,
     effective_date, expiry_date 등 추출
    ↓
4. 계약서명 생성
   "[AWS] 계약명_고객사_YYMMDD"
    ↓
5. Google Sheets Sheet2에 A~S열 데이터 기록
   S열: S3 Presigned URL HYPERLINK
    ↓
성공 응답 반환
{
  "success": true,
  "contract_info": {...},
  "s3_url": "https://...",
  "sheet_updated": true
}
```

---

## 보안 설계

| 항목 | 방식 |
|------|------|
| Google 인증 정보 | Secrets Manager 암호화 저장 |
| 계약서 PDF | S3 비공개 버킷 저장 |
| 계약서 접근 | Presigned URL (7일 만료) |
| API 인증 | API Gateway (필요시 Authorizer 추가) |
| CORS | 허용된 도메인만 접근 |
