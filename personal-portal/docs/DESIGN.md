# Personal Portal 설계 문서

> 개인 겸 가족·팀 공유용 통합 포털 PWA (웹 + 모바일 홈 화면 앱)
> 작성일: 2026-09-28 / 상태: 설계 확정, 구현 전

---

## 1. 컨셉

로그인한 사람만 들어오는, Host(나)가 최고 관리자인 **개인 겸 공유용 통합 포털**.
로그인 후 홈은 모든 콘텐츠 아이콘과 위젯이 카드형으로 모인 대시보드이고, 위젯과 레이아웃은 사용자가 편집할 수 있다.

| 항목 | 확정 내용 |
|---|---|
| 성격 | 개인 생활 + 업무 혼합 |
| 사용자 | Host(최고 관리자) + 가입 승인된 가족·팀 |
| 권한 | 모듈별로 계정마다 `없음 / 열람 / 편집` 부여 |
| 가입 | 가입 신청 → 이메일 인증 → 비활성(승인 대기) → Host 승인 시 활성화 |
| 로그인 | 자체 이메일 + 비밀번호 (소셜 로그인 없음) |
| 홈 | 아이콘 + 위젯을 한 그리드에 자유 배치, 섹션 구분 |
| 앱 형태 | PWA (홈 화면 추가), 푸시 알림 없음, 오프라인 불필요 |
| 동기화 | 기기 간 동기화 (서버 저장) |
| 외부 연동 | 없음 (주식·환율·스포츠·외부 캘린더 제외) |
| UI | 미니멀 카드형, 위젯 커스터마이징, 레이아웃 편집, 다크모드 |
| 비용 | 월 1만 원 이하 |
| 도메인 | CloudFront 기본 주소 사용 |
| 일정 | ASAP, 단계별 진행 |

---

## 2. 아키텍처

```
[PWA 브라우저/홈 화면 앱]
   │
   ├── CloudFront ── S3 (정적 웹, OAC로 비공개 버킷)
   │
   └── API Gateway (HTTP API, Cognito JWT Authorizer)
          │
          ├── Lambda: admin     ── Cognito 관리 API
          ├── Lambda: personal  ┐
          ├── Lambda: shared    ├── DynamoDB (단일 테이블)
          └── Lambda: ai        ┘── Bedrock (Claude, 칼로리 추정)

Cognito User Pool ── Post Confirmation 트리거 Lambda ── SNS (Host에게 가입 알림 메일)

[GitHub] ── GitHub Actions (OIDC) ── Terraform apply / Lambda 배포 / S3 업로드 + CloudFront 무효화
```

- 리전: `ap-northeast-2` (서울)
- 환경: `dev`, `prod` 두 개

### 2.1 기술 스택 (현업 사용 비중 기준)

| 영역 | 선택 |
|---|---|
| 프론트엔드 | React + TypeScript + Vite |
| IaC | Terraform (HCL) |
| Lambda | Python |
| UI | Tailwind CSS + shadcn/ui |
| 라우팅·서버 상태 | React Router, TanStack Query |
| 홈 위젯 그리드 | react-grid-layout |
| 칸반 드래그 | dnd-kit |
| 캘린더 | FullCalendar |
| 차트 | Recharts |
| 인증 클라이언트 | Amplify Auth (Cognito 연동 부분만) |
| PWA | vite-plugin-pwa |
| 백엔드 공통 | Powertools for AWS Lambda (Python), Pydantic, boto3 |

---

## 3. 설계 결정 기록 (ADR)

### ADR-01. 데이터 저장소: GitHub 저장 대신 AWS 서버리스

GitHub repo를 DB처럼 쓰는 방식을 검토했으나 아래 이유로 제외했다.

1. 브라우저에서 저장하려면 쓰기 토큰이 클라이언트에 노출된다. 로그인한 누구나 전체 데이터를 수정할 수 있게 된다.
2. "이 계정은 열람만" 같은 권한 규칙을 강제할 서버가 없다. 클라이언트 측 차단은 우회 가능하다.
3. 비밀번호 검증, 가입 승인 상태 관리를 할 곳이 없다.
4. 동시 수정 시 커밋 SHA 충돌이 나고, 조회·필터 쿼리가 불가능하다.
5. 삭제한 데이터도 커밋 히스토리에 남는다.

결론: 인증·권한·승인 요구사항 때문에 서버 측 검증이 필수 → Cognito + API Gateway + Lambda + DynamoDB 서버리스 구성.

### ADR-02. 백엔드 플랫폼: AWS 선택

Supabase(무료, RLS로 권한 처리가 깔끔), Cloudflare Workers + D1(무료)도 후보였다.
AWS는 초기 세팅량이 가장 많지만 월 비용이 소규모 사용 기준 무료 범위에 가깝고, SA 업무와 직결되어 학습·포트폴리오 가치가 가장 높아 선택했다.

### ADR-03. 스택: 업계 표준 조합 (Terraform + Python)

AWS CDK + TypeScript로 언어를 통일하는 안도 있었으나, 현업 사용 비중과 범용성(멀티클라우드)을 우선해 Terraform + Python을 택했다. 프론트엔드는 어느 쪽이든 React + TypeScript.
Next.js 대신 Vite를 쓴 이유: S3 정적 호스팅 구조에서는 서버 렌더링이 필요 없다.

### ADR-04. DynamoDB 단일 테이블 설계

