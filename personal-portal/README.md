# Personal Portal

개인 겸 가족·팀 공유용 통합 포털 PWA. 웹과 모바일 홈 화면 앱으로 사용한다.

로그인한 사용자만 접근할 수 있고, Host(관리자)가 가입을 승인하며 모듈별 열람·편집 권한을 부여한다. 홈은 모든 콘텐츠의 아이콘과 위젯이 모인 카드형 대시보드이며, 레이아웃은 사용자별로 편집·저장된다.

## 상태

- 2026-09-28: 설계 확정
- 2026-09-30: Phase 0 완료 (상태 버킷, GitHub OIDC Role, Budgets 알림, CI 검증 워크플로우)
- 2026-09-30: Phase 1 완료 (dev: DynamoDB, Cognito, API Gateway, Lambda 4개, S3 + CloudFront, 빈 React 앱 배포)
- 2026-09-30: Phase 2 완료 (가입·이메일 인증·승인 대기·관리자 화면·권한 미들웨어, Host OTP)
- 2026-10-01: Phase 3 완료 (홈 위젯 그리드·편집 모드·섹션·테마·하단 바·빠른 추가 틀·설정, PC↔폰 레이아웃 동기화 확인)
- 2026-10-01: Phase 4 완료 (할 일·캘린더·반복·예정 회차 미리보기·공휴일·홈 위젯 연결)
- 2026-10-01: Phase 5 완료 (식단 + AI 칼로리 추정(Bedrock Claude Haiku 4.5), 체중, 운동(러닝·헬스·훈련 프로그램), 순섭취량)
- 2026-10-07: 행컴퍼니 C3 — 거래 엔진(판매·매입·임대 출고/수거·입금 배분·지급·경비·재고 조정·취소), 미수·선수금, 회사 장부, 월 마감 (dev)
- 2026-10-06: 행컴퍼니 C2 — 거래처, 품목(기기 모델·소모품)·재고, 기기 기초 등록(고유번호 자동)·상태·이력, 계좌 (dev)
- 2026-10-06: 행컴퍼니(회사 업무 공간) C1 — 회사 개설·전용 화면, 직원 초대 가입·역할·영역별 권한·금액 숨김, 회사 설정, 활동 기록 (dev)
- 2026-10-06: Phase 9 진행 — PWA(설치·새 버전 배너), 보안 헤더(CSP), prod 환경·배포 버튼 준비
- 2026-10-02: 디자인 전면 개편 1차 (따뜻한 톤 + 파랑 포인트, Pretendard, PC 사이드바·폰 하단 탭, 모듈 색)
- 2026-10-02: Phase 8 공용 체크리스트 (멤버 공유·체크한 사람 기록·일괄 삭제·전체 해제·템플릿·즐겨찾기·홈 위젯) dev 배포
- 2026-10-02: Phase 7 완료 (7a 메모, 7b 가계부, 7c 스니펫·링크 허브). 실사용 확인은 디자인 개편 뒤
- 2026-10-02: Phase 6 완료 (작업 보드: 보드·컬럼·카드·멤버 초대·드래그/이동·진행률, 댓글·활동 기록·보관·필터·템플릿·즐겨찾기·홈 위젯). 폰 실사용 확인은 나중에

## 모듈

| 모듈 | 데이터 | 설명 |
|---|---|---|
| 캘린더 | 개인 | 자체 캘린더, 반복 일정, 한국 공휴일 |
| 할 일 | 개인 | 마감일, 우선순위, 반복, 하위 체크리스트 |
| 식단·체중·운동 | 개인 | AI 칼로리 추정, 체중 추이, 러닝·헬스·훈련 프로그램 |
| 프로젝트 작업 보드 | 공유 | 칸반, 멤버 초대, 댓글, 활동 기록 |
| 메모·노트 | 개인 | 마크다운, 태그, 핀 |
| 가계부 | 개인 | 고정 지출, 예산, 통계, CSV 내보내기 |
| 스니펫·링크 허브 | 개인 | 원탭 복사, 컬렉션 |
| 공용 체크리스트 | 공유 | 참여 계정 지정, 템플릿 |

## 아키텍처

```
PWA ── CloudFront ── S3
  └── API Gateway (Cognito JWT) ── Lambda (Python) ── DynamoDB
                                        └── Bedrock (칼로리 추정)
GitHub Actions (OIDC) ── Terraform / 배포
```

- 리전: ap-northeast-2 (서울)
- 환경: dev, prod

## 기술 스택

| 영역 | 기술 |
|---|---|
| Frontend | React, TypeScript, Vite, Tailwind CSS, shadcn/ui, TanStack Query, React Router |
| Backend | Python, Powertools for AWS Lambda, Pydantic, boto3 |
| Infra | Terraform, AWS (Cognito, API Gateway, Lambda, DynamoDB, S3, CloudFront, Bedrock, SNS) |
| CI/CD | GitHub Actions (OIDC) |
| PWA | vite-plugin-pwa |

## 프로젝트 구조

`side-projects` 모노레포 안의 폴더로 관리한다.

