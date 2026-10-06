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

### 검증
- 반복 할 일 완료 → 다음 회차 생성(10/1 완료 → 10/7), 마감일 캘린더 표시 확인 → **Phase 4 완료**
- 이후 사용하면서 나오는 문제는 그때그때 수정하기로 함

### 다음 할 일
- Phase 5: 식단·체중·운동 + AI 칼로리 추정

## Day 7 — 2026-10-01 (목)

Phase 5a (식단 + AI 칼로리 추정). Phase 5는 5a 식단+AI → 5b 체중 → 5c 운동으로 나눠 진행하기로 함. 결정: 모델 Haiku 4.5, 러닝 소모 칼로리는 체중×거리×1.036 근사식(5c), 같은 조건 선승인.

### 한 일
- **모델 확인**: 서울 리전 Bedrock 모델·추론 프로필 조회. Haiku 4.5는 `global.` 프로필로만 제공, Claude 3 Haiku는 지원 종료 모델이라 제외
- **백엔드**
  - `domains/meals.py`: 식단 CRUD·여러 항목 저장·끼니/날짜 이동·어제 복사·일별 통계, 내 음식(100g/1회 기준), 끼니 조합
  - `domains/ai.py`: Anthropic SDK(`AnthropicBedrock`) + 구조화 출력(`messages.parse`)으로 칼로리·탄단지 추정, 하루 50회 조건부 차감(실패 시 복원)
  - 설정에 식단 목표(kcal·탄단지) 추가
  - 테스트 18개 추가, 총 111개 통과
- **인프라** (dev apply: 추가 1, 변경 6, 삭제 0)
  - ai 전용 레이어 `portal-dev-ai-deps` (Powertools 3.35.0 + pydantic 2.13.5 + anthropic 1.11.0, arm64). `backend/build_ai_layer.py`로 빌드, 의존성 목록이 바뀔 때만 새 버전
  - ai Lambda: 전용 레이어만, Bedrock InvokeModel 권한(추론 프로필 + 기반 모델), 타임아웃 30초·메모리 512MB
  - CI(deploy·PR)에 레이어 빌드 단계 추가
- **실제 호출 확인**: "현미밥 한 공기, 닭가슴살 150g, 김치 조금" → 200g 260kcal / 150g 165kcal / 50g 17.5kcal, 사용 횟수 1/50 차감. Bedrock 모델 접근은 이미 열려 있었음(콘솔 작업 불필요)
- **프론트**
  - `/health` 식단 탭: 날짜 이동, 섭취/목표 게이지 + 탄단지, 입력(AI 계산·직접 입력·내 음식 자동완성·끼니 조합 불러오기), 확인 카드(양 바꾸면 비율 재계산, 내 음식에 추가), 끼니별 카드(AI 추정 표시, 조합 저장, 전날 같은 끼니 복사), 항목 수정·이동·삭제, 전날 식단 복사, 기록 그래프(주간·월간, 평균·목표선, Recharts)
  - 설정: 식단 목표 입력
  - 홈 식단 위젯(1×1 오늘 kcal / 2×1 게이지+탄단지 / 2×2 끼니 요약+빠른 입력), 빠른 추가 "식단" → 식단 화면에서 AI 계산
  - 체중·운동 탭은 5b·5c 자리 표시

### 결정 메모
- ai Lambda는 공개 Powertools 레이어 대신 자체 레이어 하나만 쓴다 (두 레이어의 pydantic 파일이 /opt에서 섞이면 깨짐)
- 레이어 `source_code_hash`는 zip이 아니라 `requirements-ai.txt` 해시 → 매 배포마다 새 레이어 버전이 쌓이지 않음. 의존성을 바꾸면 레이어가 교체(replace)되므로 그때는 선승인 대상이 아님
- AI 사용 횟수는 호출 전에 차감, 실패하면 되돌림 (실패는 세지 않음, 동시 요청도 상한을 넘지 않음)
- 빠른 추가·홈 위젯의 식단 입력은 바로 저장하지 않고 식단 화면(확인 카드)으로 보낸다 (DESIGN: 확인 후 저장)

### 트러블슈팅
**1. Pydantic 모델에서 필드 이름 `date`가 `date` 타입을 가림**
- 증상: `date: date | None = None` 정의 시 `TypeError: unsupported operand type(s) for |: 'NoneType' and 'NoneType'`
- 원인: 클래스 본문에서 기본값이 먼저 평가되어 `date`가 None으로 묶인 뒤 타입 주석이 평가됨
- 해결: 모듈에 `Day = date` 별칭을 두고 `date: Day | None`으로 선언

