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
- Phase 2 진행 (아래 Day 4)
- `ubuntu-latest`가 2026-10-19부터 Ubuntu 26으로 바뀜 → 이후 첫 실행 결과만 확인

## Day 4 — 2026-09-30 (수)

Phase 2 (인증·계정). 사용자가 자리 비운 동안 진행 — 사전에 결정 4개 확인받고, dev apply는 "계정 확인 + 삭제·교체 0개"일 때만 하도록 조건부 선승인받음.

### 한 일
- **백엔드**
  - `common/access.py`: 공통 권한 미들웨어(Powertools 전역 미들웨어). JWT claim → PROFILE status active → 경로 기반 모듈 PERM. Host는 모듈 권한 검사 생략
  - `common/perms.py`: 모듈·권한·상태 정의, 경로 첫 세그먼트 → 모듈 매핑, 기본 프리셋(가족·팀)
  - `common/users.py`, `common/audit.py`: PROFILE·PERM·활동 로그 저장소 (DESIGN 7장 키 패턴)
  - `handlers/auth_trigger.py`: Post Confirmation(비활성화 + pending + SNS 알림, HOST_EMAIL이면 자동 Host), Post Authentication(로그인 기록)
  - `handlers/admin.py`: 승인·거절·정지·재활성·삭제·비밀번호 초기화, 권한 매트릭스, 프리셋 CRUD, 활동 로그. host 그룹 + TOTP 등록 확인
  - `handlers/personal.py`: `GET /me`
  - 테스트 37개 (moto로 DynamoDB·Cognito·SNS 모킹) 전부 통과
- **인프라** (dev apply: 추가 12, 변경 5, 삭제 0)
  - `portal-dev-auth-trigger` Lambda + Cognito 트리거 연결, SNS `portal-dev-signup` + Host 이메일 구독
  - 도메인 Lambda 4개에 DynamoDB 권한, admin에만 Cognito 관리 권한 + `USER_POOL_ID`
  - `host_email` 변수 (로컬 `terraform.tfvars`, CI는 Secret `HOST_EMAIL` → `TF_VAR_host_email`)
- **프론트**
  - Amplify Auth 연동, shadcn/ui(base-nova) 도입, 다크모드는 `.dark` 클래스 + 시스템 설정 추종
  - 화면: 로그인(TOTP 코드 단계 포함), 가입 신청, 이메일 인증, 비밀번호 찾기, Host OTP 등록(QR), 홈(권한 있는 모듈만 표시), 관리자(승인 대기·계정·권한 매트릭스·프리셋·활동 로그)
  - 라우트 가드: 로그인 → 활성 계정 → Host면 TOTP 등록 강제
  - dev에 로컬 배포, 배포된 Lambda 5개 no-op 호출로 import·권한 정상 확인
- CI: deploy/PR 워크플로우에 `HOST_EMAIL` Secret, Cognito ID 빌드 변수 연결

### 결정 메모
- 첫 Host 계정: 지정 이메일(`host_email`)로 가입하면 자동 Host. 이메일은 레포에 남기지 않음
- 거절·삭제는 완전 삭제 (활동 로그에만 기록)
- 활동 로그 범위: 로그인 + 계정·권한 변경(승인·거절·정지·재활성·삭제·비밀번호 초기화·권한 변경). 프리셋 변경은 기록 안 함
- 정지 해제(재활성) 기능 추가 (DESIGN에 없었음)
- 관리자 API는 Host + TOTP 등록 여부까지 서버에서 확인 (앱 강제만으로는 우회 가능)
- 모듈 권한은 경로 첫 세그먼트로 판단 → 미구현 라우트도 403이 먼저 나옴 (권한 차단 확인 가능)
- auth-trigger는 풀이 ARN을 참조하므로 별도 모듈 호출로 분리하고, 풀 ID는 이벤트에서 받음 (순환 의존 방지)
- Lambda 모듈 `policy_json`을 필수로 변경 (plan 시점 미확정 값으로 `count` 계산이 막히는 문제 회피)
- Select는 네이티브 `<select>` 사용 (권한 매트릭스처럼 칸이 많고 모바일 OS 선택창이 편함)

