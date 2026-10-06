// 폰 화면 점검: mock 모드(가짜 데이터, 로그인 없음)로 앱을 띄워 모든 화면·주요 다이얼로그를 폰 크기로 캡처하고
// 가로 넘침·화면 밖으로 나간 요소·글자 잘림·세로 잘림·글자 겹침을 찾아 목록으로 출력한다.
// 사용: npm run screens [-- --dark] [-- --only=calendar]   결과: .screens/<기기>/<이름>.png + .screens/report.txt
// 필요: 이 PC의 Chrome (playwright-core가 설치된 Chrome을 사용, 브라우저를 따로 받지 않음)
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const PORT = 5174;
const BASE = `http://localhost:${PORT}`;
const OUT = new URL("../.screens/", import.meta.url);
const args = process.argv.slice(2);
const dark = args.includes("--dark");
const only = args.find((a) => a.startsWith("--only="))?.slice(7);

const DEVICES = [
  { name: "iphone-390", width: 390, height: 844 },
  { name: "android-360", width: 360, height: 780 },
];

/** 화면 목록: 이름, 경로, 열고 나서 할 동작(다이얼로그 열기 등) */
const SCREENS = [
  ["home", "/"],
  ["menu", "/menu"],
  ["quick-add", "/", async (p) => p.locator('nav button[aria-label="빠른 추가"]').click()],
  ["settings", "/settings"],
  ["todo", "/todo"],
  ["todo-editor", "/todo", async (p) => p.getByText("장보기").first().click()],
  ["calendar", "/calendar"],
  ["calendar-new", "/calendar", async (p) => p.getByRole("button", { name: "새 일정" }).click()],
  ["calendar-new-time", "/calendar", async (p) => (await p.getByRole("button", { name: "새 일정" }).click(), p.getByLabel("종일").click())],
  ["calendar-week", "/calendar", async (p) => p.getByText("3일", { exact: true }).first().click()],
  ["calendar-list", "/calendar", async (p) => p.getByText("일정목록", { exact: true }).first().click()],
  ["health-meal", "/health"],
  ["health-weight", "/health", async (p) => p.getByRole("tab", { name: "체중" }).click()],
  ["health-run", "/health", async (p) => p.getByRole("tab", { name: "운동" }).click()],
  ["health-gym", "/health", async (p) => (await p.getByRole("tab", { name: "운동" }).click(), p.getByRole("tab", { name: "헬스" }).click())],
  ["health-program", "/health", async (p) => (await p.getByRole("tab", { name: "운동" }).click(), p.getByRole("tab", { name: "훈련 프로그램" }).click())],
  ["boards", "/boards"],
  ["board", "/boards/b1"],
  ["board-card", "/boards/b1", async (p) => p.getByText("로그인 화면 디자인").first().click()],
  ["board-members", "/boards/b1", async (p) => p.getByRole("button", { name: /멤버/ }).first().click()],
  ["notes", "/notes"],
  ["note-edit", "/notes/n1"],
  ["note-new", "/notes/new"],
  ["ledger", "/ledger"],
  ["ledger-stats", "/ledger", async (p) => p.getByRole("tab", { name: "통계" }).click()],
  ["ledger-budget", "/ledger", async (p) => p.getByRole("tab", { name: "예산" }).click()],
  ["ledger-settings", "/ledger", async (p) => p.getByRole("tab", { name: "고정·카테고리" }).click()],
  ["hub", "/hub"],
  ["hub-new", "/hub", async (p) => p.locator('main button:has(svg):has-text("스니펫")').first().click()],
  ["checklists", "/checklists"],
  ["checklist", "/checklists/cl1"],
  ["admin", "/admin"],
  ["company-list", "/company"],
  ["company-home", "/company/cp1"],
  ["company-members", "/company/cp1/members", async (p) => p.getByRole("button", { name: /권한/ }).nth(2).click()],
  ["company-invites", "/company/cp1/members", async (p) => p.getByRole("tab", { name: "초대" }).click()],
  ["company-roles", "/company/cp1/members", async (p) => p.getByRole("tab", { name: "역할" }).click()],
  ["company-audit", "/company/cp1/audit"],
  ["company-settings", "/company/cp1/settings"],
  ["invite", "/invite/abcDEF123456"],
];