모든 엔티티를 테이블 1개에 PK/SK 패턴으로 저장한다. 날짜를 SK에 포함해 기간 조회를 쿼리 1회로 처리하고, GSI 1개를 여러 조회 패턴에 재사용한다.

### ADR-05. Lambda 도메인별 분리 (최소 권한)

Lambda를 도메인별 4개 + Cognito 트리거 1개로 나눈다. Bedrock 호출 권한은 `ai` Lambda에만, Cognito 관리 권한은 `admin` Lambda에만 부여한다.

### ADR-06. 칼로리 계산: AI 추정 (Bedrock)

식약처 영양성분 DB 내장, AI 추정, 혼합 방식 중 AI 추정을 선택했다. 비정형 음식명도 처리 가능하고 구현이 단순하다. 결과는 "추정치"로 표시하고, 자주 먹는 음식은 "내 음식"으로 저장해 재호출을 줄인다.

### ADR-07. 외부 연동 전면 제외

주식(증권사 토큰 매일 재발급, 장 운영시간 처리), 스포츠(6개 리그 커버 시 유료 API 필요), 외부 캘린더(OAuth 토큰 관리)는 유지보수 부담 대비 효용이 낮아 제외했다. 필요 시 모듈로 추가한다.

### ADR-08. 공용 체크리스트 실시간 동기화 제외

WebSocket 인프라 추가 대신 "앱 열 때 + 당겨서 새로고침" 방식으로 처리한다.

---

## 4. 공통 기반

### 4.1 로그인·가입

| 항목 | 결정 |
|---|---|
| 로그인 ID | 이메일 |
| 가입 정보 | 이름, 이메일, 비밀번호, 가입 메모 1줄 |
| 이메일 인증 | 필수 |
| 승인 대기 처리 | 이메일 인증 완료 시 계정을 **비활성화** → Host가 승인 시 활성화 |
| 가입 알림 | 관리자 화면 배지 + SNS 이메일 알림 |
| Host MFA | TOTP(OTP 앱) 적용. Host 계정은 첫 로그인 시 MFA 등록을 앱에서 강제 |
| 토큰 | Access/ID 1시간(백그라운드 자동 갱신), Refresh 30일 |
| 재로그인 | 로그인 시점부터 30일 후 1회 재로그인 (재가입 아님) |
| 비밀번호 찾기 | Cognito 기본 기능 (이메일 코드) |
| 비밀번호 규칙 | 8자 이상, 소문자·숫자·특수문자 필수 (대문자 선택) |
| 사용자 속성 | 필수 `email`, `name` / 선택 `custom:signup_note`(가입 메모, 200자). 생성 후 변경 불가 |
| 요금제·메일 | Cognito Lite, 인증 메일은 Cognito 기본 발송(하루 50통) |

**가입 처리 흐름**

```
1. 사용자 가입 신청 (Cognito SignUp)
2. 이메일 인증 코드 입력 (ConfirmSignUp)
3. Post Confirmation 트리거 Lambda
   - AdminDisableUser (로그인 차단)
   - DynamoDB PROFILE 생성 (status = pending)
   - SNS로 Host에게 알림 메일
4. Host가 관리자 화면에서 승인 + 권한 프리셋 선택
   - AdminEnableUser
   - status = active, PERM# 항목 생성
5. 사용자 로그인 가능
```

비활성 계정이 로그인하면 Cognito가 "User is disabled"를 반환 → 프론트에서 "승인 대기 중이거나 정지된 계정입니다" 안내.

**계정 정지**: `AdminDisableUser` + `AdminUserGlobalSignOut`(refresh 토큰 즉시 폐기) + status = suspended. 이미 발급된 access token(최대 1시간)은 API 권한 미들웨어가 매 요청 status를 확인해서 즉시 차단한다. 정지 해제(재활성)는 `AdminEnableUser` + status = active.

**첫 Host 계정**: Terraform 변수 `host_email`(레포에 남기지 않음, 로컬 tfvars / CI Secret)과 같은 이메일로 가입하면 Post Confirmation 트리거가 비활성화 대신 host 그룹 추가 + status active + 전체 권한을 준다.

**거절·삭제**: 거절은 Cognito 사용자 + PROFILE 삭제(같은 이메일로 재가입 가능). 삭제는 Cognito 사용자 + `USER#<sub>` 전체 + 공유 리소스 멤버십(`GSI1PK=USER#<sub>`) 삭제. 둘 다 활동 로그에는 남긴다.

**이메일 대소문자**: 풀은 사용자 이름(이메일) 대소문자를 무시한다(`case_sensitive = false`, 생성 후 변경 불가). 프론트도 저장·표시 일관성을 위해 소문자로 바꿔 보낸다.

### 4.2 권한 모델

| 항목 | 결정 |
|---|---|
| 역할 | Host / Member (Cognito 그룹 `host`) |
| 권한 단위 | 모듈별 `none / view / edit` |
| 데이터 소유 | 모듈마다 지정 (7장 참고) |
| 권한 없는 모듈 | 홈에서 숨김 |
| 권한 프리셋 | 제공 (예: "가족", "팀"). 승인 시 선택 |
| 캘린더 권한 | `사용 가능 / 불가`만 (자기 일정만 다루므로) |

**API 권한 검사 순서** (Lambda 공통 미들웨어)