### 트러블슈팅
**1. dev Cognito 풀이 이메일 대소문자를 구분함**
- 원인: Phase 1에서 `username_configuration`을 지정하지 않아 API 기본값(대소문자 구분)으로 생성됨. 바꾸려면 풀 교체 필요
- 대응: 사용자 승인 후 `username_configuration { case_sensitive = false }` 추가 → 풀 교체 (풀·클라이언트·host 그룹·트리거 권한 교체 4, 인증기·admin 환경변수·정책 변경 4). 교체 전 풀·테이블이 비어 있는 것 확인, 새 풀 ID로 프론트 재배포
- 주의: 풀 교체는 사용자·그룹 데이터가 모두 사라진다. 이후 스키마·사용자 이름 설정 변경은 사용자 이전 계획 없이 하지 않는다

**2. shadcn init 결과물의 `cn` import**
- `src/lib/utils.ts`가 `cn` npm 패키지(shadcn 공식)를 쓰도록 생성됨 → 일반적인 `clsx` + `tailwind-merge`로 교체, `sonner`(next-themes 의존)는 제거

**3. heredoc 안의 Python 테스트 코드로 bash 파싱 실패**
- 파일 쓰기 도구로 대체

**4. 예산 알림 이메일을 개인 메일로 변경**
- `budget_notification_email` 기본값(회사 메일)을 제거하고 로컬 `bootstrap/terraform.tfvars` / CI Secret `HOST_EMAIL`로 주입 (`portal-oidc-check.yml`)
- 주의: 이전 회사 메일 주소는 git 히스토리에는 남아 있음

**5. PowerShell로 README를 수정했다가 한글 깨짐**
- 원인: Windows PowerShell 5.1의 `Get-Content`가 BOM 없는 UTF-8을 시스템 코드페이지(cp949)로 읽고, `Set-Content -Encoding utf8`이 BOM을 붙여 저장
- 해결: 마지막 커밋 버전으로 복구 후 변경분 재적용
- 주의: 문서·코드 파일 수정은 PowerShell `Get-Content`/`Set-Content`로 하지 않는다 (Node/편집 도구 사용)

**6. Host 로그인 후 관리자 화면에 "Unauthorized"**
- 확인: API Gateway 접근 로그상 가입·로그인·OTP 등록·관리자 API(200)까지 정상이었고, 약 2분 뒤부터 모든 요청이 `missing: token not provided`(401) → 브라우저의 Amplify 토큰이 사라진 상태. 서버 쪽 문제 아님
- 원인: 미확정 (다른 탭 로그아웃 / 토큰 갱신 실패 등 후보). 재현 시 브라우저 콘솔 확인 예정
- 조치: 토큰이 없으면 요청을 보내지 않고 401로 처리, 401을 받으면 로컬 로그아웃 후 로그인 화면으로 이동. 4xx는 재시도하지 않음

### 검증 (Phase 2 완료 기준)
- Host(`host_email`)로 가입 → 자동 활성화 → 첫 로그인 시 OTP 등록 → 관리자 화면 ✅
- 두 번째 계정(Gmail `+member` 주소) 가입 → 로그인 시 "승인 대기 중" 안내 ✅, Host에게 SNS 가입 알림 메일 도착 ✅
- 거절 → 계정 완전 삭제 → 같은 이메일로 재가입 가능 ✅
- 승인(가족 프리셋) → 로그인 → 홈에 권한 있는 모듈만 표시(작업 보드 숨김) ✅
- 배포된 Lambda를 멤버 신원으로 직접 호출: `GET /boards` 403(no permission), `GET /admin/users` 403(host only), 권한 있는 모듈은 통과(라우트 미구현이라 404) ✅
- CI: `portal-oidc-check`, `portal-deploy` 통과 ✅
- → **Phase 2 완료**

**7. 승인 시 프리셋 기본값이 "가족"으로 선택된 채 승인됨**
- 원인: 프리셋 선택칸이 이름순 첫 항목을 기본값으로 가짐 (의도는 "팀"이었음)
- 해결: 기본값 없이 "프리셋 선택"을 직접 골라야 승인 버튼이 활성화되도록 변경

