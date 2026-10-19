// 사용설명서용 화면 사진: mock 모드(가짜 데이터)로 앱을 띄워 기능별 화면을 찍고, 눌러야 할 곳의 위치(%)를 shots.json에 남긴다.
// 설명서 페이지가 이 위치에 번호(①②③)를 찍는다.
// 사용: node scripts/manual-shots.mjs <출력 폴더>   (폰 390×844, PC 1280×860, 밝은 화면, JPEG)
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PORT = 5175;
const BASE = `http://localhost:${PORT}`;
const OUT = process.argv[2];
if (!OUT) throw new Error("출력 폴더를 주세요");
const C = "/company/cp1";
const PHONE = { width: 390, height: 844 };
const PC = { width: 1280, height: 860 };
// 링크 모양 버튼까지: 보이는 글자로 찾는다
const T = (p, text) => p.locator("a, button").filter({ hasText: text });

// full: 화면 전체 길이로 찍기(아래 탭은 숨김). pins: [위치 찾기, 설명]
const SHOTS = [
  { name: "pc-home", path: C, viewport: PC, pins: [
    [(p) => p.locator("aside nav"), "왼쪽 회사 메뉴 — 모든 기능이 여기 있습니다"],
    [(p) => p.locator("aside").getByRole("link", { name: /^알림/ }), "알림 (빨간 숫자 = 안 읽은 알림)"],
    [(p) => p.locator("main").getByText("청구 대기").first(), "오늘 할 일 — 누르면 그 화면으로"],
    [(p) => p.locator("main").getByRole("link", { name: "임대 출고" }), "빠른 입력 버튼"],
    [(p) => p.locator("aside").getByRole("link", { name: /행포털/ }), "행포털(개인 공간)로 돌아가기"],
  ] },
  { name: "home", path: C, pins: [
    [(p) => p.locator("header").getByRole("link", { name: /^알림/ }), "알림"],
    [(p) => p.locator("main").getByText("청구 대기").first(), "오늘 할 일"],
    [(p) => p.locator("main").getByRole("link", { name: "임대 출고" }), "빠른 입력"],
    [(p) => p.locator("nav.fixed").getByRole("link", { name: "전체" }), "전체 — 나머지 메뉴 모두"],
  ] },
  { name: "more", path: `${C}/more`, full: true, pins: [
    [(p) => p.locator("main").getByRole("link", { name: "임대 계약" }), "임대 계약"],
    [(p) => p.locator("main").getByRole("link", { name: "청구 대기" }), "청구 대기"],
    [(p) => p.locator("main").getByRole("link", { name: "검침" }), "검침"],
    [(p) => p.locator("main").getByRole("link", { name: "A/S" }), "A/S"],
    [(p) => p.locator("main").getByRole("link", { name: "문서함" }), "문서함"],
    [(p) => p.locator("main").getByRole("link", { name: "보고서" }), "보고서"],
    [(p) => p.locator("main").getByRole("link", { name: /돈/ }), "돈 (미수·장부·월 마감)"],
    [(p) => p.locator("main").getByRole("link", { name: "직원·권한" }), "직원·권한 (관리자)"],
    [(p) => p.locator("main").getByRole("link", { name: "회사 설정" }), "회사 설정"],
  ] },
  { name: "settings", path: `${C}/settings`, full: true, pins: [
    [(p) => p.getByText("회사 정보", { exact: false }).first(), "회사 정보 — 문서에 찍힙니다"],
    [(p) => p.getByText("연체로 보는 날"), "연체 기준 (청구 후 며칠)"],
    [(p) => p.getByRole("button", { name: "저장" }), "저장"],
    [(p) => p.getByText("직인 이미지 올리기"), "직인 이미지 올리기"],
  ] },
  { name: "members", path: `${C}/members`, pins: [
    [(p) => p.getByRole("button", { name: "계정 만들어 주기" }), "계정 만들어 주기"],
    [(p) => p.getByRole("tab", { name: "초대" }), "초대 링크"],
    [(p) => p.getByRole("button", { name: /권한/ }).first(), "직원별 역할·권한 바꾸기"],
  ] },
  { name: "members-form", path: `${C}/members`, act: (p) => p.getByRole("button", { name: "계정 만들어 주기" }).click(), pins: [
    [(p) => p.locator("#acc-name"), "이름"],
    [(p) => p.locator("#acc-email"), "이메일 = 로그인 아이디"],
    [(p) => p.locator("#acc-role"), "역할"],
    [(p) => p.getByRole("button", { name: "만들기" }), "만들기 → 임시 비밀번호가 나옵니다"],
  ] },
  { name: "partners", path: `${C}/partners`, pins: [
    [(p) => p.getByRole("button", { name: "거래처 추가" }), "거래처 추가"],
    [(p) => p.getByText("서울중앙초등학교").first(), "거래처를 누르면 상세"],
  ] },
  { name: "partner", path: `${C}/partners/pa2`, full: true, pins: [
    [(p) => p.getByRole("link", { name: "임대 출고" }), "이 거래처로 바로 입력"],
    [(p) => p.getByRole("button", { name: "원장 출력" }), "거래처 원장 PDF"],
    [(p) => T(p, "청구서 만들기"), "청구서 만들기"],
  ] },
  { name: "items", path: `${C}/items`, pins: [
    [(p) => p.getByRole("button", { name: "품목 추가" }), "품목 추가 (기기 모델·소모품)"],
  ] },
  { name: "assets", path: `${C}/assets`, pins: [
    [(p) => T(p, "라벨 출력"), "라벨 출력"],
    [(p) => p.getByRole("button", { name: "기기 등록" }), "기기 등록 (가진 기기 한 번에)"],
    [(p) => p.getByText("A-000001").first(), "기기를 누르면 상세"],
  ] },
  { name: "asset", path: `${C}/assets/as1`, full: true, pins: [
    [(p) => p.getByRole("link", { name: "계약 보기" }), "이 기기의 계약"],
    [(p) => T(p, /^수거$/), "수거"],
    [(p) => p.getByRole("button", { name: "검침 입력" }), "검침 입력"],
    [(p) => T(p, "A/S 접수"), "A/S 접수"],
    [(p) => T(p, /^라벨$/), "라벨"],
  ] },
  { name: "rental-out", path: `${C}/contracts/new?partner=pa1&asset=as3`, full: true, act: (p) => p.getByLabel("과금 방식").selectOption("counter"), pins: [
    [(p) => p.locator("main select").first(), "거래처"],
    [(p) => p.getByRole("button", { name: "새 계약" }), "새 계약 / 기존 계약에 추가"],
    [(p) => p.getByText("청구일 (매월)"), "매월 청구일 (31 = 말일)"],
    [(p) => p.getByText("A-000003").first(), "내보낼 기기 고르기"],
    [(p) => p.getByLabel("과금 방식"), "월 고정 / 기본료 + 초과 매수"],
    [(p) => p.getByText("설치 카운터 흑백"), "설치할 때 카운터"],
    [(p) => p.getByText("설치비 등 같이 청구"), "설치비 같이 청구"],
    [(p) => p.getByRole("button", { name: "새 계약으로 출고" }), "출고 저장"],
  ] },
  { name: "contracts", path: `${C}/contracts`, pins: [
    [(p) => T(p, "새 계약"), "새 계약 (= 임대 출고)"],
    [(p) => p.getByText("C-2026-0001").first(), "계약을 누르면 상세"],
  ] },
  { name: "contract", path: `${C}/contracts/k1`, full: true, pins: [
    [(p) => p.getByText(/^다음 청구/), "다음 청구 예정·제안 금액"],
    [(p) => T(p, "청구 대기로"), "청구 대기로 가기"],
    [(p) => T(p, "기기 추가"), "기기 추가 출고"],
    [(p) => T(p, /^수거$/), "수거"],
    [(p) => T(p, "조건 수정"), "요금·청구일 수정"],
  ] },
  { name: "billing", path: `${C}/billing`, pins: [
    [(p) => p.locator("main input[type=checkbox]").first(), "발행할 계약 체크"],
    [(p) => p.getByText("청구 날짜").first(), "청구 날짜"],
    [(p) => p.getByText("직접 수정").first(), "금액 고치기"],
    [(p) => p.getByRole("button", { name: /건 발행/ }), "체크한 것 발행"],
  ] },
  { name: "readings", path: `${C}/readings`, pins: [
    [(p) => p.getByText("검침일"), "검침한 날"],
    [(p) => p.getByLabel(/흑백 카운터/).first(), "카운터 입력 (흑백·컬러)"],
    [(p) => p.locator("main form").first().getByRole("button", { name: "저장" }), "저장"],
  ] },
  { name: "services", path: `${C}/services`, pins: [
    [(p) => T(p, "A/S 접수"), "A/S 접수"],
    [(p) => p.getByRole("button", { name: /^접수/ }), "접수 / 완료 / 청구 필요 보기"],
    [(p) => p.getByText("AS-2026-0012").first(), "누르면 상세 (완료 입력)"],
  ] },
  { name: "service", path: `${C}/services/sv1`, full: true, pins: [
    [(p) => p.getByLabel("담당"), "담당 기사"],
    [(p) => p.getByText("조치 내용"), "조치 내용"],
    [(p) => p.getByRole("button", { name: "부품 추가" }), "사용 부품"],
    [(p) => p.getByText("유상 (사무실에서 나중에 청구)"), "유상 표시"],
    [(p) => p.getByRole("button", { name: "완료", exact: true }), "완료"],
  ] },
  { name: "service-done", path: `${C}/services/sv2`, full: true, pins: [
    [(p) => T(p, "청구 만들기"), "유상 A/S 청구 (사무실)"],
    [(p) => p.getByRole("button", { name: /작업 확인서/ }), "작업 확인서 (고객 서명)"],
  ] },
  { name: "txns", path: `${C}/txns`, pins: [
    [(p) => T(p, "새 거래"), "새 거래"],
    [(p) => p.getByRole("button", { name: /최근 1달/ }), "기간·종류로 걸러 보기"],
    [(p) => p.locator("main a[href*='/txns/']").first(), "누르면 상세 (문서·취소)"],
  ] },
  { name: "txn-pick", path: `${C}/txns/new`, pins: [
    [(p) => p.getByRole("button", { name: /^판매/ }), "판매"],
    [(p) => p.getByRole("button", { name: /^입금/ }), "입금"],
    [(p) => p.getByRole("button", { name: /^매입/ }), "매입"],
    [(p) => p.getByRole("button", { name: /^경비/ }), "경비"],
  ] },
  { name: "receipt", path: `${C}/txns/new?type=receipt&partner=pa2`, full: true, act: (p) => p.getByLabel("금액 (원)").fill("100000"), pins: [
    [(p) => p.locator("main select").first(), "거래처"],
    [(p) => p.getByLabel("계좌").first(), "받은 계좌"],
    [(p) => p.getByLabel("금액 (원)"), "받은 금액"],
    [(p) => p.getByRole("button", { name: "직접 배분" }), "어느 청구에 갚을지 직접 정하기"],
    [(p) => p.getByRole("button", { name: /입금 저장/ }), "저장"],
  ] },
  { name: "txn-detail", path: `${C}/txns/x/tx2`, full: true, pins: [
    [(p) => p.getByRole("button", { name: /영수증/ }), "영수증 PDF"],
    [(p) => p.getByRole("button", { name: "거래 취소" }), "거래 취소"],
  ] },
  { name: "money", path: `${C}/money`, pins: [
    [(p) => p.getByRole("tab", { name: "미수·미지급" }), "미수·미지급"],
    [(p) => p.getByRole("tab", { name: "회사 장부" }), "회사 장부"],
    [(p) => p.getByRole("tab", { name: "월 마감" }), "월 마감"],
  ] },
  { name: "docs", path: `${C}/docs`, pins: [
    [(p) => T(p.locator("main"), "청구서 만들기"), "청구서 만들기"],
    [(p) => T(p.locator("main"), "기기 라벨"), "기기 라벨"],
    [(p) => p.getByRole("button", { name: /R-2026-0003/ }), "누르면 다시 받기·공유·인쇄"],
  ] },
  { name: "doc-sheet", path: `${C}/docs`, act: (p) => p.getByRole("button", { name: /R-2026-0003/ }).click(), pins: [
    [(p) => T(p, "내려받기"), "내려받기"],
    [(p) => T(p, "열어서 인쇄"), "열어서 인쇄 (폰은 공유 버튼도)"],
  ] },
  { name: "invoice", path: `${C}/docs/invoice?partner=pa2`, pins: [
    [(p) => p.locator("main select").first(), "거래처"],
    [(p) => p.locator("main ul input[type=checkbox]").first(), "넣을 청구 체크"],
    [(p) => p.getByRole("button", { name: /청구서 발행/ }), "발행"],
  ] },
  { name: "labels", path: `${C}/labels?ids=as1,as3`, full: true, pins: [
    [(p) => p.getByText("A-000001").first(), "라벨 붙일 기기"],
    [(p) => p.getByLabel("용지"), "용지 (A4 라벨지 / 라벨 프린터)"],
    [(p) => p.getByRole("button", { name: "1번째 칸부터" }), "시작할 칸"],
    [(p) => p.getByText("칸 테두리 그리기", { exact: false }), "시험 인쇄용 테두리"],
    [(p) => p.getByRole("button", { name: /PDF 만들기/ }), "PDF 만들기"],
  ] },
  { name: "notifications", path: `${C}/notifications`, full: true, wait: 6000, pins: [
    [(p) => p.locator("main ul a").first(), "알림을 누르면 그 화면으로"],
    [(p) => p.getByRole("button", { name: /이 기기에서 알림 받기|시험 알림/ }), "이 기기에서 폰 알림 받기"],
    [(p) => p.getByRole("switch").first(), "받을 알림 켜고 끄기"],
  ] },
  { name: "reports", path: `${C}/reports`, pins: [
    [(p) => p.getByRole("button", { name: "최근 6개월" }), "기간"],
    [(p) => p.getByRole("button", { name: /CSV/ }).first(), "엑셀용 CSV"],
  ] },
];

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BASE)).ok) return;
    } catch {
      /* 아직 안 뜸 */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("mock 서버가 뜨지 않았습니다");
}

