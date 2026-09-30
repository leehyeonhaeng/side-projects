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