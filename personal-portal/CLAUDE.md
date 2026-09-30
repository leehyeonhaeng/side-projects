# personal-portal 작업 규칙

개인 겸 가족·팀 공유용 통합 포털 PWA. 로그인·Host 승인·모듈별 권한 기반.

## 기준 문서
- **`docs/DESIGN.md`가 모든 설계의 기준이다.** 작업 전에 관련 섹션을 읽고 그대로 따른다
- 설계와 다르게 구현해야 할 이유가 생기면, 먼저 이유와 대안을 제시하고 합의 후 `DESIGN.md`를 수정한 다음 구현한다
- 설계 결정의 근거는 `DESIGN.md` 3장(ADR)에 있다. 이미 결정된 사항을 다시 뒤집는 제안은 명확한 근거가 있을 때만 한다

## 현재 진행 단계
- ~~Phase 0 (사전 준비)~~, ~~Phase 1 (인프라 기반)~~ 완료 (2026-09-30)
- **Phase 2 (인증·계정)**: 가입, 이메일 인증, 승인 대기, 관리자 화면, 권한 미들웨어
- Phase가 끝나면 이 항목을 다음 Phase로 갱신한다
- 각 Phase의 완료 기준은 `DESIGN.md` 11장(구현 로드맵)을 따른다

## 핵심 제약 (요약, 상세는 DESIGN.md)
- AWS 서버리스: CloudFront + S3, API Gateway(HTTP API) + Cognito JWT, Lambda, DynamoDB(단일 테이블), Bedrock, SNS
- 리전 `ap-northeast-2`, 환경 `dev` / `prod`
- 스택: React + TypeScript + Vite / Terraform / Python 3.12
- 월 비용 1만 원 이하. 비용이 발생하는 리소스를 추가할 때는 예상 비용을 먼저 알린다
- 외부 API 연동 없음. 새 외부 연동은 합의 없이 추가하지 않는다
- 푸시 알림, 오프라인 동작 불필요

## 폴더 구조
```
side-projects/
├─ .github/workflows/portal-*.yml
└─ personal-portal/
   ├─ docs/DESIGN.md
   ├─ frontend/     React + TS + Vite (src/modules/<module>/)
   ├─ backend/      Python Lambda (handlers/, common/, tests/)
   ├─ infra/        Terraform (bootstrap/, modules/, envs/dev, envs/prod)
   ├─ README.md
   └─ DEVLOG.md
```

## 코딩 규칙

### Frontend
- TypeScript strict 모드
- UI: Tailwind CSS + shadcn/ui, 서버 상태: TanStack Query, 라우팅: React Router
- 모듈별 코드는 `src/modules/<module>/` 안에 둔다
- 모바일 우선 레이아웃, 다크모드 대응 필수
- API 호출은 `src/api/`를 통해서만 한다

### Backend (Lambda)
- Python 3.12, 타입 힌트 필수, 입력 검증은 Pydantic
- Powertools for AWS Lambda 사용 (라우팅, 로깅)
- 권한 검사는 `common/`의 공통 미들웨어로 처리하고 핸들러마다 중복 구현하지 않는다
- 권한 검사 순서: JWT(API Gateway) → 계정 status active → 모듈 PERM → 공유 리소스 멤버 여부
- DynamoDB 키 패턴은 `DESIGN.md` 7장을 따른다. 새 패턴이 필요하면 7장에 먼저 추가한다

### Infra (Terraform)
- 리소스 이름: `portal-<env>-<resource>` (예: `portal-dev-api`)
- 모든 리소스에 태그: `Project = personal-portal`, `Env = <env>`
- 공통 구성은 `infra/modules/`, 환경별 값은 `infra/envs/<env>/`
- IAM은 최소 권한. Bedrock 권한은 `ai` Lambda에만, Cognito 관리 권한은 `admin`·`auth-trigger` Lambda에만
- 변경 전 `terraform fmt`, `terraform validate` 통과

## 인프라 작업 규칙
- **AWS 계정 확인 필수**: 이 컴퓨터의 `default` 프로파일은 회사 계정이다. 이 프로젝트의 모든 AWS CLI·Terraform 명령은 `$env:AWS_PROFILE = "personal-portal"`(또는 `--profile personal-portal`)을 지정해서만 실행하고, 리소스를 만들거나 바꾸는 명령 전에는 `aws sts get-caller-identity`로 계정을 확인해 사용자에게 보여준다
- `default` 프로파일은 절대 사용하지 않는다
- `terraform plan` 결과를 요약해서 보여주고 **승인 후에만** `apply`한다
- `prod` 환경 apply는 사용자가 명시적으로 요청할 때만 한다
- `destroy`, 리소스 삭제, state 수동 수정(`terraform state rm` 등)은 반드시 사전 확인
- AWS 콘솔에서 수동으로 만든 리소스가 있으면 DEVLOG에 기록하고, 가능하면 Terraform으로 import한다

## 보안 규칙
- API 키, 비밀번호, 토큰을 코드·Terraform 변수 기본값에 하드코딩하지 않는다
- AWS 계정 ID, IAM ARN 같은 계정 식별 정보는 문서에 적지 않는다 (공개 레포 가능성)
- `.env`, `*.tfvars`(비밀 포함 시), `*.tfstate`는 커밋 대상에서 제외한다

## 작업 흐름
1. 이번 작업이 어느 Phase의 어떤 항목인지 확인한다
2. `DESIGN.md` 관련 섹션을 읽는다
3. 구현하고, 완료 기준을 직접 검증하는 방법(명령어, 확인 화면)을 제시한다
4. `DEVLOG.md`에 오늘 날짜로 한 일·결정·트러블슈팅을 추가하고, 필요하면 `README.md` 상태를 갱신한다
5. 변경 파일 목록과 커밋 메시지, `git add personal-portal/...` 명령을 제안한다 (커밋은 사용자가 직접)

## DEVLOG 작성 형식
- `## Day N — YYYY-MM-DD (요일)` 제목으로 누적한다
- 섹션: 한 일 / 결정 메모 / 트러블슈팅(원인·해결·주의) / 다음 할 일