1. API Gateway에서 Cognito JWT 검증 (서명, 만료)
2. Lambda에서 PROFILE status = active 확인
3. 요청 모듈의 PERM 확인 (조회는 view 이상, 변경은 edit)
4. 공유 리소스(보드, 체크리스트)는 멤버 여부와 멤버 역할 확인

### 4.3 홈 대시보드

| 항목 | 결정 |
|---|---|
| 구성 | 아이콘과 위젯을 한 그리드에 자유 배치 |
| 위젯 크기 | 1×1, 2×1, 2×2 |
| 섹션 | 업무·생활 등 섹션 구분 |
| 레이아웃 저장 | 사용자별 서버 저장 (기기 간 동기화) |
| 편집 | 편집 모드에서 드래그 배치, 크기 변경, 숨기기 |
| 다크모드 | 시스템 설정 따라가기 + 수동 토글 (사용자별 저장) |

**구현 결정 (Phase 3)**

| 항목 | 결정 |
|---|---|
| 그리드 | 모든 기기 4칸 고정 (PC는 가운데 일정 폭). 어느 기기에서 편집해도 배치가 같다 |
| 섹션 | 섹션마다 독립 그리드를 위아래로 배치. 다른 섹션으로는 "섹션 이동"으로 옮긴다. 섹션 추가·이름 변경·순서 변경, 빈 섹션만 삭제 |
| 크기 변경 | 리사이즈 핸들 대신 버튼으로 위젯이 지원하는 크기를 순환 (1×1 → 2×1 → 2×2). 아이콘은 1×1 고정 |
| 드래그 | 손잡이로만 끈다 (편집 중에도 화면 스크롤 가능) |
| 기본 레이아웃 | 저장된 레이아웃이 없으면 권한 있는 모듈로 생성: 업무(할 일·일정 위젯, 보드·메모·허브 아이콘), 생활(식단·가계부 위젯, health·가계부·체크리스트 아이콘) |
| 권한 연동 | 권한 없는 모듈 항목은 화면에서 빠지고 저장 데이터에는 남는다 (권한을 다시 받으면 원래 자리로) |
| 중복 | 같은 모듈 아이콘·같은 종류 위젯은 하나씩만 |
| 동시 편집 | 마지막 저장이 이긴다. 화면 포커스 때마다 서버에서 다시 받는다 |
| 위젯 내용 | 각 모듈 Phase에서 실제 데이터로 채운다 (지금은 크기별 표시 예정 내용만) |

### 4.4 관리자 화면 (Host 전용)

- 승인 대기 목록: 승인(프리셋 선택) / 거절
- 계정 목록: 상태 필터(대기·활성·정지), 정지, 삭제, 비밀번호 초기화
- 권한 매트릭스: 사용자 × 모듈 표에서 권한 변경
- 권한 프리셋 관리
- 활동 로그: 로그인(Cognito Post Authentication 트리거), 권한·계정 변경(승인·거절·정지·재활성·삭제·비밀번호 초기화·권한 변경)만 기록
- 관리자 API는 host 그룹 + TOTP MFA 등록 여부(AdminGetUser, 5분 캐시)까지 확인한다

---

## 5. 화면 구조 (IA)

```
/login, /signup              로그인·가입
/                            홈 (아이콘 + 위젯 그리드, 편집 모드)
├─ /calendar                 캘린더 (월·목록)
├─ /todo                     할 일 (오늘·예정·전체·완료)
├─ /health                   식단 | 체중 | 운동 (탭)
├─ /boards                   작업 보드 목록
│   └─ /boards/:id           칸반
├─ /notes                    메모 목록
│   └─ /notes/:id            메모 편집
├─ /ledger                   가계부 (내역·요약·통계)
├─ /hub                      스니펫·링크 허브
├─ /checklists               공용 체크리스트 목록
│   └─ /checklists/:id
├─ /settings                 프로필, 테마, 목표치, 비밀번호, MFA
└─ /admin                    관리자 (Host만)
```

**모바일 하단 바**: 홈 / 빠른 추가(+) / 설정
빠른 추가: 어느 화면에서든 할 일, 식단, 지출, 메모를 바로 입력.

---

## 6. 모듈 상세

### 6.1 캘린더

| 항목 | 결정 |
|---|---|
| 방식 | 포털 자체 캘린더 (외부 연동 없음) |
| 공개 범위 | 각자 자기 일정만. Host도 타인 일정 열람 불가 |
| 보기 | 월 + 목록 (주는 선택) |
| 일정 항목 | 제목, 날짜·시간, 종일 여부, 장소, 색상·카테고리, 메모 |
| 반복 | 매일·매주·매월·매년 |
| 알림 | 앱 열었을 때 "오늘 일정" 표시만 |
| 공휴일 | 연도별 한국 공휴일 정적 데이터 |
| 검색 | 제목·메모 |
| 공유 | 없음 |
| 겹쳐 보기 | 할 일·작업 보드 마감일을 읽기 전용으로 표시 |

**구현 결정 (Phase 4)**