**2. AI 계산 502 — Bedrock Marketplace 구독 미완료 (서울 리전)**
- 증상: 앱에서 "AI 계산에 실패했습니다". 로그: `PermissionDeniedError 403 … not authorized to perform the required AWS Marketplace actions (aws-marketplace:ViewSubscriptions, aws-marketplace:Subscribe) … subscription cannot be completed at this time`
- 확인 과정: 관리자 계정으로 호출해도 서울에서만 같은 오류, us-east-1(`us.`·`global.` 프로필)은 성공 → Lambda 권한이 아니라 계정의 **서울 리전** 구독 문제. 처음 플레이그라운드 테스트는 버지니아 리전 콘솔에서 해서 그쪽만 구독됨
- 해결: 콘솔 리전을 서울로 바꾸고 Bedrock 플레이그라운드에서 Claude Haiku 4.5(Global) 호출 → 처음엔 같은 오류, 잠시 뒤 성공 → ai Lambda 호출 성공 ("얼큰쌀국수 1그릇" → 350g 294.5kcal)
- 주의: `get-foundation-model-availability`의 agreement가 AVAILABLE로 보여도 실제 호출이 될 때까지 몇 분 걸릴 수 있음. 새 리전·새 모델을 쓸 때는 **그 리전 콘솔에서** 플레이그라운드로 1회 호출해 구독을 먼저 만든다. Lambda 역할에 Marketplace 권한은 주지 않는다(최소 권한)
- 처음에 "플레이그라운드에서 다른 모델을 골랐을 것"이라고 잘못 추정함 → 리전별 호출 비교로 원인 확정

**3. 테스트 파일을 bash heredoc으로 만들 때 따옴표 때문에 파싱 실패 (재발)**
- 테스트 파일은 파일 쓰기 도구로 작성

### 다음 할 일
- 5a 확인: AI 추정 → 수정 → 저장, 하루 상한 동작 (Phase 5 완료 기준 일부)
- 5b: 체중 (요약·7일 이동평균 그래프·인바디), 체중 위젯
- 5c: 운동 (러닝·헬스 루틴·훈련 프로그램), 순섭취량

## Day 8 — 2026-10-01 (목)

Phase 5b (체중). AWS 리소스 추가 없음, dev apply는 Lambda 코드 5개 업데이트만.

### 한 일
- **백엔드**: `domains/weights.py` (하루 한 기록 저장·덮어쓰기, 기간/전체 조회, 삭제, 인바디 체지방률·골격근량 선택), 설정에 목표 체중. 테스트 8개 추가, 총 119개 통과
- **프론트**
  - 체중 탭: 요약 카드(현재·목표·남은 차이·지난주 대비), 기록 입력(날짜·체중, 펼치면 인바디·메모), 그래프(7일 이동평균선 + 일별 점, 인바디 수치는 입력한 날만 오른쪽 축에 점, 목표선, 1개월·3개월·전체), 최근 기록 목록에서 수정·삭제
  - 설정: 목표 체중 (식단·체중 목표 카드)
  - 홈 체중 위젯: 1×1 현재 체중 / 2×1 7일 추세 / 2×2 1개월 그래프 + 목표선
- **배포**: dev apply(변경 5, 추가·삭제 0), 프론트 배포

### 결정 메모
- 하루 한 기록 (DESIGN 7장 키 `WEIGHT#<date>` 그대로). 같은 날 다시 기록하면 덮어쓴다
- 이동평균은 "기록일 기준 직전 7일 안의 기록 평균" (빠진 날을 0으로 채우지 않음)

### 트러블슈팅
**1. 목표 체중(실수) 저장 시 DynamoDB float 오류 예방**
- 설정 저장이 `to_dynamo`를 거치지 않아 68.5 같은 값에서 boto3가 float를 거부할 상황 → 설정 저장도 Decimal 변환을 거치게 수정 (테스트로 확인)

### 다음 할 일
- 5b 확인: 체중 기록·그래프·위젯
- 5c: 운동 (러닝·헬스 루틴·훈련 프로그램) + 식단의 순섭취량(섭취 − 운동 소모)

## Day 9 — 2026-10-01 (목)

Phase 5c (운동) + 식단 순섭취량. AWS 리소스 추가 없음, dev apply는 Lambda 코드 5개 업데이트만.

### 한 일
- **백엔드**: `domains/exercise.py` — 러닝(페이스, 체중 기반 소모 칼로리 추정, 5K·10K 최고), 헬스(세션·루틴·운동별 마지막 세트·무게 추이), 훈련 프로그램(주차·요일 계획, 진행 중 하나, 기타 항목 직접 체크). 테스트 12개 추가(119 → 131), 총 131개 통과
- **프론트**
  - 운동 탭: 위에 "오늘 할 훈련", 아래 러닝 / 헬스 / 훈련 프로그램 하위 탭
  - 러닝: 기록 입력(시간 `25:30`·`1:05:00`·분), 페이스 미리보기, 이번 주 거리·5K·10K 최고, 주간 12주·월간 6개월 거리 그래프, 최근 기록 수정·삭제
  - 헬스: 루틴 선택(또는 자유 운동)으로 세션 시작 → 지난 기록으로 세트 채움, 루틴 관리, 운동별 최고 무게 그래프
  - 훈련 프로그램: 작성(주차·요일·종류·제목, 마지막 주 복사), 주차별 체크·달성률, 다른 프로그램 진행하기
  - 식단 요약에 운동 소모·순섭취 표시
  - 홈 운동 위젯: 1×1 이번 주 러닝 km / 2×1 오늘 할 훈련 / 2×2 주간 요약 + 프로그램 진행률
- **배포**: dev apply(변경 5, 추가·삭제 0), 프론트 배포