**8. 로그아웃 버튼을 누르면 화면이 멈춤**
- 원인(코드상 추정): 로그아웃 뒤 `resetQueries()`가 화면에 붙은 쿼리(`/me` 등)를 다시 요청 → 토큰 없음 401 → 전역 401 처리가 다시 `signOut` + `resetQueries` 호출 → 반복. 또 `signOut`이 실패하면 로그인 화면 이동 코드까지 가지 못함
- 해결: 로그인·로그아웃·401 처리 모두 `resetQueries` 대신 `clear()`(재요청 없음)로 바꾸고, 로그아웃은 실패해도 항상 로그인 화면으로 이동
- 주의: 인증 상태가 바뀔 때 React Query 캐시는 `resetQueries`가 아니라 `clear`로 비운다

### 다음 할 일
- Phase 3: 홈 대시보드 (위젯 그리드, 편집 모드, 섹션, 다크모드 수동 토글, 하단 바, 빠른 추가 틀)
- 번들 크기 경고(gzip ~200KB, 대부분 Amplify) → Phase 9에서 코드 분할
- 토큰이 사라졌던 원인은 재현되면 브라우저 콘솔로 확인

## Day 5 — 2026-10-01 (목)

Phase 3 (홈 대시보드). 시작 전에 결정 4개 확인받음, dev apply는 Phase 2와 같은 조건으로 선승인.

### 한 일
- **백엔드**: `common/preferences.py`(레이아웃·설정 Pydantic 모델 + 저장소), personal Lambda에 `GET/PUT /layout`, `GET/PATCH /settings`, `PATCH /me`(이름). 테스트 12개 추가, 총 49개 통과
- **프론트**
  - 홈: 섹션별 4칸 그리드(react-grid-layout v2), 편집 모드(손잡이 드래그, 항목 선택 → 하단 작업 막대에서 크기·숨기기·섹션 이동), 항목 추가, 숨긴 항목 복원, 섹션 추가·이름·순서·삭제, 기본 레이아웃 자동 생성
  - 위젯 10종 틀 (DESIGN 6장 크기별 내용 표시), 모듈 아이콘 → 각 모듈 자리 화면(Phase 예정 안내)
  - 다크모드 수동 토글(시스템/라이트/다크), 서버 저장 + 로컬 캐시로 첫 화면 깜빡임 방지
  - 모바일 하단 바(홈 / 빠른 추가 / 설정), PC는 헤더에 빠른 추가·설정
  - 빠른 추가 틀 (할 일·식단·지출·메모, 편집 권한 있는 것만, 저장은 각 Phase에서 연결)
  - 설정: 테마, 이름 변경, 비밀번호 변경, OTP 등록·해제(Host는 해제 불가). OTP 등록 화면을 `auth/TotpSetup`으로 분리해 Host 강제 등록과 공유
- **배포**: dev apply (Lambda 5개 코드 업데이트만, 추가·삭제 0) + 프론트 배포. 배포된 Lambda에 Host 신원으로 `GET /layout`·`/settings`·`/me` 확인

### 결정 메모
- 그리드는 모든 기기 4칸 고정 (완료 기준 "다른 기기에서 동일"을 그대로 만족)
- 섹션은 독립 그리드, 섹션 간 이동은 메뉴로 (그리드 간 드래그는 라이브러리 미지원 + 모바일 불안정)
- 크기 변경은 버튼 순환 (리사이즈 핸들은 터치가 어렵고 DESIGN에 없는 1×2가 생김)
- 레이아웃은 DynamoDB에 JSON 문자열로 저장 (map으로 넣으면 숫자가 Decimal → Powertools 직렬화 시 문자열이 됨)
- 이름 변경은 DynamoDB PROFILE만 바꾼다 (관리자 화면·`/me`의 기준). Cognito `name` 속성은 가입 시 값 유지