| 항목 | 결정 |
|---|---|
| 보기 | 월 + 주 + 목록 (FullCalendar v7) |
| 반복 저장 | 규칙만 저장(`EVENTR#<id>`)하고 조회 기간에 맞춰 서버에서 펼친다. 매월·매년은 없는 날짜(31일, 2/29)를 건너뜀 |
| 반복 수정·삭제 | "이 일정만"(그 날짜를 exdates에 넣고 단일 일정으로 분리, seriesId 기록) / "전체"(시리즈 수정·삭제, 분리된 일정도 같이 삭제). 전체 수정에서는 날짜를 바꾸지 않는다 (이전 회차 유실 방지) |
| 여러 날 일정 | 최대 62일. 기간 조회는 62일 앞부터 읽어 겹치는 일정을 찾는다 |
| 시간대 | 한국 시간 달력 날짜(`YYYY-MM-DD`)·시각(`HH:mm`) 문자열 그대로 저장 |
| 공휴일 | `@hyunbinseo/holidays-kr` 패키지 내장 데이터 (관보 기준, 외부 호출 없음). 패키지에 없는 연도는 표시 안 함 |
| 오늘 일정 알림 | 홈 상단에 오늘 일정 수·첫 일정 표시 |
| 홈 위젯 | 오늘 일정 / 이번 주 일정 / 미니 월간 달력 |

### 6.2 할 일

**화면**

| 탭 | 내용 |
|---|---|
| 오늘 | 오늘 마감 + 마감 지난 것 (빨간색 강조) |
| 예정 | 날짜별 그룹 |
| 전체 | 목록(리스트)별 |
| 완료 | 완료 항목, 복구 가능 |

**항목**: 제목, 메모, 마감일(날짜 또는 날짜+시간), 우선순위(높음·보통·낮음), 목록(직접 생성), 반복(매일·매주 요일 선택·매월·평일), 하위 체크리스트

**기능**
- 빠른 추가: 제목만 입력 후 엔터 → 오늘 날짜로 생성
- 스와이프: 오른쪽 완료, 왼쪽 내일로 미루기
- 정렬: 마감일순 / 우선순위순 / 직접 순서
- 반복 할 일은 완료 시 다음 회차 자동 생성
- 작업 보드와는 별개 (연결 없음)

**구현 결정 (Phase 4)**
- 반복에는 마감일이 필요하다. 완료하면 다음 회차를 만들고 반복 규칙을 다음 회차로 넘긴다 (완료한 항목은 반복 없음 + `nextId`). 완료를 되돌려도 다음 회차는 그대로 남는다
- 앞으로의 회차는 실제 항목이 아니라 미리보기로만 보여준다 (`GET /todos/due`의 `projected`, 오늘 이후). 캘린더 ↻ 흐리게, 예정 탭 점선 행
- 마감일은 "첫 회차 날짜", 시간은 매 회차에 복사. 매주 반복에서 첫 회차 요일이 고른 요일과 달라도 그대로 둔다 (이번 주만 다른 요일 가능)
- 매월 반복은 원래 날짜(`monthDay`)를 기억해서, 짧은 달은 말일로 당기고 다음 달에 원래 날짜로 돌아간다
- 요일은 ISO 기준(월=1 … 일=7)
- "내일로 미루기"는 오늘 기준 내일로 마감일을 바꾼다
- 직접 순서는 `order` 실수값. 드래그로 놓은 자리 앞뒤 값의 중간으로 바꾼다
- 완료 탭은 최근 200개까지

**홈 위젯**: 1×1 남은 개수 / 2×1 오늘 할 일 3개 / 2×2 오늘 + 지연 + 빠른 추가

### 6.3 식단 (health 모듈 탭 1)

**화면**
- 오늘: 섭취 칼로리 / 목표 대비 게이지, 탄·단·지 비율, 끼니별 카드(아침·점심·저녁·간식)
- 입력: 한 줄 입력창 + "AI 계산" 버튼
- 기록: 날짜별 목록, 주간·월간 평균 칼로리 그래프
- 내 음식: 저장 음식 관리

**입력 방식**

| 방식 | 용도 | AI 호출 |
|---|---|---|
| AI 추정 | 영양정보 모를 때 | O |
| 직접 입력 | 포장지 라벨 있을 때 (100g당 또는 1회 제공량당) | X |
| 내 음식 | 자주 먹는 것 | X |

**AI 추정 흐름**

```
1. 입력: "현미밥 200g, 닭가슴살 150g, 김치 50g"
2. ai Lambda → Bedrock Claude(Haiku 계열)
3. 음식별 { name, grams, kcal, carb, protein, fat } JSON 반환
4. 확인 카드에서 수정 가능 → 저장
5. "내 음식에 추가" 체크 시 다음부터 자동완성
```

- 모델 ID는 구현 시 서울 리전 사용 가능 여부(교차 리전 추론 프로필 포함)를 콘솔에서 확인 후 확정
- 호출 상한: 계정당 하루 50회 (`AIUSAGE#<날짜>`, TTL 자동 삭제)
- AI 결과는 "추정치" 표시

**기록 항목**: 날짜, 끼니, 음식명, 그램, 칼로리, 탄·단·지, 입력 방식, 메모
**목표**: 목표 칼로리·탄단지 직접 설정
**부가 기능**: 어제 식단 복사, 끼니 조합 저장
**요약**: 섭취 칼로리 − 운동 소모 칼로리 = 순섭취량 표시

### 6.4 체중 (health 모듈 탭 2)

- 요약 카드: 현재, 목표, 남은 차이, 지난주 대비 변화
- 그래프: 일별 체중 + 7일 이동평균선, 기간 필터(1개월·3개월·전체)
- 항목: 날짜, 체중, 체지방률(선택), 골격근량(선택), 메모
- 인바디 수치는 입력한 날만 점으로 표시