```
side-projects/
├─ .github/workflows/
│  ├─ portal-oidc-check.yml   bootstrap plan 검증 (OIDC 접근 확인)
│  ├─ portal-pr.yml           PR: 테스트 + dev plan
│  └─ portal-deploy.yml       main push: 테스트 → dev apply → 프론트 빌드·업로드 → CloudFront 무효화
└─ personal-portal/
   ├─ docs/DESIGN.md          설계 문서 (전체 결정 사항, ADR, 데이터 모델, 로드맵)
   ├─ frontend/               React + TS + Vite + Tailwind
   │  └─ src/
   │     ├─ api/              API 호출 단일 진입점 (client.ts) + 도메인별 훅
   │     ├─ auth/             Amplify 설정, 세션, 라우트 가드
   │     ├─ components/       공통 컴포넌트 (ui/는 shadcn)
   │     └─ modules/<module>/ 화면 (auth, home, settings, admin, …)
   ├─ backend/                Python Lambda (한 패키지를 4개 함수가 공유)
   │  ├─ handlers/            personal, shared, admin, ai, auth_trigger(Cognito)
   │  ├─ common/              여러 Lambda 공통: 앱 골격, 권한 미들웨어(access), 모듈·권한(perms), 사용자·활동 로그, 검증·직렬화
│  ├─ domains/             도메인 로직·라우터 (todos, events, recurrence, meals, weights, exercise, notes, ledger, hub, boards, checklists, sharing, company_core, company_master, company_txn, ai) → handlers에서 include
│  ├─ requirements-ai.txt  ai Lambda 전용 레이어 의존성 (build_ai_layer.py로 빌드)
   │  ├─ scripts/             seed_company_demo.py: 행컴퍼니 데모 회사 생성 (dev 전용, 실제 company 코드로 거래 입력)
   │  └─ tests/
   ├─ infra/
   │  ├─ bootstrap/           상태 버킷, OIDC, CI Role, Budgets (로컬에서만 apply)
   │  ├─ modules/             dynamodb, cognito, lambda, api, hosting
   │  └─ envs/dev, envs/prod/ 환경별 조합 (prod: 삭제 방지·PITR)
   ├─ README.md
   └─ DEVLOG.md
```

GitHub Actions는 레포 최상단 `.github/workflows/`만 인식하므로 워크플로우는 `personal-portal/` 안에 두지 않는다. `paths` 필터로 이 프로젝트 변경 시에만 실행한다.

## 개발·배포

로컬 AWS 명령은 반드시 개인 계정 프로파일로 실행한다 (`default`는 회사 계정).

```powershell
$env:AWS_PROFILE = "personal-portal"
aws sts get-caller-identity          # 계정 확인 후 진행
```

| 작업 | 방법 |
|---|---|
| terraform 변수 | `infra/bootstrap`, `infra/envs/dev`, `infra/envs/prod`의 `terraform.tfvars.example`을 `terraform.tfvars`로 복사해 이메일 입력 (git 제외) |
| ai Lambda 레이어 | **terraform plan 전에** `python backend/build_ai_layer.py <dev|prod>` (결과는 `infra/envs/<env>/.build/`, git 제외). CI는 자동 |
| 백엔드 테스트 | `cd backend` → `python -m venv .venv` → `.venvScriptspip install -r requirements-dev.txt` → `.venvScriptspytest` |
| 프론트 로컬 실행 | `frontend/.env.example`을 `.env.development.local`로 복사해 `terraform output`의 `api_endpoint`, `user_pool_id`, `user_pool_client_id` 입력 → `npm install` → `npm run dev` |
| dev 배포 | main에 push하면 `portal-deploy.yml`이 자동 배포 (GitHub Secrets: `AWS_ROLE_ARN`, `HOST_EMAIL`) |
| dev 주소 | `infra/envs/dev`에서 `terraform output web_url` / `api_endpoint` |
| 배포 | main push → dev 자동. prod는 GitHub Actions `portal-deploy-prod` → Run workflow, 확인란에 `prod` |
| 로컬 프론트 배포 | `VITE_APP_ENV=dev|prod`(+ API·Cognito 값)로 `npm run build` 후 `bash scripts/upload-web.sh <web_bucket> <distribution_id>` |
| 폰 화면 점검 | `frontend`에서 `npm run screens` (다크: `npm run screens -- --dark`, 일부: `-- --only=calendar`). 가짜 데이터(mock 모드, 로그인 없음)로 앱을 띄워 모든 화면·주요 다이얼로그를 390px·360px로 캡처(`.screens/`, git 제외)하고 넘침·잘림·겹침 목록 출력. 이 PC의 Chrome 사용 |
| 가짜 데이터로 띄우기 | `npm run dev:mock` → http://localhost:5174 (화면 수정할 때 확인용) |
| 앱 아이콘 교체 | `frontend/public/app-icon.png`(1024px 정사각형, 모서리 투명)를 바꾸고 `npm run icons` |
| bootstrap 변경 | 로컬에서 `terraform -chdir=infra/bootstrap plan` → 승인 → `apply` |

## 주요 설계 결정

상세 내용과 근거는 [docs/DESIGN.md](docs/DESIGN.md)의 ADR 섹션 참고.

- GitHub을 저장소로 쓰는 방식은 토큰 노출·권한 강제 불가·인증 불가 문제로 제외하고 AWS 서버리스로 구성
- DynamoDB 단일 테이블 설계 + GSI 오버로딩
- Lambda 도메인별 분리로 최소 권한 적용 (Bedrock 권한은 ai Lambda에만)
- 가입 승인: 이메일 인증 후 계정 비활성화 → Host 승인 시 활성화
- 외부 API 연동 전면 제외 (유지보수 부담)

## 비용

월 1만 원 이하 목표. AWS Budgets 알림으로 감시한다.

## 문서

- [설계 문서](docs/DESIGN.md)
- [개발 일지](DEVLOG.md)