### 트러블슈팅
**1. 명령 도구가 `Remove-Item`과 다른 줄의 `index.html` 문자열을 하나로 읽어 차단**
- 같은 PowerShell 명령에 삭제와 업로드를 섞지 않고 단계별로 나눠 실행

**2. "1×1 위젯은 크기 조절이 안 된다"는 피드백**
- 원인: 기본 레이아웃의 1×1 항목은 모두 아이콘(바로가기, 1×1 고정)인데, 위젯 카드와 모양이 비슷해서 위젯으로 보임
- 해결: 아이콘을 앱 아이콘 모양(배경 없음)으로 바꿔 위젯 카드와 구분, 작업 막대에 "1×1 고정" 표시, 아이콘 ↔ 위젯 바꾸기 버튼 추가

### 검증
- PC에서 편집·저장한 레이아웃이 폰에서 같은 배치로 표시됨 (사용자 확인) → **Phase 3 완료**

### 다음 할 일
- Phase 4: 할 일 + 캘린더

## Day 6 — 2026-10-01 (목)

Phase 4 (할 일 + 캘린더). 결정 4개 확인받음(반복 일정 "이 일정만/전체", 공휴일 npm 패키지, 월+주+목록, 같은 조건 선승인).

### 한 일
- **백엔드** (`backend/domains/` 신설, personal Lambda가 라우터로 포함)
  - `recurrence.py`: 할 일 다음 회차(매일·평일·매주 요일·매월), 일정 회차 펼치기(매일·매주·매월·매년, 없는 날짜 건너뜀)
  - `todos.py`: 할 일·목록 CRUD, 완료 시 반복 다음 회차 생성, 기간 마감 조회(GSI1)
  - `events.py`: 단일·반복 일정, "이 일정만"(exdates + 분리)·"전체" 수정·삭제, 기간 조회, 검색
  - 공통: `common/http.py`(본문·쿼리 검증), `common/serialize.py`(Decimal ↔ int/float), Router에서도 쓰는 `current_sub`
  - 테스트 44개 추가, 총 93개 통과
- **프론트**
  - 할 일: 오늘/예정/전체/완료 탭, 빠른 추가(엔터 → 오늘), 상세 편집(마감일·시간·우선순위·목록·반복·하위 체크리스트), 모바일 스와이프(→ 완료, ← 내일로), 정렬(마감일·우선순위·직접 순서 드래그 dnd-kit), 목록 추가·이름 변경·삭제
  - 캘린더: FullCalendar v7(월·주·목록, 한국어), 일정 편집(종일·시간·장소·색상·메모·반복·종료일), 반복 회차 저장·삭제 시 "이 일정만/전체" 선택, 공휴일 표시, 할 일 마감일 겹쳐 보기(읽기 전용), 검색
  - 홈: 할 일·일정 위젯 실제 데이터(크기별), 오늘 일정 배너, 빠른 추가의 할 일 저장 연결
  - 모듈 화면 권한 가드(`RequireModule`)
- **배포**: dev apply (Lambda 5개 코드 업데이트만), 프론트 배포, 배포된 Lambda에 `GET /todos`·`/todo-lists`·`/events`·`/todos/due` 200 확인

### 결정 메모
- DESIGN 6.1·6.2에 Phase 4 구현 결정, 7장에 `EVENTR#<id>` 키 패턴, 8.2에 할 일·캘린더 API 추가
- 반복 일정 "전체" 수정은 날짜를 바꾸지 않음 (회차 날짜로 시리즈 시작일을 옮기면 이전 회차가 사라지므로)
- 시작 시간·시작일만 옮기면 종료 시간·종료일도 같이 옮겨 길이 유지
- 위젯 카드: 제목만 링크, 내용(체크·빠른 추가)은 링크 밖 → 링크 안에 버튼이 들어가는 문제 방지

### 트러블슈팅
**1. FullCalendar v7 구조 변경**
- 6.x처럼 `@fullcalendar/daygrid` 등을 따로 설치했더니 core 6.x와 react 7.x가 섞임 → v7은 플러그인이 `@fullcalendar/react/daygrid` 등으로 내장. 6.x 패키지 제거, `temporal-polyfill` 추가
- v7에는 `buttonText` 옵션이 없음 (한국어 로케일이 버튼 이름 제공)
- 다크모드: 클래식 팔레트는 `[data-color-scheme=dark]` 기준이라, `.portal-calendar`에서 팔레트 변수를 앱 테마 변수로 덮어씀