### 6.5 운동 (health 모듈 탭 3)

**러닝**
- 입력: 날짜, 거리(km), 시간, 유형(이지런·인터벌·템포·장거리), 체감 강도(1~10), 메모
- 자동 계산: 페이스(분/km), 소모 칼로리 추정(체중 × 거리 기반), 주간 누적 거리
- 화면: 주간·월간 거리 그래프, 5K·10K 최고 페이스

**헬스**
- 루틴 템플릿 (예: 상체 A, 코어)
- 입력: 루틴 선택 → 운동별 세트·횟수·무게
- 지난 기록 자동 채우기
- 운동별 무게 추이 그래프
- 소모 칼로리는 선택 입력

**훈련 프로그램**
- 주차·요일별 계획을 앱에서 직접 입력
- 오늘 할 훈련 표시, 기록 입력 시 자동 완료 체크
- 주차별 달성률

**health 홈 위젯**

| 위젯 | 1×1 | 2×1 | 2×2 |
|---|---|---|---|
| 식단 | 오늘 칼로리 | 게이지 + 탄단지 | 끼니 요약 + 빠른 입력 |
| 체중 | 현재 체중 | 7일 추세 | 1개월 그래프 + 목표 |
| 운동 | 이번 주 러닝 거리 | 오늘 할 훈련 | 주간 요약 + 프로그램 진행률 |

### 6.6 프로젝트 작업 보드 (칸반)

**구조**: 보드 → 컬럼 → 카드
- 기본 컬럼: 할 일 / 진행 중 / 완료 (추가·이름 변경·순서 변경 가능)
- 보드마다 멤버 초대: 열람자 / 편집자

**카드 항목**: 제목, 설명(마크다운), 담당자, 마감일, 우선순위, 라벨(색상), 체크리스트, 관련 링크 (파일 첨부 없음)

**기능**

| 기능 | 내용 |
|---|---|
| 카드 이동 | PC 드래그 / 모바일 길게 눌러 드래그 + "이동" 메뉴 |
| 필터 | 라벨, 담당자, 마감 임박 |
| 댓글 | 카드별 댓글 |
| 활동 기록 | 카드별 변경 이력 |
| 보관 | 완료 카드 일괄 보관, 복구 |
| 보드 템플릿 | 컬럼 구성 저장 |
| 진행률 | 완료 카드 비율 |

**홈 위젯**: 1×1 진행 중 카드 수 / 2×1 내 담당 마감 임박 / 2×2 즐겨찾기 보드 요약

### 6.7 메모·노트

- 항목: 제목, 본문(마크다운), 태그, 고정(핀), 생성·수정일
- 화면: 목록(핀 → 최근 수정순), 편집(편집·미리보기 전환)
- 기능: 태그 필터, 검색, 자동 저장, 휴지통(30일 후 영구 삭제)
- 이미지 첨부 없음
- 홈 위젯: 1×1 빠른 메모 / 2×1 최근 메모 3개 / 2×2 고정 메모

### 6.8 가계부

- 항목: 날짜, 수입·지출, 금액, 카테고리(편집 가능), 결제 수단(직접 입력), 메모
- 화면: 월별 내역, 월간 요약(수입·지출·잔액), 카테고리 원형 차트, 월별 추이
- 기능: 고정 지출 매월 자동 생성, 카테고리별 월 예산 + 초과 표시, 검색, CSV 내보내기
- 홈 위젯: 1×1 이번 달 지출 / 2×1 예산 게이지 / 2×2 카테고리 차트

### 6.9 스니펫·링크 허브

- 유형: 스니펫(코드·명령어) / 링크(문서·콘솔·위키 URL)
- 스니펫 항목: 제목, 언어, 코드, 설명, 태그
- 링크 항목: 제목, URL, 설명, 태그
- 기능: 원탭 복사, 문법 강조, 태그·유형 필터, 검색, 즐겨찾기, 컬렉션
- 개인 전용
- 홈 위젯: 1×1 검색창 / 2×1 즐겨찾기 링크 / 2×2 즐겨찾기 스니펫

### 6.10 공용 체크리스트

- 구조: 리스트 → 항목
- 리스트 설정: 이름, 참여 계정(편집자·열람자), 아이콘
- 항목: 내용, 체크 여부, 체크한 사람·시각
- 기능: 체크 항목 아래 정렬, 체크 항목 일괄 삭제, 리스트 템플릿, 전체 체크 해제
- 동기화: 앱 열 때 + 당겨서 새로고침
- 홈 위젯: 1×1 남은 항목 수 / 2×1 즐겨찾기 리스트 미리보기

---

## 7. 데이터 모델 (DynamoDB 단일 테이블)

테이블명: `portal-<env>` / 키: `PK`, `SK` / GSI: `GSI1` (`GSI1PK`, `GSI1SK`) / TTL 속성: `ttl`

### 7.1 개인 데이터 (`PK = USER#<sub>`)