const server = spawn("npx", ["vite", "--mode", "mock", "--port", String(PORT), "--strictPort"], { shell: true, stdio: "ignore", env: { ...process.env, VITE_API_BASE_URL: "http://mock", VITE_APP_ENV: "dev" } });
const result = {};
const problems = [];
try {
  await waitForServer();
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  for (const shot of SHOTS) {
    const vp = shot.viewport ?? PHONE;
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: vp === PHONE, hasTouch: vp === PHONE, colorScheme: "light", locale: "ko-KR", timezoneId: "Asia/Seoul" });
    const page = await ctx.newPage();
    await page.goto(BASE + shot.path, { waitUntil: "networkidle" });
    await page.waitForTimeout(shot.wait ?? 500);
    if (shot.act) {
      await shot.act(page);
      await page.waitForTimeout(500);
    }
    if (shot.full) await page.addStyleTag({ content: "nav.fixed { display: none !important; }" });
    await page.waitForTimeout(200);
    const size = shot.full ? await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight })) : { w: vp.width, h: vp.height };
    const pins = [];
    for (const [i, [find, label]] of shot.pins.entries()) {
      try {
        const box = await find(page).first().evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height };
        });
        // 번호는 요소 왼쪽 끝(글자를 가리지 않게), 높이는 가운데(큰 영역은 위쪽)
        const x = box.x + 2;
        const y = box.y + (box.h < 90 ? box.h / 2 : 22);
        if (y > size.h || x > size.w) problems.push(`${shot.name} ${i + 1}: 화면 밖`);
        pins.push({ n: i + 1, x: +((x / size.w) * 100).toFixed(2), y: +((y / size.h) * 100).toFixed(2), label });
      } catch (e) {
        problems.push(`${shot.name} ${i + 1} (${label}): ${String(e).split("\n")[0]}`);
      }
    }
    await page.screenshot({ path: join(OUT, `${shot.name}.jpg`), type: "jpeg", quality: 80, fullPage: !!shot.full });
    result[shot.name] = { w: size.w, h: size.h, pins };
    await ctx.close();
  }
  await browser.close();
} finally {
  server.kill();
  if (process.platform === "win32" && server.pid) spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
}
writeFileSync(join(OUT, "shots.json"), JSON.stringify(result));
console.log(`${Object.keys(result).length}장`);
console.log(problems.length ? problems.join("\n") : "위치 문제 없음");
