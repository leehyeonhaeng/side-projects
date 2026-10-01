import type { ThemePref } from "@/api/preferences";

// 서버 설정(SETTINGS.theme)이 기준이고, 첫 화면 깜빡임을 막으려고 마지막 값을 로컬에도 둔다 (index.html)
const STORAGE_KEY = "theme";
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

let current: ThemePref = readStoredTheme();

function readStoredTheme(): ThemePref {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" ? v : "system";
}

function render(): void {
  const dark = current === "dark" || (current === "system" && media().matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function setTheme(pref: ThemePref): void {
  current = pref;
  localStorage.setItem(STORAGE_KEY, pref);
  render();
}

/** 앱 시작 시 1회: 저장된 값 적용 + 시스템 설정 변경 감지 */
export function initTheme(): void {
  render();
  media().addEventListener("change", render);
}