| 데이터 | SK |
|---|---|
| 프로필 (이름, 이메일, 상태, 역할, 가입 메모) | `PROFILE` |
| 모듈 권한 | `PERM#<module>` |
| 홈 레이아웃 (`layoutJson`: 섹션·항목 JSON 문자열, 숫자가 Decimal로 바뀌지 않게) | `LAYOUT` |
| 설정 (테마, 목표 칼로리·탄단지·체중) | `SETTINGS` |
| 캘린더 일정 (단일, 반복에서 분리된 회차는 `seriesId`) | `EVENT#<startDate>#<id>` |
| 반복 일정 (규칙·`exdates`) | `EVENTR#<id>` |
| 할 일 (마감일이 있으면 GSI1 `USER#<sub>#DUE` / `<due>#<id>`) | `TODO#<id>` |
| 할 일 목록(리스트) | `TODOLIST#<id>` |
| 식단 항목 | `MEAL#<date>#<meal>#<id>` |
| 끼니 조합 | `MEALSET#<id>` |
| 내 음식 | `FOOD#<id>` |
| 체중 | `WEIGHT#<date>` |
| 러닝 | `RUN#<date>#<id>` |
| 헬스 세션 | `GYM#<date>#<id>` |
| 헬스 루틴 | `ROUTINE#<id>` |
| 훈련 프로그램 | `PROGRAM#<id>` |
| 메모 | `NOTE#<id>` |
| 가계부 내역 | `TXN#<date>#<id>` |
| 가계부 카테고리 | `CAT#<id>` |
| 고정 지출 | `RECUR#<id>` |
| 월 예산 | `BUDGET#<yyyy-mm>` |
| 스니펫·링크 | `HUB#<id>` |
| AI 호출 횟수 | `AIUSAGE#<date>` (TTL) |

### 7.2 공유 데이터

| 데이터 | PK | SK |
|---|---|---|
| 보드 정보 | `BOARD#<id>` | `META` |
| 보드 멤버 | `BOARD#<id>` | `MEMBER#<sub>` |
| 컬럼 | `BOARD#<id>` | `COL#<id>` |
| 카드 | `BOARD#<id>` | `CARD#<id>` |
| 카드 댓글 | `BOARD#<id>` | `CARD#<id>#CMT#<timestamp>` |
| 보드 활동 | `BOARD#<id>` | `ACT#<timestamp>` |
| 체크리스트 정보 | `LIST#<id>` | `META` |
| 체크리스트 멤버 | `LIST#<id>` | `MEMBER#<sub>` |
| 체크리스트 항목 | `LIST#<id>` | `ITEM#<id>` |
| 권한 프리셋 (name, perms) | `PRESET` | `PRESET#<id>` |
| 활동 로그 | `AUDIT#<yyyy-mm>` | `<timestamp>#<id>` |

### 7.3 GSI1 (오버로딩)

| 용도 | GSI1PK | GSI1SK | 대상 항목 |
|---|---|---|---|
| 내 보드 목록 | `USER#<sub>` | `BOARD#<id>` | 보드 MEMBER |
| 내 체크리스트 목록 | `USER#<sub>` | `LIST#<id>` | 체크리스트 MEMBER |
| 마감일순 할 일 | `USER#<sub>#DUE` | `<dueDate>` | TODO |
| 상태별 계정 목록 | `STATUS#<pending/active/suspended>` | `<createdAt>` | PROFILE |

---

## 8. API 설계

### 8.1 Lambda 구성

| Lambda | 담당 | 특별 권한 |
|---|---|---|
| `auth-trigger` | Cognito Post Confirmation (비활성화, PROFILE 생성, 알림, Host 지정), Post Authentication (로그인 기록) | Cognito AdminDisableUser·AdminAddUserToGroup, SNS Publish |
| `admin` | 승인, 권한, 프리셋, 정지, 활동 로그 | Cognito 관리 API (Host 그룹만 호출) |
| `personal` | 캘린더, 할 일, health, 메모, 가계부, 허브, 설정, 레이아웃 | 없음 |
| `shared` | 작업 보드, 공용 체크리스트 | 없음 |
| `ai` | 칼로리 추정 | Bedrock InvokeModel |

### 8.2 라우트 규칙

- 기본 경로: `/api/v1`
- 리소스별 REST: `GET /todos`, `POST /todos`, `PATCH /todos/{id}`, `DELETE /todos/{id}`
- 기간 조회는 쿼리 파라미터: `GET /meals?from=2026-09-01&to=2026-09-30`
- 관리자: `/api/v1/admin/*`
- AI: `POST /api/v1/ai/estimate-calories`

**모듈 권한 매핑** (공통 미들웨어 `backend/common/perms.py`): `/api/v1` 뒤 첫 경로 세그먼트로 모듈을 정한다. 조회(GET)는 view 이상, 변경은 edit. 캘린더는 사용 가능 여부만 본다. 라우트가 아직 없어도 권한 검사가 먼저 적용된다.

| 첫 세그먼트 | 모듈 |
|---|---|
| `events`, `event-series` | calendar |
| `todos`, `todo-lists` | todo |
| `meals`, `meal-sets`, `foods`, `weights`, `runs`, `gym`, `routines`, `programs`, `ai`(edit) | health |
| `boards` | boards |
| `notes` | notes |
| `txns`, `categories`, `recurring`, `budgets` | ledger |
| `hub` | hub |
| `checklists` | checklists |
| `me`, `settings`, `layout`, `admin` | 모듈 권한 없음 (active만 확인, admin은 host) |

**관리자 API** (`/api/v1/admin`)