### 결정 메모
- 러닝 소모 칼로리 근사식 `체중 × 거리 × 1.036` (사전 합의). 체중 기록이 없으면 추정하지 않음
- 훈련 프로그램 자동 완료는 "그 날 같은 종류 기록이 있으면 완료" (어떤 러닝·세션인지까지 맞추지 않음)
- 헬스 소모 칼로리는 선택 입력만 (추정하지 않음)

### 트러블슈팅
- 없음

### 다음 할 일
- 5c 확인: 러닝·헬스·프로그램 기록, 오늘 할 훈련 자동 체크, 운동 위젯, 식단 순섭취
- 확인되면 Phase 5 완료 처리 (CLAUDE.md·README·DEVLOG)
- → 사용자가 화면 확인 없이 push, CI 통과. 쓰면서 고치기로 하고 Day 10에 Phase 5 완료 처리

## Day 10 — 2026-10-02 (금)

Phase 5 완료 처리, Phase 6a (작업 보드). AWS 리소스 추가 없음 (shared Lambda·`/boards` 라우트는 Phase 1에 생성됨), dev apply는 Lambda 코드 5개 업데이트만.

### 한 일
- **Phase 5 완료 처리**: CLAUDE.md·README 상태 갱신
- **백엔드**
  - `domains/boards.py` (shared Lambda): 보드 CRUD(기본 컬럼 3개), 멤버 초대 후보·추가·역할 변경·내보내기·나가기, 컬럼(추가·이름·순서·완료 컬럼·삭제 제한), 카드(마크다운 설명·담당자·마감일·우선순위·라벨·체크리스트·링크, 이동)
  - 권한 미들웨어가 요청 모듈 권한(`level`)을 컨텍스트에 함께 넣도록 변경 → 보드에서 "모듈 권한과 보드 역할 중 낮은 쪽" 계산
  - 테스트 9개 추가, 총 140개 통과
- **프론트**
  - `/boards`: 내 보드 목록(역할·진행률·멤버 수), 새 보드 만들기
  - `/boards/:id`: 가로 스크롤 칸반(모바일은 컬럼 단위 스냅), 카드 드래그(PC 마우스, 모바일 길게 누르기), 카드 상세(컬럼·위치 이동, 담당자, 마감일, 우선순위, 라벨, 마크다운 설명 편집/미리보기, 체크리스트, 링크), 컬럼 추가·좌우 이동·설정, 라벨 관리, 멤버 관리, 보드 이름 변경·삭제·나가기
  - 카드 표시: 라벨, 높은 우선순위, 마감일(지남 빨강·3일 이내 주황), 체크리스트 진행, 담당자
  - 보드 화면 30초마다 + 창 복귀 시 새로 불러오기, 카드 이동은 낙관적 업데이트
  - 의존성 추가: `react-markdown`
- **배포**: dev apply(변경 5, 추가·삭제 0), 프론트 배포

### 결정 메모
- 사용자와 합의: 6a/6b 분리, 승인된 계정 목록에서 골라 바로 초대, 모듈 권한과 보드 역할 중 낮은 쪽, 30초 폴링 + 창 복귀 시 갱신
- Host도 멤버가 아닌 보드는 보지 않는다 (공유 보드 내용은 멤버만). 멤버가 아니면 403이 아니라 404로 존재 자체를 숨김
- 순서는 실수 `order` 중간값 방식: 이동할 때 그 카드 한 개만 저장
- 지운 라벨은 카드에서도 제거, 나간 멤버의 담당 카드는 담당자 비움 (참조가 끊긴 데이터를 남기지 않음)

### 트러블슈팅
- 없음

### 다음 할 일
- 6a 확인: 보드 만들기 → 다른 계정 초대(편집자/열람자) → 카드 추가·드래그(PC·폰 길게 누르기)·상세 이동 → 열람자 화면에서 편집 불가
- 6b: 댓글, 활동 기록, 완료 카드 일괄 보관·복구, 필터(라벨·담당자·마감 임박), 보드 템플릿, 즐겨찾기, 홈 보드 위젯

## Day 11 — 2026-10-02 (금)

Phase 6b (작업 보드 나머지). AWS 리소스 추가 없음, dev apply는 Lambda 코드 5개 업데이트만.

### 한 일
- **설계**: DESIGN 7장에 보드 템플릿 키(`USER#<sub>` / `BOARDTPL#<id>`), 멤버 `favorite`·카드 `archived`·활동 `cardId` 속성 추가, 6.6 구현 결정·8.2 API 표 보강
- **백엔드** (`domains/boards.py`)
  - 즐겨찾기(멤버 항목), `GET /boards`에 내 담당 카드(`myCards`)·진행 중 카드 수
  - 템플릿 저장·목록·삭제, 템플릿으로 보드 생성
  - 완료 카드 일괄 보관, 카드별 보관·복구(원래 컬럼 없으면 첫 컬럼), 보관함
  - 활동 기록: 카드 변경 전후 비교로 자동 기록, 보드 전체·카드별 조회
  - 댓글: 작성(편집자 이상), 삭제(본인·소유자), 카드 삭제 시 함께 삭제
  - 보드 조회가 활동 기록(`ACT#`)을 읽지 않도록 정렬 키 범위로 조회 (`SK > "B"`)
  - 테스트 6개 추가(`test_boards_extras.py`), 총 146개 통과