/** 페이지 안에서 실행: 문제 요소 찾기 */
function inspect() {
  const W = innerWidth;
  const out = [];
  const label = (el) => {
    const cls = typeof el.className === "string" ? el.className.split(" ").filter((c) => !c.includes(":")).slice(0, 3).join(".") : "";
    const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 30);
    return `<${el.tagName.toLowerCase()}${cls ? "." + cls : ""}> "${text}"`;
  };
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const inHScroller = (el) => {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const o = getComputedStyle(n).overflowX;
      if ((o === "auto" || o === "scroll") && n.scrollWidth > n.clientWidth) return true;
    }
    return false;
  };
  // 다이얼로그가 열려 있으면 그 안만 본다 (뒤 화면과 겹치는 건 정상)
  const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter((d) => d.getBoundingClientRect().width > 0);
  const roots = dialogs.length ? dialogs : [document.body];
  const inFixed = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) if (getComputedStyle(n).position === "fixed" && !n.matches('[role="dialog"]')) return true;
    return false;
  };
  // 폰 브라우저는 내용이 화면보다 넓으면 페이지(레이아웃) 너비 자체를 넓혀 버린다 → 기기 너비와 비교
  const clippedAway = (el) => {
    const r = el.getBoundingClientRect();
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.overflowY === "hidden" || cs.overflowY === "clip" || cs.overflowX === "hidden") {
        const c = n.getBoundingClientRect();
        if (r.top >= c.bottom || r.bottom <= c.top || r.left >= c.right || r.right <= c.left) return true;
      }
    }
    return false;
  };
  if (innerWidth > visualViewport.width + 1) out.push(`[페이지 넓어짐] 레이아웃 너비 ${innerWidth}px > 화면 ${Math.round(visualViewport.width)}px (넓은 요소가 있음)`);
  if (document.documentElement.scrollWidth > W + 1) out.push(`[가로 넘침] 페이지 너비 ${document.documentElement.scrollWidth}px > 화면 ${W}px`);

  const els = roots.flatMap((r) => [...r.querySelectorAll("*")]).filter((el) => !el.closest(".sr-only") && (dialogs.length || !inFixed(el)) && !["svg", "path", "g", "circle", "rect", "line", "polyline", "text", "tspan"].includes(el.tagName.toLowerCase()) && visible(el));
  for (const el of els) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.right > W + 1 && !inHScroller(el) && cs.position !== "fixed" && !clippedAway(el)) out.push(`[화면 밖] ${label(el)} 오른쪽 끝 ${Math.round(r.right)}px`);
    const leafText = el.children.length === 0 && (el.textContent || "").trim().length > 0;
    if (leafText && el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== "ellipsis" && cs.overflowX !== "visible") out.push(`[글자 잘림] ${label(el)} (${el.scrollWidth}px 중 ${el.clientWidth}px만 보임)`);
    if ((cs.overflowY === "hidden" || cs.overflowY === "clip") && el.clientHeight > 24 && el.scrollHeight > el.clientHeight + 4 && !/line-clamp|max-h-/.test(el.className)) out.push(`[세로 잘림] ${label(el)} (${el.scrollHeight}px 중 ${el.clientHeight}px만 보임)`);
  }

  // 글자끼리 겹침: 글자가 있는 맨 안쪽 요소들끼리 상자가 크게 겹치면 (부모·자식 관계 제외)
  const texts = els.filter((el) => el.children.length === 0 && (el.textContent || "").trim() && getComputedStyle(el).position !== "fixed" && !clippedAway(el));
  const rects = texts.map((el) => el.getBoundingClientRect());
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = rects[i], b = rects[j];
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w <= 2 || h <= 2) continue;
      const small = Math.min(a.width * a.height, b.width * b.height);
      if ((w * h) / small > 0.3 && !texts[i].contains(texts[j]) && !texts[j].contains(texts[i])) out.push(`[겹침] ${label(texts[i])} ↔ ${label(texts[j])}`);
    }
  }
  return [...new Set(out)].slice(0, 40);
}

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
const report = [];
try {
  await waitForServer();
  rmSync(OUT, { recursive: true, force: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  for (const dev of DEVICES) {
    mkdirSync(new URL(`${dev.name}/`, OUT), { recursive: true });
    const ctx = await browser.newContext({ viewport: { width: dev.width, height: dev.height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? "dark" : "light", locale: "ko-KR", timezoneId: "Asia/Seoul" });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    for (const [name, path, action] of SCREENS) {
      if (only && !name.includes(only)) continue;
      errors.length = 0;
      let problems = [];
      try {
        await page.goto(BASE + path, { waitUntil: "networkidle" });
        await page.waitForTimeout(400);
        if (action) {
          await action(page);
          await page.waitForTimeout(500);
        }
        problems = await page.evaluate(inspect);
      } catch (e) {
        problems = [`[실행 오류] ${String(e).split("\n")[0]}`];
      }
      await page.screenshot({ path: fileURLToPath(new URL(`${dev.name}/${name}.png`, OUT)), fullPage: true }).catch((e) => problems.push(`[캡처 실패] ${String(e).split("\n")[0]}`));
      const all = [...problems, ...errors.map((e) => `[콘솔 오류] ${e.slice(0, 160)}`)];
      report.push(`## ${dev.name} / ${name} (${path})${all.length ? "" : "  OK"}`, ...all.map((p) => `  - ${p}`));
    }
    await ctx.close();
  }
  await browser.close();
} finally {
  server.kill();
  if (process.platform === "win32" && server.pid) spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
}
mkdirSync(OUT, { recursive: true });
writeFileSync(new URL("report.txt", OUT), report.join("\n") + "\n");
console.log(report.join("\n"));