| 메서드 · 경로 | 내용 |
|---|---|
| `GET /admin/users?status=` | 계정 목록 (상태 필터) |
| `POST /admin/users/{sub}/approve` `{presetId}` | 승인 + 프리셋 권한 |
| `POST /admin/users/{sub}/reject` | 거절 (완전 삭제) |
| `POST /admin/users/{sub}/suspend` · `/reactivate` | 정지 · 재활성 |
| `DELETE /admin/users/{sub}` | 삭제 (개인 데이터 포함) |
| `POST /admin/users/{sub}/reset-password` | 비밀번호 초기화 (이메일 코드) |
| `GET /admin/permissions` · `PUT /admin/users/{sub}/permissions` | 권한 매트릭스 조회 · 변경 |
| `GET` · `POST /admin/presets`, `PUT` · `DELETE /admin/presets/{id}` | 프리셋 (최초 조회 시 가족·팀 기본 생성) |
| `GET /admin/audit?month=YYYY-MM` | 활동 로그 |

`GET /api/v1/me`: 로그인 사용자의 프로필과 모듈 권한 (프론트 메뉴 노출·Host 판단용). `PATCH /api/v1/me` `{name}`: 이름 변경 (PROFILE만, Cognito 속성은 가입 시 값 유지)

**할 일** (todo 모듈)

| 메서드 · 경로 | 내용 |
|---|---|
| `GET /todos?status=open|done|all` | 할 일 목록 (완료는 최근 200개) |
| `GET /todos/due?from&to` | 기간 내 마감 할 일 + `projected`(반복 할 일의 앞으로 회차 미리보기, 오늘 이후) (캘린더 겹쳐 보기, 62일 이내) |
| `POST /todos`, `PATCH` · `DELETE /todos/{id}` | 생성·수정(null은 필드 비움, `done: true`면 반복 다음 회차 생성)·삭제 |
| `GET` · `POST /todo-lists`, `PATCH` · `DELETE /todo-lists/{id}` | 목록. 삭제하면 안의 할 일은 목록 없음으로 |

**캘린더** (calendar 모듈)

| 메서드 · 경로 | 내용 |
|---|---|
| `GET /events?from&to` | 기간 내 일정 (단일 + 반복 회차 펼침, 62일 이내). 회차 id는 `<seriesId>@<날짜>` |
| `GET /events/search?q=` | 제목·메모 검색 (반복은 시리즈 하나로) |
| `POST /events` | 생성 (`repeat`가 있으면 반복 시리즈) |
| `PATCH` · `DELETE /events/{id}?start=` | 단일 일정 수정·삭제 (현재 시작일로 키를 찾음) |
| `PATCH` · `DELETE /event-series/{id}` | 반복 전체 수정·삭제 |
| `PATCH` · `DELETE /event-series/{id}/occurrences/{date}` | 반복 "이 일정만" 수정·삭제 |

**홈·설정** (모듈 권한 없음, 본인 데이터만)

| 메서드 · 경로 | 내용 |
|---|---|
| `GET` · `PUT /layout` | 홈 레이아웃 (`{version: 1, sections: [{id, name, items: [{id, kind: icon/widget, module, widget, x, y, w, h, hidden}]}]}`, 섹션 10개·항목 100개 이하) |
| `GET` · `PATCH /settings` | 사용자 설정 (`theme`: system/light/dark). 목표치는 Phase 5에서 추가 |

**Lambda 매핑** (API Gateway에서 가장 구체적인 경로가 우선)

| 경로 | Lambda | 인증 |
|---|---|---|
| `GET /api/v1/health` | personal | 없음 |
| `/api/v1/admin/{proxy+}` | admin | JWT |
| `/api/v1/ai/{proxy+}` | ai | JWT |
| `/api/v1/boards`, `/api/v1/boards/{proxy+}`, `/api/v1/checklists`, `/api/v1/checklists/{proxy+}` | shared | JWT |
| `/api/v1/{proxy+}` (나머지) | personal | JWT |

- 메서드(GET/POST/PUT/PATCH/DELETE)는 명시해서 등록한다. `ANY` + JWT 조합은 CORS preflight(OPTIONS)까지 인증을 요구하기 때문
- 프론트는 API Gateway 주소를 CORS로 직접 호출한다 (허용 origin: CloudFront 주소, 로컬 개발 주소)
- 전역 스로틀: 초당 20건, 버스트 50

**Lambda 공통**: Python 3.12, arm64, 백엔드 전체를 zip 1개로 묶고 함수별로 handler만 다르게 지정. Powertools는 AWS 공개 레이어(버전 고정)

세부 엔드포인트 목록은 각 모듈 구현 단계에서 확정한다.

---

## 9. 레포·배포 구조

레포: `leehyeonhaeng/side-projects` 모노레포 안의 `personal-portal/` 폴더

```
side-projects/
├─ .github/workflows/     ← GitHub Actions는 레포 최상단만 인식
│  ├─ portal-pr.yml       테스트 + terraform plan
│  └─ portal-deploy.yml   terraform apply → Lambda 배포 → 프론트 빌드 → S3 업로드 → CloudFront 무효화
├─ career-consultant/
├─ dawaga/
└─ personal-portal/
   ├─ docs/
   │  └─ DESIGN.md
   ├─ frontend/           React + TypeScript + Vite
   │  └─ src/
   │     ├─ modules/<module>/
   │     ├─ components/
   │     ├─ api/
   │     └─ auth/
   ├─ backend/            Python Lambda
   │  ├─ handlers/        auth_trigger, admin, personal, shared, ai
   │  ├─ common/          권한 미들웨어, DynamoDB 헬퍼, 모델
   │  └─ tests/
   ├─ infra/              Terraform
   │  ├─ bootstrap/       상태 버킷, GitHub OIDC, CI Role, Budgets (계정 공유, 로컬에서만 apply)
   │  ├─ modules/         cognito, api, lambda, dynamodb, hosting, monitoring
   │  └─ envs/            dev, prod
   ├─ README.md
   └─ DEVLOG.md
```