**2. DynamoDB 숫자(Decimal)가 응답에서 문자열로 나가는 문제 예방**
- 반복 요일·monthDay 등 숫자 필드가 Powertools 직렬화에서 문자열이 됨 → `to_plain`으로 응답 전에 int·float 변환

**3. 기존 권한 테스트가 `/todos`를 "미구현 경로"로 쓰고 있었음**
- Phase 4로 `/todos`가 생겨 404 → 200. 아직 미구현인 `/notes`로 바꿈

**4. 캘린더에서 일정 색상이 모두 파란색으로 표시 (위젯은 정상)**
- 원인: FullCalendar v7은 이벤트 색을 `color`·`contrastColor`로 받는데 v6 이름(`backgroundColor`·`borderColor`·`textColor`)으로 넘겨서 무시됨. 이벤트 배열을 `object[]`로 선언해 타입 검사로도 못 잡음
- 해결: v7 이름으로 변경, 이벤트 배열을 `EventInput[]`로 타입 지정

**5. 사용자 피드백 반영**
- 완료한 할 일이 위젯·오늘 탭에서 바로 사라짐 → 오늘 완료한 것은 맨 아래 취소선으로 남기고 다시 누르면 되돌림 (다음 날부터는 완료 탭에만). 위젯·오늘 탭이 같은 규칙(`todo/selectors.ts`)을 씀
- 위젯 클릭 범위가 제목 글자뿐이라 불편 → 위젯 전체를 누르면 모듈 화면으로 이동, 체크 버튼·입력창만 예외(클릭 전파 차단). 체크 버튼 터치 영역 확대

**6. 캘린더 월·주·목록 버튼 중 선택된 버튼 글자가 안 보임 (다크모드)**
- 원인: 클래식 테마는 모든 버튼 글자색이 하나(`--fc-classic-button-foreground`)이고 선택 버튼은 배경(`--fc-classic-button-strong`)만 바뀜. 선택 배경을 `--primary`(다크모드에서 흰색)로 덮어써서 흰 바탕에 흰 글자
- 해결: 선택 배경·테두리를 일반 버튼색과 글자색의 중간색(`color-mix`)으로 → 라이트·다크 모두 대비 확보

**7. "매주 수요일 반복인데 다음 주부터 일정이 안 잡힌다"는 피드백**
- 원인: 버그 아님. 반복 할 일은 완료 기반(완료해야 다음 회차 생성, DESIGN 6.2)이라 미래 회차가 존재하지 않음. 캘린더 일정 반복(미래 회차가 다 보임)과 동작이 달라 혼동
- 결정(사용자 선택): 동작은 유지하고 앞으로의 회차를 미리 보여준다
  - `GET /todos/due`가 `projected`(반복 할 일의 앞으로 회차, 오늘 이후만)를 함께 반환. 계산은 서버 `next_todo_due` 하나로 → 미리보기와 실제 다음 회차가 항상 같음
  - 캘린더: ↻ 흐린 기울임꼴로 표시. 예정 탭: 점선 "반복 예정" 행(누르면 원본 할 일 편집)
  - 편집 화면: 반복 시 "첫 회차 날짜", "시간 (매 회차 같은 시간)" 라벨 + "다음 회차 10/7 (수)" 안내. 매주 반복에서 첫 회차 요일이 다르면 "이번 회차는 …, 다음 회차 …"로 안내 (요일 자동 이동은 안 함)
- 확인: 배포된 API에서 실제 회차(10/1 완료 → 10/7 생성)와 예정 회차(10/14·21·28) 확인 → 반복 할 일 동작 확인

### 다음 할 일
- Phase 4 완료 기준 확인: 반복 할 일 완료 → 다음 회차 생성, 마감일이 캘린더에 표시
- Phase 5: 식단·체중·운동 + AI 칼로리 추정