- **프론트**
  - 목록: 즐겨찾기 별(즐겨찾기 먼저), 새 보드 만들 때 템플릿 선택, 내 템플릿 목록·삭제
  - 보드: 즐겨찾기, 필터 바(라벨·담당자·마감 임박, 컬럼에 "보이는 수/전체"), 완료 카드 보관, 보관함(복구·삭제), 활동(카드 제목 누르면 카드 열기), 템플릿으로 저장
  - 카드 상세: 보관 버튼, 댓글 / 활동 탭
  - 홈 작업 보드 위젯: 1×1 내 진행 중 카드 수 / 2×1 내 담당 마감 임박 / 2×2 즐겨찾기 보드 요약
- **배포**: dev apply(변경 5, 추가·삭제 0), 프론트 배포

### 결정 메모 (사용자가 "추천대로"라고 해서 내가 정한 것, DESIGN 6.6 표)
- 1×1 위젯 "진행 중 카드 수" = 내 담당 + 완료 컬럼이 아닌 카드
- 댓글은 편집자 이상만 작성 (모듈 view 계정의 쓰기는 미들웨어에서 막히는 구조와 맞춤)
- 필터 중에는 드래그를 끔: 숨겨진 카드 사이에 순서 값이 들어가 엉뚱한 위치로 가는 것을 막기 위함
- 활동 기록은 DESIGN 키(`ACT#<timestamp>`) 그대로, 카드별은 `cardId` 필터. 같은 요청에서 여러 개를 남길 때 순서가 섞이지 않게 SK에 순번을 붙임
- 템플릿 경로 `/boards/templates`는 `/boards/<bid>`보다 먼저 등록해야 함 (Powertools는 등록 순서대로 매칭)

### 트러블슈팅
**1. 같은 요청의 활동 기록 순서가 뒤섞임**
- 증상: 이동과 담당자 변경을 한 번에 저장하면 활동 순서가 테스트마다 다름
- 원인: 같은 밀리초 타임스탬프 + 랜덤 접미사라 정렬이 랜덤
- 해결: SK를 `ACT#<시각>#<순번 2자리><랜덤>`으로 바꿈

### 다음 할 일
- Phase 6 확인 (완료 기준): 멤버 초대 → 권한별 편집 제한(열람자·모듈 view) → 폰에서 길게 눌러 카드 이동 / 카드 상세 "컬럼·위치"
- 6b 확인: 댓글, 활동, 완료 카드 보관·복구, 필터, 템플릿으로 새 보드, 즐겨찾기, 홈 위젯
- 확인되면 Phase 6 완료 처리 → Phase 7 (메모·가계부·스니펫·링크 허브)
- → 사용자가 화면 확인 없이 push. Phase 6 완료 처리, **폰 확인(길게 눌러 드래그, 컬럼 간 이동 위치, 다이얼로그 크기)은 나중에** 사용자가 직접

## Day 12 — 2026-10-02 (금)

Phase 7 결정 + 7a (메모). AWS 리소스 추가 없음 (TTL은 Phase 1 테이블에 이미 켜져 있음), dev apply는 Lambda 코드 5개 업데이트만.

### 한 일
- **결정** (사용자: "추천대로"): 7a/7b/7c 분리, 휴지통 TTL, 1초 자동 저장, 고정 지출은 가계부 열 때 생성, 예산은 바꾼 달부터 계속 적용, 기본 카테고리, 컬렉션은 폴더식(항목당 하나). DESIGN 6.7~6.9에 기록
- **백엔드**: `domains/notes.py` — 생성(빈 메모 거부)·수정·목록(최근 수정순)·휴지통(`deletedAt` + `ttl` 30일, 30일 지난 것은 숨김)·복구·영구 삭제, 태그 정리(공백 제거·중복 제거). 테스트 7개 추가, 총 153개 통과
- **프론트**
  - `/notes`: 검색(제목·본문·태그, 여러 단어 모두 포함), 태그 필터, 고정 → 최근 수정순, 휴지통 탭(남은 일수, 복구, 영구 삭제)
  - `/notes/:id`, `/notes/new`: 제목(선택), 태그 칩 입력(엔터·쉼표·공백), 고정, 편집/미리보기, 자동 저장(1초 + 백그라운드 전환·화면 이탈 시), 저장 상태 표시, 휴지통으로
  - 새 메모는 첫 저장 때 생성하고 주소만 `/notes/<id>`로 바꿈 (편집 화면 유지)
  - 빠른 추가 "메모" 연결 (입력한 글을 본문으로 저장)
  - 홈 메모 위젯: 1×1 빠른 메모(새 메모 화면) / 2×1 최근 메모 3개 / 2×2 고정 메모
  - `MarkdownView`를 공용 컴포넌트로, `formatTime`을 `lib/dates`로 이동
- **배포**: dev apply(변경 5, 추가·삭제 0), 프론트 배포

### 결정 메모
- 여러 기기에서 같은 메모를 동시에 편집하면 마지막 저장이 이긴다 (충돌 감지 없음, 개인 메모라 단순하게)
- 편집 중인 메모는 다시 불러오지 않는다 (입력 중 내용을 서버 값으로 덮어쓰지 않게). 열 때마다 새로 받음