### 9.1 모노레포 주의 사항

| 항목 | 규칙 |
|---|---|
| 워크플로우 위치 | `side-projects/.github/workflows/`에 둔다. `personal-portal/.github/`에 두면 GitHub이 인식하지 않는다 |
| 파일명 | 다른 프로젝트 워크플로우와 구분되게 `portal-` 접두사 |
| 실행 조건 | `on.push.paths` / `on.pull_request.paths`에 `personal-portal/**` 필터 (다른 프로젝트 수정 시 실행 안 됨) |
| 작업 경로 | 각 job에 `defaults.run.working-directory` 지정 (`personal-portal/frontend`, `personal-portal/backend`, `personal-portal/infra/envs/<env>`) |
| OIDC 신뢰 정책 | `sub` 조건을 `repo:leehyeonhaeng/side-projects:ref:refs/heads/main`으로 제한 (PR plan용은 `pull_request` 조건 별도) |

### 9.2 배포 설정

| 항목 | 결정 |
|---|---|
| Terraform 상태 | S3 백엔드 + S3 네이티브 잠금 (잠금용 DynamoDB 테이블 불필요) |
| GitHub → AWS 인증 | OIDC (장기 액세스 키 없음) |
| 비용 보호 | AWS Budgets 월 1만 원 알림 |
| 로그 | CloudWatch Logs 보관 14일 |
| PWA 업데이트 | 배포 후 서비스워커가 새 버전 감지 → "새 버전 있음, 새로고침" 배너 |

### 9.3 bootstrap (Phase 0)

| 항목 | 결정 |
|---|---|
| 위치 | `infra/bootstrap/`. env 구분 없는 계정 공유 리소스만 둔다 |
| 네이밍 | env가 없으므로 `portal-<resource>` (예: `portal-tfstate-lhhportal`, `portal-github-actions-role`, `portal-monthly-budget`) |
| 상태 | 최초 로컬 state로 apply → 자신이 만든 버킷으로 이관 (key `bootstrap/terraform.tfstate`) |
| apply 주체 | 로컬(`personal-portal` 프로파일)에서만. CI는 `portal-oidc-check.yml`로 plan 검증만 |
| CI Role 권한 | `PowerUserAccess` + `portal-*` IAM 역할·정책 관리 + OIDC Provider 조회 |
| CI Role ARN | GitHub Secret `AWS_ROLE_ARN` (계정 ID를 레포에 남기지 않음) |
| 예산 알림 이메일 | 레포에 남기지 않음. 로컬 `bootstrap/terraform.tfvars`, CI는 Secret `HOST_EMAIL` |

---

## 10. 예상 비용 (소규모 사용 기준, 추정)

| 서비스 | 예상 |
|---|---|
| Cognito | 소규모 MAU는 무료 범위 |
| Lambda | 상시 무료 범위 내 |
| DynamoDB (온디맨드) | 수십~수백 원 |
| API Gateway (HTTP API) | 수십 원 수준 |
| S3 + CloudFront | 무료 범위 내 |
| Bedrock (Haiku 계열) | 사용량에 따라 월 수백 원 수준 |
| SNS | 사실상 0 |
| 합계 | 월 1만 원 이하 목표, Budgets 알림으로 감시 |

실제 요금은 구현 후 AWS Cost Explorer로 확인해 갱신한다.

---

## 11. 구현 로드맵

| Phase | 내용 | 완료 기준 |
|---|---|---|
| 0 | 사전 준비: Terraform 상태 버킷, GitHub OIDC 역할, Budgets 알림 | `terraform init` 성공, OIDC로 GitHub Actions에서 AWS 접근 |
| 1 | 인프라 기반: DynamoDB, Cognito, API Gateway, Lambda 골격, S3 + CloudFront | dev 환경에 빈 React 앱 배포, `/api/v1/health` 응답 |
| 2 | 인증·계정: 가입, 이메일 인증, 승인 대기, 관리자 화면, 권한 미들웨어 | 가입 → 승인 → 로그인 → 권한별 접근 차단 확인 |
| 3 | 홈 대시보드: 위젯 그리드, 편집 모드, 섹션, 다크모드, 하단 바, 빠른 추가 틀 | 레이아웃 저장 후 다른 기기에서 동일하게 보임 |
| 4 | 할 일 + 캘린더 | 반복 할 일, 마감일 캘린더 표시 동작 |
| 5 | 식단·체중·운동 + AI 칼로리 추정 | AI 추정 → 수정 → 저장, 일일 상한 동작 |
| 6 | 프로젝트 작업 보드 | 멤버 초대, 권한별 편집 제한, 모바일 카드 이동 |
| 7 | 메모, 가계부, 스니펫·링크 허브 | 각 모듈 CRUD + 홈 위젯 |
| 8 | 공용 체크리스트 | 참여 계정 간 공유 동작 |
| 9 | 마무리: PWA 설치·업데이트, 보안 점검, prod 배포, 문서 정리 | prod 배포, 폰 홈 화면 설치 확인 |
