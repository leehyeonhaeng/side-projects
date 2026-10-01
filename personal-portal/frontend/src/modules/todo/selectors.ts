import type { Todo } from "@/api/todos";
import { toDateStr } from "@/lib/dates";

const byDueTime = (a: Todo, b: Todo) =>
  `${a.due ?? "9999"}${a.dueTime ?? "99"}`.localeCompare(`${b.due ?? "9999"}${b.dueTime ?? "99"}`) || a.order - b.order;

/** 오늘 보여줄 할 일: 마감이 오늘이거나 지난 미완료 → 위, 오늘 완료한 것 → 맨 아래 (홈 위젯·오늘 탭 공통) */
export function todayView(open: Todo[], done: Todo[], today: string): { pending: Todo[]; completed: Todo[] } {
  const pending = open.filter((t) => t.due && t.due <= today).sort(byDueTime);
  // doneAt은 UTC 시각이라 한국 날짜로 바꿔 비교한다. 다음 날이 되면 완료 탭에만 남는다
  const completed = done
    .filter((t) => t.doneAt && toDateStr(new Date(t.doneAt)) === today)
    .sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? ""));
  return { pending, completed };
}
