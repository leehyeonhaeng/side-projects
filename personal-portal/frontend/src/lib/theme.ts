/** 시스템 다크모드 설정을 <html class="dark">에 반영한다. 수동 토글(사용자별 저장)은 Phase 3. */
export function followSystemTheme(): void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => document.documentElement.classList.toggle("dark", media.matches);
  apply();
  media.addEventListener("change", apply);
}