### 트러블슈팅
**1. test_access 실패 (2개)**
- 원인: 권한 미들웨어 테스트가 "미구현 모듈 경로 → 권한 통과 시 404"로 `/notes`를 쓰고 있었는데 메모가 구현되어 200
- 해결: 영원히 라우트가 없을 경로(`/notes/probe/none/x`)로 바꿈

**2. 보드 댓글·활동 테스트가 가끔 실패 (flaky)**
- 원인: 정렬 키 시각이 밀리초라 연달아 쓴 항목이 같은 시각이 되면 랜덤 접미사로 순서가 정해짐. Windows는 시계 해상도가 약 15ms라 마이크로초로 바꿔도 재현
- 해결: 정렬 키용 시각을 프로세스 안에서 항상 증가하게 만듦(`_sort_ts`, 같거나 작으면 직전 값 + 1µs). Lambda 컨테이너는 요청을 하나씩 처리하므로 운영에서도 같은 컨테이너 안 순서는 보장, 다른 컨테이너끼리는 사람 속도라 문제없음. 10회 반복 통과

### 다음 할 일
- 7a 확인: 새 메모 → 자동 저장 → 목록 → 태그·검색 → 휴지통 → 복구, 빠른 추가 메모, 메모 위젯
- 7b 가계부, 7c 스니펫·링크 허브

## Day 13 — 2026-10-02 (금)

Phase 7b (가계부). AWS 리소스 추가 없음, dev apply는 Lambda 코드 5개 업데이트만.

### 한 일
- **백엔드** (`domains/ledger.py`)
  - 내역 CRUD(월·기간 조회, 날짜 변경 시 키 이동), 월별 합계 + 최근 결제 수단, 전체 기간 검색
  - 카테고리(처음 열면 기본 13개 생성, 유형별 마지막 하나 삭제 불가)
  - 고정 지출 등록·수정·삭제, 가계부를 열 때 오늘까지 빠진 회차 생성(`/recurring/apply`)
  - 예산: `BUDGET#<달>` = 이 달부터 적용, 조회는 그 달 이전 가장 최근 값
  - 테스트 6개 추가, 총 159개 통과 (고정 회차: 31일 → 9월 30일, 미래 회차 미생성, 중복·삭제 회차 재생성 방지, 다음 달 이어서 생성)
- **프론트** (`/ledger`)
  - 달 이동(이번 달 이후로는 못 감, 가운데 누르면 이번 달), 수입·지출·잔액 요약
  - 내역 탭: 입력 폼(지출/수입, 날짜, 금액, 카테고리, 결제 수단 자동완성, 메모), 날짜별 묶음 + 하루 지출 합, 수정·삭제, 고정 회차 표시, 검색, 이 달·올해 CSV
  - 통계 탭: 카테고리 도넛 + 비율, 최근 6개월 수입·지출 막대
  - 예산 탭: 전체·카테고리별 게이지(80% 주황, 초과 빨강), 예산 편집(이 달부터 적용)
  - 고정·카테고리 탭: 고정 지출 목록·편집, 카테고리 추가·이름 변경·순서·삭제
  - 빠른 추가 "지출" 연결 ("점심 12000" → 메모 + 금액, 카테고리 선택)
  - 홈 가계부 위젯: 1×1 이번 달 지출 / 2×1 예산 게이지 / 2×2 카테고리 도넛
- **배포**: dev apply(변경 5, 추가·삭제 0), 프론트 배포

### 결정 메모
- 고정 회차는 "그 달 n일이 오늘 이전일 때"만 생성 (미래 날짜 내역이 미리 잡혀 이번 달 지출이 부풀지 않게)
- 지운 회차를 다시 만들지 않도록 고정 지출에 `lastMonth`(마지막 처리 달)를 저장
- 예산 게이지는 예산을 정한 카테고리만 합산 (예산 없는 카테고리 지출까지 넣으면 게이지 의미가 흐려짐)

### 트러블슈팅
- 프론트 `noUncheckedIndexedAccess` 오류 6건 (배열·객체 인덱스 접근) → 기본값 처리

### 다음 할 일
- 7b 확인: 내역 입력·수정, 고정 지출 등록 후 가계부 다시 열기 → 회차 생성, 예산 게이지, CSV를 엑셀로 열기(한글), 빠른 추가 지출, 가계부 위젯
- 7c 스니펫·링크 허브

## Day 14 — 2026-10-02 (금)

Phase 7c (스니펫·링크 허브). AWS 리소스 추가 없음, dev apply는 Lambda 코드 5개 업데이트만.

