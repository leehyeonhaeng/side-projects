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
    ↓
API Gateway
    ↓
Router Lambda (sales-agent-router)
    ├── POST /invoke      → Master Agent Proxy (Bedrock Agent Core 중계)
    ├── POST /invoke-a1   → A1 에이전트 직접 호출
    └── POST /invoke-a4   → A4 에이전트 직접 호출

Master Agent Proxy Lambda
    ├── 텍스트 입력    → Bedrock Agent Core (BRFMJAXGJ7) 호출
    ├── 메일 첨부      → agent-00-email-processor Lambda 직접 호출
    └── PDF 첨부       → sales-agent-a4 Lambda 직접 호출

Agent-00 (Email Processor)
    └── 메일 분류/분석 → 서비스 모듈 구조 (bedrock, sheets, s3 등)

A1 (상담 에이전트)
    ├── 메일 분석 → 질문지 생성
    └── 수기 입력 → 가견적 생성 → Google Docs + Sheets

A4 (기록관리 에이전트)
    ├── PDF → S3 저장
    ├── Bedrock으로 계약서 분석
    └── Google Sheets Sheet2에 자동 기록
```

---

## 🚀 구현된 컴포넌트

| 컴포넌트 | Lambda 함수명 | 역할 | 상태 |
|---------|-------------|------|------|
| **Router** | `sales-agent-router` | API Gateway 요청을 에이전트로 라우팅 | ✅ 완료 |
| **Master Proxy** | `sales-agent-master-proxy` | Bedrock Agent Core 중계, 첨부 파일 분기 | ✅ 완료 |
| **Agent-00** | `agent-00-email-processor` | 메일 분류/분석, 서비스 모듈 구조 | ✅ 완료 |
| **A1** | `sales-agent-a1` | 상담 에이전트 (질문지/가견적 생성) | ✅ 완료 |
| **A4** | `sales-agent-a4` | 기록관리 에이전트 (계약서 분석/기록) | ✅ 완료 |

> A2(제안), A3(계약관리)는 Bedrock Agent Core를 통해 연결 예정

---

## 🛠️ 기술 스택

### AWS
- **Amazon Bedrock** — `global.anthropic.claude-sonnet-4-6` 모델
- **Bedrock Agent Runtime** — `InvokeAgent` API로 멀티 에이전트 오케스트레이션
- **AWS Lambda** — Python 3.12, 각 에이전트 로직 실행
- **Amazon S3** — 계약서 원본 PDF 보관 (`sales-agent-contracts`)
- **AWS API Gateway** — HTTP API, 웹 UI와 Lambda 연결
- **AWS Secrets Manager** — Google OAuth 인증 정보 관리

### Google Workspace
- Google Docs API — 가견적 문서 자동 생성
- Google Sheets API — 고객 정보 및 계약 데이터 기록
- Google Drive API — 문서 저장
- OAuth 2.0 — refresh_token 방식 인증

---

## 📁 폴더 구조

```
📦 megathon-2026-sales-agent/
├── 📄 README.md
├── 📁 agents/
│   ├── 📁 agent-00-email-processor/
│   │   ├── 📁 src/
│   │   │   ├── lambda_function.py
│   │   │   └── services/
│   │   │       ├── agent_service.py
│   │   │       ├── bedrock_service.py
│   │   │       ├── classifier.py
│   │   │       ├── response_builder.py
│   │   │       ├── s3_service.py
│   │   │       └── sheets_service.py
│   │   └── template.yaml
│   ├── 📁 a1/
│   │   ├── 📁 src/lambda_function.py
│   │   ├── template.yaml
│   │   └── README.md
│   └── 📁 a4/
│       ├── 📁 src/lambda_function.py
│       ├── template.yaml
│       └── README.md
├── 📁 router/
│   ├── 📁 src/lambda_function.py
│   └── template.yaml
├── 📁 master-proxy/
│   ├── 📁 src/lambda_function.py
│   └── template.yaml
└── 📁 docs/
    ├── architecture.md
    ├── aws-setup.md
    └── google-setup.md
```

---

## ⚙️ 공통 환경 설정

| 항목 | 값 |
|------|-----|
| 리전 | `ap-northeast-2` (서울) |
| Bedrock 모델 | `global.anthropic.claude-sonnet-4-6` |
| Bedrock Agent ID | `BRFMJAXGJ7` |
| Secrets Manager | `sales-agent/google-credentials` |
| S3 버킷 | `sales-agent-contracts` |

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
