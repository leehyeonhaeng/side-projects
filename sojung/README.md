# sojung

사내 재고관리 · 거래처관리(입출금 / 미납금 / 선납금) 통합 서비스.

회사 사람들만 사용하는 내부 전용 서비스로, 외부 공개나 타사 공유 없이
**사내 서버(PC) 한 대에 배포하고, 같은 사내망(LAN)의 다른 컴퓨터들은 브라우저로 접속**하는 구조로 운영합니다.

## 구조

```
[서버 PC: Next.js 앱 + SQLite 파일]
        ↑ (LAN, 브라우저 접속)
[직원 PC 1]  [직원 PC 2]  [직원 PC 3] ...
```

- 데이터(SQLite 파일)는 서버 PC 한 곳에만 존재합니다.
- 다른 PC는 파일을 직접 다루지 않고, 서버 PC 주소로 접속해 화면만 봅니다.
- 서버 PC가 꺼지면 다른 사람들의 접속이 끊기므로, 상시 켜져 있는 PC를 서버로 지정하는 것을 권장합니다.

## 기술 스택

- [Next.js](https://nextjs.org) (JavaScript) — 프론트엔드 + 백엔드(API Route) 통합
- [Tailwind CSS](https://tailwindcss.com) — 스타일링
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — 파일 기반 DB, 별도 DB 서버 불필요

## 시작하기

```bash
npm install
npm run dev
```

[http://localhost:3000](http://localhost:3000) 에서 확인.

사내망에서 다른 PC가 접속하려면, 서버 PC의 로컬 IP로 접속합니다 (예: `http://192.168.0.10:3000`).

## 데이터

- DB 파일: `data/sojung.db` (git에는 포함되지 않음, 서버 PC에만 존재)
- 백업은 이 파일 하나만 복사하면 됩니다.

## 개발 기록

작업 진행 상황과 결정 배경은 [DEVLOG.md](./DEVLOG.md) 참고.
