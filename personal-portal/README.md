# Personal Portal

개인 겸 가족·팀 공유용 통합 포털 PWA. 웹과 모바일 홈 화면 앱으로 사용한다.

로그인한 사용자만 접근할 수 있고, Host(관리자)가 가입을 승인하며 모듈별 열람·편집 권한을 부여한다. 홈은 모든 콘텐츠의 아이콘과 위젯이 모인 카드형 대시보드이며, 레이아웃은 사용자별로 편집·저장된다.

## 상태

- 2026-09-28: 설계 확정, 구현 전 (Phase 0 대기)

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
├─ .github/workflows/     portal-*.yml (Phase 0~1에서 생성, 레포 최상단에만 둠)
└─ personal-portal/
   ├─ docs/DESIGN.md      설계 문서 (전체 결정 사항, ADR, 데이터 모델, 로드맵)
   ├─ frontend/           (Phase 1에서 생성)
   ├─ backend/            (Phase 1에서 생성)
   ├─ infra/              (Phase 0~1에서 생성)
   ├─ README.md
   └─ DEVLOG.md
```

GitHub Actions는 레포 최상단 `.github/workflows/`만 인식하므로 워크플로우는 `personal-portal/` 안에 두지 않는다. `paths: personal-portal/**` 필터로 이 프로젝트 변경 시에만 실행한다.

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
