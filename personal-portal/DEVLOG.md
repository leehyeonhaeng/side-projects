# DEVLOG

## Day 1 — 2026-09-28 (월)

### 한 일
설계 전 단계 전체 확정. 구현은 다음 세션부터 Phase 0으로 시작.

**컨셉·조건**
- 개인 겸 가족·팀 공유용 통합 포털 PWA로 확정
- Host 단독 관리자, 모듈별 `none / view / edit` 권한, 권한 프리셋
- 가입 → 이메일 인증 → 비활성(승인 대기) → Host 승인 시 활성화
- 자체 이메일 로그인, Refresh 토큰 30일 (30일 후 재로그인, 재가입 아님)
- 푸시·오프라인 불필요, 기기 간 동기화 필요, 월 비용 1만 원 이하

**아키텍처·스택**
- AWS 서버리스: CloudFront + S3, API Gateway(HTTP API) + Cognito JWT, Lambda, DynamoDB, Bedrock, SNS
- 스택: React + TypeScript + Vite / Terraform / Python (현업 사용 비중 기준)
- DynamoDB 단일 테이블 + GSI1 오버로딩
- Lambda 도메인별 분리: auth-trigger, admin, personal, shared, ai
- 환경 dev + prod, GitHub Actions OIDC 배포

**모듈 확정**
- 캘린더, 할 일, 식단·체중·운동, 프로젝트 작업 보드, 메모·노트, 가계부, 스니펫·링크 허브, 공용 체크리스트
- 식단 칼로리는 Bedrock AI 추정 방식, 계정당 하루 50회 상한

### 검토 후 제외한 것
| 항목 | 제외 이유 |
|---|---|
| GitHub repo를 데이터 저장소로 사용 | 쓰기 토큰 클라이언트 노출, 권한 강제 불가, 자체 로그인 불가, 동시 수정 충돌, 삭제 데이터가 히스토리에 남음 |
| 주식·환율 | 증권사 API 토큰 매일 재발급, 장 운영시간 처리 등 유지보수 부담 |
| 스포츠 (KBO, MLB, 유럽 5대 리그 일부) | 여러 리그 커버 시 유료 API 또는 다수 API 조합 필요 |
| 외부 캘린더 연동 | 사용자별 OAuth 토큰 관리 부담 |
| 공용 체크리스트 실시간 동기화 | WebSocket 인프라 추가 필요 → 새로고침 방식으로 대체 |
| 기존 다이어트 트래커 데이터 이관 | 입력된 데이터가 없어 불필요, 식단 모듈을 새로 구현 |

### 결정 메모
- 계정 정지 시 `AdminDisableUser` + `AdminUserGlobalSignOut`으로 refresh 토큰 즉시 폐기
- Bedrock 모델 ID는 구현 시 서울 리전 사용 가능 여부를 콘솔에서 확인 후 확정
- Terraform 상태는 S3 네이티브 잠금 사용 (DynamoDB 잠금 테이블 불필요)
- 레포 위치: 별도 레포 대신 `side-projects/personal-portal/`로 확정
  - 워크플로우는 `side-projects/.github/workflows/portal-*.yml`에 둔다 (하위 폴더의 `.github`는 GitHub이 인식하지 않음)
  - `paths: personal-portal/**` 필터, job별 `working-directory` 지정
  - OIDC 신뢰 정책 `sub`는 `repo:leehyeonhaeng/side-projects:ref:refs/heads/main`으로 제한

### 트러블슈팅
**1. `git add .` 시 `adding embedded git repository: diet-tracker` 경고**
- 원인: `side-projects/diet-tracker/`가 자체 `.git`을 가진 별도 레포(`leehyeonhaeng/diet-tracker`)라서 내용 없이 링크(gitlink)로만 스테이징됨
- `git rm --cached diet-tracker`는 "staged content different from both the file and the HEAD" 에러로 실패 (add 이후 하위 레포 상태가 달라짐)
- 해결: `git restore --staged diet-tracker`로 스테이징만 취소 + `side-projects/.gitignore` 신규 생성 후 `diet-tracker/` 추가
- 주의: `.gitignore`는 이미 스테이징된 항목은 빼주지 않으므로 스테이징 취소를 별도로 해야 함

**2. README.md, DEVLOG.md가 `docs/` 안에 잘못 배치됨**
- 해결: `git mv`로 `personal-portal/` 루트로 이동 (DESIGN.md만 `docs/`에 둠)

**3. push 전 밀린 커밋 10개 확인**
- `git log origin/main..HEAD --oneline`, `git diff --name-only origin/main..HEAD`로 sojung 프로젝트 커밋임을 확인
- `git grep`으로 스크립트·세션·DB 파일에 하드코딩된 비밀값 없음을 확인 후 함께 push

### 다음 할 일
- Phase 0: Terraform 상태 버킷, GitHub OIDC 역할, AWS Budgets 알림 설정

## Day 2 — 2026-09-28 (월)

