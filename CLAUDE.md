# side-projects 공통 규칙

여러 사이드 프로젝트를 폴더 단위로 관리하는 모노레포.

## 작업 시작 전 필수
- 작업 대상 프로젝트 폴더의 `CLAUDE.md`를 **반드시 먼저 읽는다** (예: `personal-portal/CLAUDE.md`)
- 해당 프로젝트의 `README.md`, `DEVLOG.md`로 현재 상태를 파악한 뒤 작업한다

## 프로젝트 목록
| 폴더 | 설명 |
|---|---|
| `personal-portal/` | 개인·가족·팀 공유용 통합 포털 PWA (AWS 서버리스) |
| `dawaga/` | 약속 시간 한정 위치 공유 앱 |
| `career-consultant/` | AI 커리어 컨설팅 서비스 (AWS Bedrock Agent) |
| `sojung/` | 재고·임대장비·미수금 관리 앱 |
| `megathon-2026/` | 폴더 README 참고 |
| `diet-tracker/` | **별도 레포**(`leehyeonhaeng/diet-tracker`), 이 레포에서 추적하지 않음 (.gitignore 처리됨). 건드리지 않는다 |

## 개발 환경
- OS: Windows (터미널: cmd / PowerShell)
- Node.js v24.14.0 / npm v11.9.0 / Git v2.53.0
- Python 3.12
- IDE: VSCode
- AWS CLI 설치됨, 기본 리전 `ap-northeast-2` (서울)
- 셸 명령은 Windows 기준으로 작성한다 (bash 전용 문법 금지, 경로 구분자 주의)

## 소통 방식
- 한국어, 반말. 결론·핵심부터 제시하고 설명은 최소화
- 확실하지 않은 정보는 말하지 않는다. 모르면 확인하고 답한다
- 애매한 선택지는 하나만 고르지 말고 옵션을 모두 보여준 뒤 추천을 표시한다
- 에러·로그를 받으면 되묻지 말고 원인부터 분석한다
- 같은 해결책을 반복 제안하지 않는다. 근본 원인을 먼저 파악한다
- 불필요한 작업을 유도하지 않는다

## Git 규칙
- **커밋·푸시는 사용자가 직접 한다.** Claude는 변경 요약과 커밋 메시지, 실행할 명령어만 제안한다
- 커밋 컨벤션: `feat` / `fix` / `chore` / `docs` / `refactor`
- `git add .` 대신 **경로를 지정**해서 제안한다 (예: `git add personal-portal/`). 다른 프로젝트 변경이나 `diet-tracker` 같은 중첩 레포가 섞이는 것을 막기 위함
- 비밀값(.env, 키, 비밀번호, 토큰)은 절대 커밋하지 않는다. 커밋 제안 전에 포함 여부를 확인한다
- GitHub Actions 워크플로우는 레포 최상단 `.github/workflows/`에만 둔다 (하위 폴더의 `.github`는 인식되지 않음). 파일명은 프로젝트 접두사를 붙인다 (예: `portal-deploy.yml`)

## AWS 규칙
- AWS 문제는 진단용 코드를 작성·반복 실행하지 말고, **AWS 콘솔에서 확인할 위치와 항목을 안내**한다
- 리소스 생성·변경·삭제 명령은 실행 전에 무엇이 바뀌는지 설명하고 승인을 받는다

## 문서 규칙
- 작업 종료 시 해당 프로젝트의 `DEVLOG.md`(오늘 한 일, 날짜별 누적)와 `README.md`를 업데이트한다
- 코드 작성 중 중요한 결정, 제약, 트러블슈팅은 반드시 `DEVLOG.md` 또는 `README.md`에 기록한다
- 프로젝트 구조는 각 프로젝트 `README.md`에서 관리한다