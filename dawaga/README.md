# 🧭 다와가 (DAWAGA)

> "너 지금 어디야?"를 없애주는 약속 시간 한정 위치 공유 나침반

---

## 💡 서비스 소개

약속 시간 10분 전, 단톡방은 "나 다와가", "나 지금 지하철역 앞"이라는 연락으로 가득 찹니다.
하지만 배달 앱처럼 정확한 실시간 GPS를 공유하는 건 사생활 침해 같아 부담스럽습니다.

**다와가**는 약속 시간 전후 1시간 동안만 켜지는 가벼운 위치 공유 서비스입니다.
정확한 위치 대신 "도보 5분 남음", "지하철 타는 중, 15분 후 도착 예정" 같은 추상화된 정보만 보여줍니다.

---

## 🌐 서비스 URL

- **프론트엔드**: https://dawaga-three.vercel.app
- **백엔드**: https://dawaga-server.onrender.com

---

## ✨ 구현된 기능

- 🔐 **Google 로그인** — Supabase Auth 기반, 유저별 약속 목록 완전 분리
- 🧭 **거리 나침반** — 목적지 방향과 남은 거리를 나침반으로 표시
- ⏰ **시간 제한 공유** — 약속 시간 ±1시간에만 자동 활성화
- 🗺 **카카오 지도 연동** — 장소 검색으로 약속 장소 설정
- 👥 **실시간 멀티유저** — 같은 방 멤버들의 위치 실시간 동기화
- 🚇 **교통수단별 도착 예정** — 도보/대중교통/자동차 실제 API 기반 도착 시간 계산
- 🔔 **자동 알림** — 약속 30분 전, 10분 전 브라우저 푸시 알림
- 📣 **독촉 메시지** — 친구/돌려까기/직장인 모드 랜덤 메시지 + 직접 입력
- 💸 **지각비 정산** — 약속 시간 초과 시 분당 500원 자동 누적
- 📋 **약속 목록** — 내가 만든/참가한 약속 목록 관리

---

## 🛠 기술 스택

| 구분 | 기술 |
|------|------|
| Frontend | React |
| Backend | Node.js + Express |
| 실시간 통신 | Socket.io |
| 인증 | Supabase Auth + Google OAuth |
| 지도 | 카카오 지도 SDK |
| 장소 검색 | 카카오 로컬 API |
| 대중교통 경로 | ODsay API |
| 자동차 경로 | 카카오모빌리티 API |
| 배포 | Vercel (프론트) + Render (백엔드) |

---

## 🚀 로컬 실행 방법

### 1. 환경변수 설정

`server/.env` 파일 생성:
ODSAY_API_KEY=your_key
KAKAO_REST_API_KEY=your_key
CLIENT_URL=http://localhost:3000
PORT=4000

`client/.env` 파일 생성:
REACT_APP_SERVER_URL=http://localhost:4000
REACT_APP_KAKAO_JS_KEY=your_key
REACT_APP_SUPABASE_URL=your_supabase_url
REACT_APP_SUPABASE_ANON_KEY=your_supabase_anon_key

### 2. 서버 실행
```bash
cd server
npm install
node index.js
```

### 3. 클라이언트 실행
```bash
cd client
npm install
npm start
```

브라우저에서 `http://localhost:3000` 접속

---

## 📁 프로젝트 구조

```
dawaga/
├── client/                  # React 프론트엔드
│   ├── public/
│   │   └── index.html
│   └── src/
│       ├── App.js
│       ├── supabase.js
│       └── components/
│           ├── CreateRoom.js
│           ├── JoinRoom.js
│           └── RoomView.js
├── server/                  # Node.js 백엔드
│   ├── index.js
│   └── .env                 # 환경변수 (git 제외)
├── DEVLOG.md                # 개발 일지
└── README.md
```

---

## 📅 개발 일지

자세한 개발 과정은 [DEVLOG.md](./DEVLOG.md) 참고

---

## 👨‍💻 개발자

- **leehyeonhaeng** — 기획 & 개발