### 한 일
- `infra/` 폴더 구조 확정: `bootstrap/`(Phase 0 전용, 계정 전체 공유 리소스) + `modules/` + `envs/dev,prod`(Phase 1부터)
- Phase 0 Terraform 작성 (`infra/bootstrap/`): 상태 버킷, GitHub OIDC Provider, GitHub Actions IAM Role, AWS Budgets 알림
- Terraform CLI 설치 (winget, v1.16.2) — 이 컴퓨터에 없었음
- `personal-portal/.gitignore` 신규 생성 (`.terraform/`, `*.tfstate`, `*.tfvars` 등)
- bootstrap `apply` 완료: 상태 버킷을 자기 자신에게 마이그레이션(self-referencing backend, S3 네이티브 락) 확인

### 결정 메모
- 계정 전체 공유 리소스(상태 버킷, OIDC Provider, GH Actions Role, Budgets)는 `portal-<env>-<resource>` 대신 `portal-<resource>` 네이밍 사용 (env 구분 없음)
- 상태 버킷명: `portal-tfstate-lhhportal`
- GitHub Actions Role 권한: `PowerUserAccess` + IAM은 `portal-*` 이름 리소스만 관리 가능한 별도 scoped 인라인 정책 (PowerUserAccess가 IAM 관리 권한을 기본 제외하기 때문)
- OIDC 신뢰정책 sub 조건: `repo:leehyeonhaeng/side-projects:ref:refs/heads/main` + `repo:leehyeonhaeng/side-projects:pull_request` 둘 다 허용
- AWS Budgets 월 한도 초기값 $10 USD로 설정 — 계정 청구 통화가 실제 USD가 맞는지 확인 필요 (KRW면 10,000으로 변경)

### 트러블슈팅
**1. (중대) AWS `default` 프로파일이 회사 계정으로 연결된 상태에서 최초 apply 실행**
- 계정 확인 없이 `terraform apply` 실행 → **회사 AWS 계정**에 9개 리소스(S3 버킷, OIDC Provider, IAM Role/Policy 2개, Budgets)가 실제로 생성됨
- 사용자가 즉시 발견 → 회사 콘솔에서 직접 삭제 완료
- 재발 방지: `personal-portal` 이름의 전용 AWS CLI 프로파일을 새로 생성(IAM 사용자 신규 발급, root 계정 키 사용 안 함), 이후 모든 명령은 `$env:AWS_PROFILE = "personal-portal"` 지정 후에만 실행
- **다음 세션 필수 조치**: `personal-portal/CLAUDE.md`에 "AWS 명령 실행 전 `aws sts get-caller-identity`로 계정 확인 필수" 규칙 추가 (아직 미반영)

**2. winget 설치 직후 PATH 미반영**
- 같은 터미널 세션에서 PATH 갱신이 안 됨 → 패키지 전체 경로(`%LOCALAPPDATA%\Microsoft\WinGet\Packages\...\terraform.exe`)로 직접 호출해서 우회
- 폴더명에 AWS 리전 코드처럼 보이는 접미사(`8wekyb3d8bbwe`)가 붙어있어 처음에 경로를 잘못 읽음(줄바꿈으로 잘림) → `Get-ChildItem`으로 실제 폴더명 재확인 후 해결

**3. S3 상태 버킷 생성이 41분 소요 (개인 계정 apply 때)**
- 원인 불명(AWS 쪽 지연으로 추정), 재시도 없이 결국 정상 완료됨. 이후 apply에서 또 발생하면 AWS Service Health Dashboard 확인 필요

### 다음 할 일
- `personal-portal/CLAUDE.md`에 AWS 계정 확인 규칙 추가
- GitHub Actions 워크플로우(`portal-*.yml`) 작성 + 레포 Secret에 Role ARN 등록 + 실제 OIDC 접근 검증 → Phase 0 완료 기준 ② 충족
- Budgets 한도 통화(USD/KRW) 확인 후 필요시 조정
- Phase 0 완료되면 `README.md`, `personal-portal/CLAUDE.md` 진행 단계를 Phase 1로 갱신
## Day 3 — 2026-09-30 (수)

### 한 일
- `personal-portal/CLAUDE.md`에 AWS 계정 확인 규칙 추가 (`AWS_PROFILE=personal-portal` 필수, `default` 사용 금지, 변경 전 `get-caller-identity` 확인)
- GitHub Actions 검증 워크플로우 `.github/workflows/portal-oidc-check.yml` 추가: OIDC로 Role assume → caller identity → `terraform init` → `terraform plan -detailed-exitcode`
- GitHub Secret `AWS_ROLE_ARN` 등록 (Role ARN을 레포에 남기지 않기 위해)
- CI Role 인라인 정책에 `iam:GetOpenIDConnectProvider` 추가 후 워크플로우 통과 → **Phase 0 완료**
- `DESIGN.md` 9.3(bootstrap) 신설, 9장 폴더 구조에 `bootstrap/` 반영