### 한 일
- **설계**: DESIGN 7장에 허브 컬렉션 키(`HUBCOL#<id>`)·허브 항목 속성 추가, 6.9 구현 결정·8.2 API 표
- **백엔드** (`domains/hub.py`): 스니펫(언어 14종 + 텍스트)·링크(http/https만) CRUD, 종류별 필수 항목·다른 종류 필드 정리, 태그 정리, 즐겨찾기, 컬렉션 CRUD(삭제 시 항목은 컬렉션 없음). 테스트 4개 추가, 총 163개 통과
- **프론트** (`/hub`)
  - 검색(주소 `?q=`와 연결), 유형·즐겨찾기·컬렉션·태그 필터, 즐겨찾기 먼저
  - 스니펫 카드: 문법 강조 코드 블록 + 오른쪽 위 복사 버튼, 긴 코드는 접기/전체 보기 / 링크 카드: 새 탭 열기 + URL 복사
  - 추가·수정 다이얼로그(종류 고정), 컬렉션 관리 다이얼로그
  - highlight.js core + 14개 언어, 동적 import로 별도 청크(gzip 약 24KB), 라이트·다크 토큰 색 (index.css)
  - 홈 허브 위젯: 1×1 검색창 / 2×1 즐겨찾기 링크 / 2×2 즐겨찾기 스니펫(누르면 복사)
  - 의존성 추가: `highlight.js`
- **배포**: dev apply(변경 5, 추가·삭제 0), 프론트 배포

### 결정 메모
- 종류(스니펫↔링크) 변경은 막음: 필요한 필드가 달라서 새로 만드는 게 단순
- 컬렉션 경로(`/hub/collections`)는 `/hub/<id>`보다 먼저 등록 (보드 템플릿과 같은 이유)
- highlight.js 출력은 코드를 이스케이프한 HTML이라 `dangerouslySetInnerHTML`로 넣어도 안전

### 트러블슈팅
- 없음

### 다음 할 일
- Phase 7 확인 (완료 기준: 각 모듈 CRUD + 홈 위젯): 메모·가계부·허브 각각 만들기·고치기·지우기, 홈에 위젯 추가해 보기
- 확인되면 Phase 7 완료 처리 → Phase 8 공용 체크리스트
- → 사용자: "넘어가자. 마지막에 디자인을 다 바꾸고 그다음 하나하나 써보면서 디벨롭". Phase 7 완료 처리, 실사용 확인은 디자인 개편 뒤로

## Day 15 — 2026-10-02 (금)

Phase 7 완료 처리, Phase 8 (공용 체크리스트). AWS 리소스 추가 없음 (shared Lambda·`/checklists` 라우트는 Phase 1에 생성), dev apply는 Lambda 코드 5개 업데이트만.

### 한 일
- **결정** (사용자: "추천대로"): 멤버·권한은 보드와 동일, 30초 + 창 복귀 + 새로고침 버튼, 이모지 아이콘, 개인 템플릿, 추가순 + 체크 항목 아래, 위젯 범위. DESIGN 6.10·7장·8.2에 기록
- **백엔드**
  - `domains/sharing.py` 신설: 공유 리소스 공통(`Space`: 권한 확인, 멤버 항목, 내 목록, 멤버 이름 붙이기, 후보·추가·역할 변경·내보내기·즐겨찾기 라우트 등록)
  - `domains/boards.py`를 `Space`로 리팩터링 (기존 보드 테스트 15개 그대로 통과)
  - `domains/checklists.py`: 리스트 CRUD, 항목 여러 줄 추가·수정·체크(체크한 사람·시각)·삭제, 체크 항목 일괄 삭제, 전체 체크 해제, 템플릿
  - 테스트 6개 추가, 총 169개 통과
- **프론트**
  - `/checklists`: 리스트 카드(아이콘·진행 막대·남은 항목·멤버 수·역할), 즐겨찾기, 새 리스트(이모지 선택·템플릿), 내 템플릿 목록
  - `/checklists/:id`: 항목 추가(여러 줄 붙여넣기), 크게 누르는 체크 버튼, 체크한 사람·시각, 항목 이름 수정·삭제, 체크 항목 삭제, 전체 체크 해제, 템플릿으로 저장, 이름·아이콘 변경, 새로고침 버튼, 멤버, 삭제·나가기
  - 보드 멤버 다이얼로그를 공용 `SharedMembersDialog`로 바꿔 둘이 같이 씀
  - 홈 체크리스트 위젯: 1×1 남은 항목 수 / 2×1 즐겨찾기 리스트 미리보기(바로 체크)
  - 모든 모듈이 구현돼 `ModulePlaceholderPage`와 위젯·빠른 추가의 "Phase N에서 연결" 표시 제거
- **배포**: dev apply(변경 5, 추가·삭제 0), 프론트 배포

### 결정 메모
- 보드와 체크리스트의 공유 규칙을 한 곳(`sharing.py`)에 둬서 권한 규칙이 갈라지지 않게 함
- 체크 동기화는 ADR-08(실시간 제외) 범위 안에서 보드와 같은 폴링으로. 당겨서 새로고침 대신 새로고침 버튼 (PWA 단독 실행에서도 동작)

### 트러블슈팅
- 공용 멤버 다이얼로그에서 `role` prop과 초대 역할 state 이름이 겹쳐 타입 오류 → prop을 `myRole`로

### 다음 할 일
- Phase 8 확인 (완료 기준: 참여 계정 간 공유 동작): 다른 계정 초대 → 한쪽에서 체크 → 다른 쪽에서 30초 안에 또는 새로고침으로 보임, 체크한 사람 표시
- 그다음 Phase 9 (PWA 설치·업데이트, 보안 점검, prod 배포, 문서 정리)와 디자인 전면 개편 순서 정하기

