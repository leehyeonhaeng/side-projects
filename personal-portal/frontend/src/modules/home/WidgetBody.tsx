import { useState } from "react";
import { CheckIcon } from "lucide-react";
import { colorHex, useEvents } from "@/api/events";
import { useMe } from "@/api/me";
import type { LayoutItem } from "@/api/preferences";
import { useCreateTodo, useTodos, useUpdateTodo } from "@/api/todos";
import { addDays, formatDay, todayStr } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { MODULE_BY_ID } from "@/modules/meta";
import { todayView } from "@/modules/todo/selectors";
import { WIDGET_BY_KEY, sizeKey } from "./widgets";

/** 위젯 내용. 구현된 모듈은 실제 데이터, 아직이면 크기별 표시 예정 내용 */
export function WidgetBody({ item }: { item: LayoutItem }) {
  if (item.widget === "todo") return <TodoWidget w={item.w} h={item.h} />;
  if (item.widget === "calendar") return <CalendarWidget w={item.w} h={item.h} />;
  const def = item.widget ? WIDGET_BY_KEY[item.widget] : undefined;
  const compact = item.w === 1;
  return (
    <>
      {!compact && <p className="mt-1 text-xs text-muted-foreground">{def?.sizes[sizeKey(item.w, item.h)]}</p>}
      <p className={cn("mt-auto text-[10px] text-muted-foreground", compact && "text-center")}>Phase {MODULE_BY_ID[item.module].phase}</p>
    </>
  );
}

function Count({ value, label }: { value: number | undefined; label: string }) {
  return (
    <div className="mt-auto text-center">
      <p className="text-2xl font-semibold tabular-nums">{value ?? "–"}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

// ── 할 일: 1×1 남은 개수 / 2×1 오늘 3개 / 2×2 오늘 + 지연 + 빠른 추가 (DESIGN.md 6.2) ──
function TodoWidget({ w, h }: { w: number; h: number }) {
  const me = useMe();
  const open = useTodos("open");
  const done = useTodos("done");
  const update = useUpdateTodo();
  const create = useCreateTodo();
  const [title, setTitle] = useState("");
  const today = todayStr();
  const canEdit = me.data?.perms.todo === "edit";
  const { pending, completed } = todayView(open.data ?? [], done.data ?? [], today);

  if (w === 1) return <Count value={open.data ? pending.length : undefined} label="오늘·지연" />;

  // 오늘 완료한 것은 맨 아래에 취소선으로 남기고, 다시 누르면 되돌린다
  const rows = [...pending, ...completed].slice(0, h === 1 ? 3 : 6);
  const hidden = pending.length + completed.length - rows.length;
  return (
    <div className="mt-1 grid min-h-0 flex-1 content-start gap-0.5 overflow-hidden">
      {open.data && pending.length + completed.length === 0 && <p className="text-xs text-muted-foreground">오늘 할 일이 없습니다.</p>}
      {rows.map((t) => (
        <div key={t.id} className="flex min-w-0 items-center gap-1 text-xs">
          <button
            type="button"
            aria-label={t.done ? `${t.title} 완료 취소` : `${t.title} 완료`}
            disabled={!canEdit || (update.isPending && update.variables?.id === t.id)}
            onClick={(e) => {
              e.stopPropagation(); // 위젯 전체 클릭(화면 이동)과 분리
              update.mutate({ id: t.id, done: !t.done });
            }}
            // 손가락으로 누르기 쉽게 버튼 영역을 동그라미보다 크게
            className="-my-1 -ml-1 grid size-6 shrink-0 place-items-center rounded-full"
          >
            <span
              className={cn(
                "grid size-3.5 place-items-center rounded-full border",
                t.done ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/60",
              )}
            >
              {t.done && <CheckIcon className="size-2.5" />}
            </span>
          </button>
          <span className={cn("truncate", t.done ? "text-muted-foreground line-through" : t.due! < today && "text-red-600 dark:text-red-400")}>{t.title}</span>
        </div>
      ))}
      {hidden > 0 && <p className="text-[10px] text-muted-foreground">외 {hidden}개</p>}
      {h === 2 && canEdit && (
        <form
          className="mt-auto"
          onClick={(e) => e.stopPropagation()}
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) create.mutate({ title: title.trim(), due: today }, { onSuccess: () => setTitle("") });
          }}
        >
          <input
            aria-label="할 일 빠른 추가"
            placeholder="+ 오늘 할 일"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            className="h-7 w-full rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </form>
      )}
    </div>
  );
}

// ── 일정: 1×1 오늘 일정 수 / 2×1 오늘 일정 / 2×2 이번 주 (DESIGN.md 6.1) ──
function CalendarWidget({ w, h }: { w: number; h: number }) {
  const today = todayStr();
  const events = useEvents(today, addDays(today, 6));
  const todays = (events.data ?? []).filter((e) => e.start <= today && e.end >= today);

  if (w === 1) return <Count value={events.data ? todays.length : undefined} label="오늘 일정" />;

  if (h === 1) {
    return (
      <div className="mt-1 grid min-h-0 content-start gap-1 overflow-hidden">
        {events.data && todays.length === 0 && <p className="text-xs text-muted-foreground">오늘 일정이 없습니다.</p>}
        {todays.slice(0, 3).map((e) => (
          <p key={e.id} className="flex min-w-0 items-center gap-1.5 text-xs">
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: colorHex(e.color) }} />
            <span className="shrink-0 tabular-nums text-muted-foreground">{e.allDay ? "종일" : e.startTime}</span>
            <span className="truncate">{e.title}</span>
          </p>
        ))}
      </div>
    );
  }

  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  return (
    <div className="mt-1 grid min-h-0 content-start gap-1 overflow-hidden">
      {days.map((day) => {
        const list = (events.data ?? []).filter((e) => e.start <= day && e.end >= day);
        if (list.length === 0) return null;
        return (
          <div key={day} className="text-xs">
            <p className="text-[10px] text-muted-foreground">{day === today ? "오늘" : formatDay(day)}</p>
            {list.slice(0, 2).map((e) => (
              <p key={e.id} className="flex min-w-0 items-center gap-1.5">
                <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: colorHex(e.color) }} />
                <span className="truncate">{e.title}</span>
              </p>
            ))}
          </div>
        );
      })}
      {events.data && events.data.length === 0 && <p className="text-xs text-muted-foreground">이번 주 일정이 없습니다.</p>}
    </div>
  );
}