**Phase 1 (인프라 기반)**
- bootstrap 수정: Budgets 한도 $7(약 1만 원, 청구 통화 KRW지만 Budgets는 USD 기준), CI Role IAM 관리 대상을 `portal-dev-*`, `portal-prod-*`로 축소 + 자기 역할은 읽기만
- Terraform 모듈 5개(`dynamodb`, `cognito`, `lambda`, `api`, `hosting`) + `envs/dev` 조합, 로컬 apply로 75개 리소스 생성
- 백엔드 골격: `common/app.py`(Powertools resolver, `/health`) + 핸들러 4개, pytest 5개
- 프론트 골격: Vite + React 19 + TS strict + Tailwind v4 + React Router + TanStack Query, `src/api/client.ts`, 홈에서 API 상태 표시
- 프론트 첫 배포(로컬: 빌드 → S3 → CloudFront 무효화) → 브라우저에서 "ok · personal" 확인 → **Phase 1 완료 기준 충족**
- CI 워크플로우 `portal-deploy.yml`(main push → dev 배포), `portal-pr.yml`(PR → 테스트 + plan) 추가
- CI 첫 배포(`portal-deploy`) 통과, 배포 후 사이트 정상 확인 → **Phase 1 완료**
- 워크플로우 액션을 Node 24 버전으로 올림: checkout v7, setup-node v7, setup-python v7, configure-aws-credentials v6, setup-terraform v4 (사용 중인 입력값이 새 버전에도 있는지 확인)

### 결정 메모
- bootstrap은 로컬에서만 apply하고, CI는 plan으로 접근·drift 검증만 한다
- 워크플로우에 `mask-aws-account-id: true` 설정 (공개 레포라 Actions 로그에 계정 ID 노출 방지)
- OIDC Provider는 CI에 조회 권한만 준다 (자기 신뢰 설정 수정 방지)
- Cognito: Lite 요금제, 필수 속성 `email`·`name`, 선택 `custom:signup_note`(가입 메모). **스키마 속성은 생성 후 변경 불가**
- 비밀번호 규칙: 8자 이상 + 소문자·숫자·특수문자 필수 (대문자 선택)
- 인증 메일은 `COGNITO_DEFAULT` (하루 50통 제한, 소규모라 충분)
- Lambda: Python 3.12, arm64, 백엔드 전체를 zip 1개로 묶어 4개 함수가 공유 (handler만 다름). Powertools는 AWS 공개 레이어(v38 고정)
- API 라우트: `GET /api/v1/health`만 인증 없음. ANY 대신 메서드를 명시 (ANY + JWT면 CORS preflight도 인증을 요구함)
- 프론트 → API는 CORS로 직접 호출 (DESIGN 2장 구조 유지). 허용 origin: CloudFront 주소 + `http://localhost:5173`
- API 스로틀 초당 20건 / 버스트 50 (비용 보호)
- `backend/**`는 `.gitattributes`로 LF 고정 (Windows/CI 간 Lambda 패키지 해시 차이 방지)

### 트러블슈팅
**1. CI `terraform plan`에서 403 AccessDenied (`iam:GetOpenIDConnectProvider`)**
- 원인: `PowerUserAccess`는 IAM을 제외하고, 기존 scoped 정책은 `role/portal-*`, `policy/portal-*`만 허용 → plan의 OIDC Provider 상태 조회 실패
- 해결: 해당 Provider ARN 한정으로 `iam:GetOpenIDConnectProvider` 허용 추가 (로컬 apply) 후 Re-run
- 참고: Role assume·init은 이미 통과해서 OIDC 인증 자체는 첫 실행부터 정상이었음

**2. GitHub API로 실행 결과 폴링 시 rate limit 초과**
- 비인증 API는 IP당 시간당 60회 제한. `gh` CLI 미설치 → Actions 결과는 웹 화면에서 직접 확인

**3. 이 세션의 PowerShell에서 `python`이 PATH에 없음**
- Terraform과 같은 원인(세션 PATH 미갱신). `%LOCALAPPDATA%ProgramsPythonPython312python.exe` 전체 경로로 실행

**4. `.gitignore`의 `.env.*`가 `.env.example`까지 제외**
- `!.env.example` 예외 추가

**5. 콘솔에서 Lambda·DynamoDB가 안 보인다는 문의**
- 원인: 콘솔 리전이 서울이 아니었음. S3는 리전과 무관하게 버킷을 보여주지만 Lambda·DynamoDB는 선택한 리전 것만 보임
- 해결: 콘솔 리전을 아시아 태평양(서울) ap-northeast-2로 변경

### 다음 할 일
- Phase 2: 가입·이메일 인증·승인 대기(auth-trigger), 관리자 화면, 권한 미들웨어
- `ubuntu-latest`가 2026-10-19부터 Ubuntu 26으로 바뀜 → 이후 첫 실행 결과만 확인