## Day 16 — 2026-10-02 (금)

디자인 전면 개편 1차. 순서는 사용자 결정(추천): 디자인 개편 → Phase 9. AWS 리소스 추가 없음, dev apply는 Lambda 코드 5개 업데이트만.

### 한 일
- **방향** (사용자 선택): 분위기 따뜻·부드러움, 포인트 파랑, 폰 하단 탭 + PC 사이드바, Pretendard. DESIGN 4.5에 기록
- **색 토큰** (`index.css`): 라이트 미색 바탕·흰 카드, 다크 회갈색 바탕, 파랑 `--primary`, 차트 색 5개, 반경 0.875rem, 카드(`.bg-card.border`)에 부드러운 그림자
- **글꼴**: Geist → Pretendard Variable (dynamic subset, `@fontsource-variable/geist` 제거, `pretendard` 추가)
- **내비게이션** (`AppLayout`): 상단 헤더 제거. PC 왼쪽 사이드바(모듈 색 배지), 폰 하단 탭 5칸(가운데 빠른 추가 버튼 강조), `/menu` 전체 화면
- **설정**: "하단 탭" 카드(가운데 두 칸 모듈 선택). 백엔드 설정에 `navTabs`(서로 다른 모듈 2개) 추가, 테스트 1개 추가, 총 170개 통과
- **모듈 색**: `meta.ts`에 `tone`, `ModuleIcon`·`PageTitle` 컴포넌트. 모듈 화면 제목 8개, 홈 아이콘·위젯 머리에 적용
- 페이지 여백 통일 (`p-4 md:p-6`, 하단 탭 여백은 레이아웃에서)
- **배포**: dev apply(변경 5, 추가·삭제 0), 프론트 배포

### 결정 메모
- 다크모드 바탕은 순검정 대신 따뜻한 회갈색 (따뜻한 분위기 유지)
- 하단 탭 가운데 두 칸만 사용자 선택, 나머지(홈·빠른 추가·전체)는 고정
- 글꼴은 외부 CDN 대신 앱에 포함 (ADR-07 외부 연동 제외)

### 트러블슈팅
- 모듈 메타에 색 추가하는 정규식 스크립트가 줄 패턴을 못 찾음 → 줄 단위 매칭으로 다시 실행
- 페이지 제목 일괄 치환 정규식이 실패 → 문자열 위치(indexOf) 방식으로 교체

### 다음 할 일
- 개편 1차 화면 확인 (PC 사이드바, 폰 하단 탭, 라이트·다크 색, 글꼴)
- 2차: 화면별 다듬기 (로그인·가입 화면, 홈 위젯 카드, 빈 상태 문구·일러스트, 폼 간격) — 사용자 피드백 받아서
- 그다음 Phase 9 (PWA 설치·업데이트, 보안 점검, prod 배포, 문서 정리)

## Day 17 — 2026-10-06 (화)

Phase 9 시작: 9a PWA, 9b 보안 점검, 9c prod 준비. 순서는 사용자 결정(추천): 디자인 개편 → Phase 9. 디자인 세부 수정은 사용자가 따로 요청.

### 한 일
- **결정** (사용자): prod 빈 상태로 시작, main push → dev 자동·prod는 버튼, prod DB 백업(PITR) 켜기, 앱 아이콘은 사용자가 이미지 제공(그전까지 임시 아이콘)
- **9a PWA** (dev 배포)
  - vite-plugin-pwa(prompt), manifest(이름·색·standalone), 서비스워커(앱 껍데기만 미리 받기, 글꼴은 쓸 때 캐시), 새 버전 배너(`UpdateBanner`, 30분마다 + 앱 복귀 시 확인)
  - 임시 아이콘 `public/logo.svg` → `npm run icons`로 PNG·favicon·maskable·apple 아이콘 생성
  - iOS 홈 화면 메타 태그
  - `frontend/scripts/upload-web.sh`: S3 업로드 + 무효화 공용 스크립트(sw.js·manifest·아이콘 no-cache)
- **9b 보안 점검** (DESIGN 9.4)
  - CloudFront 응답 헤더 정책 신설(CSP + HSTS·nosniff·DENY·Referrer), 인라인 테마 스크립트를 `theme-init.js`로 분리. dev apply(추가 1: 응답 헤더 정책, 무료) 후 브라우저에서 홈·캘린더가 CSP 오류 없이 동작 확인
  - 비밀값·계정 ID 스캔(없음), npm audit fix, pip-audit, 권한·로그 검토
- **9c prod 준비**
  - `infra/envs/prod` 생성(삭제 방지·PITR·Cognito 삭제 방지·force_destroy 끔·CORS localhost 제외), plan: 추가 89 / 변경·삭제 0
  - 워크플로우: `portal-deploy-env.yml`(공통) + `portal-deploy.yml`(dev 자동) + `portal-deploy-prod.yml`(수동, 확인란 prod)

