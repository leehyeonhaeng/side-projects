import { useMemo, useState } from "react";
import FullCalendar, { type EventInput } from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import koLocale from "@fullcalendar/react/locales/ko";
import listPlugin from "@fullcalendar/react/list";
import classicThemePlugin from "@fullcalendar/react/themes/classic";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/theme.css";
import "@fullcalendar/react/themes/classic/palette.css";
import { SearchIcon, XIcon } from "lucide-react";
import { type CalEvent, colorHex, useEventMutations, useEvents, useSearchEvents } from "@/api/events";
import { useMe } from "@/api/me";
import { useDueTodos } from "@/api/todos";
import { ErrorAlert } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addDays, formatDay, toDateStr, todayStr } from "@/lib/dates";
import { EventEditor } from "./EventEditor";
import { useHolidays } from "./holidays";

type Editing = { event: CalEvent | null; date: string };

/** DESIGN.md 6.1 캘린더: 월·주·목록, 반복, 공휴일, 검색, 할 일 마감일 겹쳐 보기(읽기 전용) */
export function CalendarPage() {
  const me = useMe();
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  const canTodo = me.data ? me.data.perms.todo !== "none" : false;
  const readOnly = me.data?.perms.calendar === "none";
  const events = useEvents(range?.from ?? "", range?.to ?? "", Boolean(range));
  const dueTodos = useDueTodos(range?.from ?? "", range?.to ?? "", Boolean(range) && canTodo);
  const holidays = useHolidays(range?.from, range?.to);
  const search = useSearchEvents(searchOpen ? query : "");
  const { create, update, remove } = useEventMutations();

  const fcEvents = useMemo(() => {
    // 타입을 지정해야 v7에서 바뀐 옵션 이름(color 등)을 컴파일 단계에서 잡는다
    const list: EventInput[] = [];
    for (const e of events.data ?? []) {
      list.push({
        id: e.id,
        title: e.title,
        allDay: e.allDay,
        start: e.allDay ? e.start : `${e.start}T${e.startTime}`,
        // 종일 일정의 end는 다음 날(배타적) 기준
        end: e.allDay ? addDays(e.end, 1) : `${e.end}T${e.endTime}`,
        // FullCalendar v7: backgroundColor/borderColor/textColor 대신 color/contrastColor
        color: colorHex(e.color),
        contrastColor: "#ffffff",
        extendedProps: { kind: "event", event: e },
      });
    }
    for (const t of dueTodos.data ?? []) {
      list.push({
        id: `todo-${t.id}`,
        title: `${t.done ? "✓" : "☐"} ${t.title}`,
        allDay: !t.dueTime,
        start: t.dueTime ? `${t.due}T${t.dueTime}` : t.due,
        color: "transparent",
        contrastColor: "var(--muted-foreground)",
        editable: false,
        extendedProps: { kind: "todo" },
      });
    }
    for (const [day, names] of Object.entries(holidays)) {
      list.push({ id: `holiday-${day}`, title: names.join(", "), allDay: true, start: day, display: "background", extendedProps: { kind: "holiday" } });
      list.push({
        id: `holiday-label-${day}`,
        title: names.join(", "),
        allDay: true,
        start: day,
        color: "transparent",
        contrastColor: "#ef4444",
        extendedProps: { kind: "holiday" },
      });
    }
    return list;
  }, [events.data, dueTodos.data, holidays]);

  const openEvent = (e: CalEvent) => setEditing({ event: e, date: e.start });

  return (
    <main className="mx-auto grid max-w-5xl gap-3 p-4 pb-28 sm:pb-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">캘린더</h1>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={() => setSearchOpen((v) => !v)}>
            {searchOpen ? <XIcon data-icon="inline-start" /> : <SearchIcon data-icon="inline-start" />}
            검색
          </Button>
          {!readOnly && (
            <Button size="sm" onClick={() => setEditing({ event: null, date: todayStr() })}>
              새 일정
            </Button>
          )}
        </div>
      </div>

      {searchOpen && (
        <div className="grid gap-2">
          <Input aria-label="일정 검색" placeholder="제목·메모 검색" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          {search.data && (
            <ul className="grid gap-1 text-sm">
              {search.data.length === 0 && <li className="text-muted-foreground">결과가 없습니다.</li>}
              {search.data.map((e) => (
                <li key={e.id}>
                  <button type="button" className="flex w-full gap-2 rounded-lg px-2 py-1 text-left hover:bg-muted" onClick={() => !e.repeat && openEvent(e)}>
                    <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ backgroundColor: colorHex(e.color) }} />
                    <span className="flex-1">
                      {e.title}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {formatDay(e.start)}
                        {e.repeat && " · 반복"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ErrorAlert error={events.error ?? dueTodos.error} />

      <div className="portal-calendar">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, classicThemePlugin]}
          locale={koLocale}
          initialView="dayGridMonth"
          headerToolbar={{ start: "prev,next today", center: "title", end: "dayGridMonth,timeGridWeek,listMonth" }}
          height="auto"
          fixedWeekCount={false}
          dayMaxEvents={3}
          events={fcEvents}
          datesSet={(info) => {
            // FullCalendar end는 배타적이라 하루 뺀다
            const from = toDateStr(info.start);
            const to = addDays(toDateStr(info.end), -1);
            setRange((r) => (r && r.from === from && r.to === to ? r : { from, to }));
          }}
          dateClick={(info) => !readOnly && setEditing({ event: null, date: info.dateStr.slice(0, 10) })}
          eventClick={(info) => {
            const props = info.event.extendedProps as { kind: string; event?: CalEvent };
            if (props.kind === "event" && props.event) openEvent(props.event);
          }}
        />
      </div>
      {canTodo && <p className="text-xs text-muted-foreground">☐·✓ 표시는 할 일 마감일입니다 (할 일 화면에서 수정).</p>}

      {editing && (
        <EventEditor
          key={editing.event?.id ?? `new-${editing.date}`}
          event={editing.event}
          defaultDate={editing.date}
          readOnly={readOnly}
          onClose={() => setEditing(null)}
          onCreate={(input) => create.mutateAsync(input)}
          onUpdate={(input, scope, repeat) => update.mutateAsync({ event: editing.event!, input, scope, repeat })}
          onDelete={(scope) => remove.mutateAsync({ event: editing.event!, scope })}
        />
      )}
    </main>
  );
}
