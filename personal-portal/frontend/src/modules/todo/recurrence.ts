import type { TodoRepeat } from "@/api/todos";
import { addDays, isoWeekdayOf } from "@/lib/dates";

/**
 * 편집 화면의 "다음 회차" 안내용. 실제 다음 회차는 서버(backend/domains/recurrence.py next_todo_due)가 만들고,
 * 이 함수는 같은 규칙을 화면 미리보기에만 쓴다.
 */
export function nextTodoDue(due: string, repeat: TodoRepeat): string {
  switch (repeat.freq) {
    case "daily":
      return addDays(due, 1);
    case "weekdays": {
      let d = addDays(due, 1);
      while (isoWeekdayOf(d) > 5) d = addDays(d, 1);
      return d;
    }
    case "weekly": {
      const days = new Set(repeat.weekdays.length ? repeat.weekdays : [isoWeekdayOf(due)]);
      let d = addDays(due, 1);
      while (!days.has(isoWeekdayOf(d))) d = addDays(d, 1);
      return d;
    }
    case "monthly": {
      const [y, m, day] = due.split("-").map(Number) as [number, number, number];
      const target = repeat.monthDay ?? day;
      const ny = m === 12 ? y + 1 : y;
      const nm = m === 12 ? 1 : m + 1;
      const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
      return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(target, last)).padStart(2, "0")}`;
    }
  }
}
