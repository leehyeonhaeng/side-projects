# 🤖 영업 파이프라인 자동화 AI 에이전트 시스템

> MEGATHON 2026 | Team 공공칠빵

[![AWS](https://img.shields.io/badge/AWS-Lambda%20%7C%20Bedrock%20%7C%20S3-FF9900?logo=amazonaws)](https://aws.amazon.com)
[![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python)](https://python.org)
[![Claude](https://img.shields.io/badge/Claude-Sonnet%204.6-7B2D8B)](https://anthropic.com)

---

## 📌 프로젝트 개요

클라우드 영업 담당자들이 상담부터 계약까지 반복적으로 수행하던 수작업 업무를 **AI 멀티 에이전트**로 자동화한 시스템입니다.

가견적 작성, 계약서 분석, 데이터 기록 등 기존에 수십 분씩 걸리던 작업을 **3분 이내**로 단축했습니다.

---

## 🏗️ 시스템 아키텍처

```
웹 페이지 (HTML UI)
    │
    ├── A1 상담 에이전트 ──────────────────────────────────────────────┐
    │       │                                                          │
    │   API Gateway → Lambda (sales-agent-a1)                         │
    │       │         ├── Bedrock Claude (질문지/가견적 생성)            │
    │       │         ├── Google Docs API (문서 자동 생성)              │
    │       │         └── Google Sheets API (데이터 기록)              │
    │                                                                  │
    └── A4 기록관리 에이전트 ──────────────────────────────────────────┘
            │
        API Gateway → Lambda (sales-agent-a4)
                      ├── Amazon S3 (계약서 PDF 보관)
                      ├── Bedrock Claude (계약서 분석)
                      └── Google Sheets API (계약 정보 자동 기록)
```

---

## 🚀 구현된 에이전트

| 에이전트 | 역할 | 상태 |
|---------|------|------|
| **A1** 상담 에이전트 | 메일 분석 → 질문지 생성, 수기 입력 → 가견적 생성 | ✅ 완료 |
| **A2** 제안 에이전트 | 제안서 자동 작성 | 🔜 예정 |
| **A3** 계약관리 에이전트 | 계약 진행 상태 관리 | 🔜 예정 |
| **A4** 기록관리 에이전트 | 계약서 PDF 분석 → S3 저장 → Sheets 기록 | ✅ 완료 |

---

## 🛠️ 기술 스택

### AWS
- **Amazon Bedrock** — `global.anthropic.claude-sonnet-4-6` 모델로 문서 분석 및 생성
- **AWS Lambda** — Python 3.12, 에이전트 로직 실행
- **Amazon S3** — 계약서 원본 PDF 보관 (`sales-agent-contracts`)
- **AWS API Gateway** — HTTP API, 웹 UI와 Lambda 연결
- **AWS Secrets Manager** — Google OAuth 인증 정보 관리

### Google Workspace
- Google Docs API — 가견적 문서 자동 생성
- Google Sheets API — 고객 정보 및 계약 데이터 기록
- Google Drive API — 문서 저장 및 공유
- OAuth 2.0 — refresh_token 방식 인증

### 기타
- Chrome 확장프로그램 (초기) → 웹 페이지 UI로 전환
- Python Lambda Layer (`google-api-layer`, `pypdf-layer`, `openpyxl-layer`)

---

## 📁 폴더 구조

```
📦 sales-agent-system
├── 📄 README.md
├── 📁 agents/
│   ├── 📁 a1/
│   │   ├── 📄 README.md          # A1 에이전트 상세 설명
│   │   └── 📄 lambda_function.py # A1 Lambda 코드
│   └── 📁 a4/
│       ├── 📄 README.md          # A4 에이전트 상세 설명
│       └── 📄 lambda_function.py # A4 Lambda 코드
└── 📁 docs/
    ├── 📄 architecture.md        # 아키텍처 상세 설명
    ├── 📄 aws-setup.md           # AWS 설정 가이드
    └── 📄 google-setup.md        # Google Cloud 설정 가이드
```

---

## ⚙️ 공통 환경 설정

### AWS 설정

| 항목 | 값 |
|------|-----|
| 리전 | `ap-northeast-2` (서울) |
| Bedrock 모델 | `global.anthropic.claude-sonnet-4-6` |
| Secrets Manager 키 | `sales-agent/google-credentials` |

### Secrets Manager 저장 형식

```json
{
  "client_id": "Google OAuth Client ID",
  "client_secret": "Google OAuth Client Secret",
  "refresh_token": "Google OAuth Refresh Token"
}
```

### Google Cloud 설정

- 프로젝트: `sales-agent-system`
- 활성화 API: Gmail, Google Docs, Google Drive, Google Sheets
- 인증 방식: OAuth 2.0 (refresh_token)

---

## 📊 기대 효과

| 지표 | Before | After |
|------|--------|-------|
| 가견적 작성 시간 | 30분 | 3분 이내 |
| 담당자 월 절감 시간 | — | 약 10시간 |
| 데이터 누락 건수 | 수동 오입력 발생 | 0건 (자동화) |
| 계약 현황 파악 | 수동 취합 | 실시간 자동 갱신 |

---

## 👥 팀 정보

- **Team** 공공칠빵
- **대회** MEGATHON 2026