### 결정 메모
- CSP connect-src는 API 주소 대신 `*.execute-api.ap-northeast-2.amazonaws.com`: API CORS가 CloudFront 주소를 참조해서 반대로 참조하면 순환 의존
- `style-src 'unsafe-inline'`는 FullCalendar 등 런타임 스타일 때문에 허용(스크립트는 엄격)
- 남은 npm audit 경고(shadcn CLI 의존성)는 빌드 도구라 그대로 둠. 고치려면 shadcn 1.0으로 내려야 해서 오히려 위험

### 트러블슈팅
**1. 아이콘에 글자가 안 그려짐**
- 원인: 아이콘 생성기(sharp)가 SVG의 `<text>` 글꼴을 못 찾음
- 해결: 'P'를 path 도형으로 그림
**2. pip-audit이 requirements 파일을 못 읽음 (cp949)**
- 해결: `PYTHONUTF8=1`로 실행

- **prod apply** (사용자 승인 "prod apply 해"): 추가 89 / 변경·삭제 0. prod 프론트 배포, 웹 200·API /health 200, PITR ENABLED·삭제 방지 확인

- **dev/prod 구분**: 인증 앱(OTP)에 등록되는 이름을 환경별로(prod "Personal Portal", dev "Personal Portal (dev)"), dev 사이트에 DEV 배지·탭 제목 [DEV]. `VITE_APP_ENV`(CI가 환경 이름으로 넣음, 없으면 dev). 이미 등록한 항목은 그대로라 인증 앱에서 이름 수정 또는 MFA 다시 등록 (사용자 요청: 둘 다 같은 이름이라 헷갈림)

- **앱 아이콘 교체**: 사용자 제공 이미지로. 바깥 어두운 테두리가 폰 아이콘 모양과 겹쳐 이중 테두리가 되지 않게 안쪽 둥근 사각형만 잘라 모서리를 투명 처리, maskable·apple은 여백 없이(바탕색 #1d1d21). 사이드바 로고도 교체, 임시 `logo.svg` 삭제
  - 사용자 지적: 아이콘을 준다고 했는데 확인 없이 임시 아이콘(파랑 + P)을 넣음 → 사용자가 주기로 한 자산은 임의로 채우지 말고 먼저 확인할 것

- **폰 화면 수정** (사용자가 폰 PWA로 확인: 글자·위젯 잘림)
  - 홈: 폰에서 칸 너비 약 75px에 줄 높이도 같아 1줄 위젯이 75px → 칸 너비 100px 미만이면 줄 높이 1.4배, 위젯 안쪽 여백 축소 (`SectionGrid`, `ItemCard`)
  - 캘린더: 공휴일 배경 이벤트에도 제목이 있어 칸 왼쪽 위에 한 번 더 찍히며 날짜 숫자와 겹침 → 배경용은 제목 없이. 월 보기는 날짜 숫자만("5일"→"5"), 일정 글자 폰 10px + 말줄임 (FullCalendar v7은 클래스 이름이 해시라 CSS 대신 `views.dayGridMonth`의 `dayCellTopContent`·`eventContent`)
  - dev 배포. PC에서 확인, 폰 확인은 사용자

- **폰 화면 자동 점검 도구** (사용자: 폰으로 하나씩 캡처해 옮기기 어려움 → 방법 요청)
  - mock 모드(`npm run dev:mock`): 로그인·API 없이 가짜 데이터(긴 제목·많은 항목 포함)로 앱 실행. 배포 빌드에는 mock 코드 미포함 확인
  - `npm run screens`: 31개 화면·다이얼로그 × 아이폰 390px·안드로이드 360px 캡처 + 자동 검사 → `.screens/report.txt`
  - iPhone Safari 엔진(WebKit)은 Windows에 필요한 라이브러리가 없어 실행 불가 → 알려진 iOS 문제는 CSS로 일괄 보정
- **점검으로 찾아 고친 것**
  - **홈·허브 페이지가 화면보다 넓게 잡힘(634·661px)**: 열 지정 없는 grid가 긴 내용만큼 늘어남 → 전역 `minmax(0,1fr)`. 이 때문에 홈 하단 탭 + 버튼이 위젯에 가려 눌리지 않던 것도 해결
  - iOS: 16px 미만 입력칸 누르면 확대된 채 남음 → 폰에서 입력 글자 16px. 날짜·시간 입력 최소 너비로 옆 칸과 겹침 → 줄어들게
  - 할 일 목록 긴 제목이 화면 밖으로, 홈 "오늘 일정 N개" 세 줄로 깨짐, 가계부 위젯 금액 줄바꿈 겹침, 카드 링크 입력칸, 허브 복사 버튼이 코드 가림, 차트 y축 숫자 잘림(음수 여백)
  - 캘린더: 폰은 주 보기 대신 3일 보기(`buttons`로 이름), 7시로 스크롤, 목록 보기 긴 제목 줄바꿈
  - 라이트·다크 모두 자동 검사 통과(주 보기 일정 말줄임은 의도)

### 다음 할 일
- 폰(dev)에서 홈·캘린더·새 일정 확인 → prod 반영
- prod에서 Host 이메일로 가입, prod SNS 구독 확인 메일 Confirm → 폰 홈 화면 설치 확인 (Phase 9 완료 기준)
- 사용자 앱 아이콘 받으면 교체
- 9d 문서 정리

