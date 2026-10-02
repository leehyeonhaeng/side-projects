/** 날짜는 한국 시간 기준 달력 날짜(YYYY-MM-DD) 문자열로 다룬다 (백엔드와 같은 규칙). */

const KST_DATE = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });

export const toDateStr = (d: Date) => KST_DATE.format(d);

export const todayStr = () => toDateStr(new Date());

/** YYYY-MM-DD에 n일 더하기 (시간대 영향 없이 날짜만 계산) */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

export function weekdayOf(day: string): number {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 10월 3일 (금) */
export function formatDay(day: string): string {
  const [, m, d] = day.split("-").map(Number) as [number, number, number];
  return `${m}월 ${d}일 (${WEEKDAY[weekdayOf(day)]})`;
}

/** 오늘/내일/어제 또는 10월 3일 (금) */
export function relativeDay(day: string): string {
  const today = todayStr();
  if (day === today) return "오늘";
  if (day === addDays(today, 1)) return "내일";
  if (day === addDays(today, -1)) return "어제";
  return formatDay(day);
}

/** ISO 요일 (월=1 … 일=7), 백엔드 반복 규칙과 같은 기준 */
export const ISO_WEEKDAYS = [
  { value: 1, label: "월" },
  { value: 2, label: "화" },
  { value: 3, label: "수" },
  { value: 4, label: "목" },
  { value: 5, label: "금" },
  { value: 6, label: "토" },
  { value: 7, label: "일" },
];

export const isoWeekdayOf = (day: string) => ((weekdayOf(day) + 6) % 7) + 1;

const KST_TIME = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
/** ISO 시각 → "10. 2. 14:05" (KST) */
export const formatTime = (iso: string) => KST_TIME.format(new Date(iso));
