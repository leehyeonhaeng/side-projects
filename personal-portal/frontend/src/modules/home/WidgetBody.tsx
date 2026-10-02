import { type MouseEvent, useState } from "react";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, YAxis } from "recharts";
import { useNavigate } from "react-router";
import { CheckIcon } from "lucide-react";
import { colorHex, useEvents } from "@/api/events";
import { MEAL_TYPES, sumTotals, useMeals } from "@/api/meals";
import { useMe } from "@/api/me";
import { useSettings } from "@/api/preferences";
import { useWeights, withMovingAverage } from "@/api/weights";
import { useBoards } from "@/api/boards";
import { noteTitle, notePreview, useNotes } from "@/api/notes";
import { isPlanDone, mondayOf, useGymSessions, usePrograms, useRuns } from "@/api/exercise";
import { TodayTraining, useProgramRecords } from "@/modules/health/exercise/ProgramPanel";
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
  if (item.widget === "meal") return <MealWidget w={item.w} h={item.h} />;
  if (item.widget === "weight") return <WeightWidget w={item.w} h={item.h} />;
  if (item.widget === "exercise") return <ExerciseWidget w={item.w} h={item.h} />;
  if (item.widget === "boards") return <BoardsWidget w={item.w} h={item.h} />;
  if (item.widget === "notes") return <NotesWidget w={item.w} h={item.h} />;
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

// ── 식단: 1×1 오늘 칼로리 / 2×1 게이지 + 탄단지 / 2×2 끼니 요약 + 빠른 입력 (DESIGN.md 6.5 표) ──
function MealWidget({ w, h }: { w: number; h: number }) {
  const today = todayStr();
  const meals = useMeals(today);
  const settings = useSettings();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const totals = sumTotals(meals.data ?? []);
  const goal = settings.data?.goalKcal ?? null;

  if (w === 1) return <Count value={meals.data ? Math.round(totals.kcal) : undefined} label={goal ? `/ ${goal} kcal` : "오늘 kcal"} />;

  const pct = goal ? Math.min(100, (totals.kcal / goal) * 100) : 0;
  const summary = (
    <>
      <p className="text-lg font-semibold tabular-nums">
        {Math.round(totals.kcal)}
        <span className="ml-1 text-xs font-normal text-muted-foreground">{goal ? `/ ${goal} kcal` : "kcal"}</span>
      </p>
      {goal !== null && (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className={cn("h-full rounded-full", totals.kcal > goal ? "bg-red-500" : "bg-primary")} style={{ width: `${pct}%` }} />
        </div>
      )}
      <p className="text-[10px] tabular-nums text-muted-foreground">
        탄 {Math.round(totals.carb)} · 단 {Math.round(totals.protein)} · 지 {Math.round(totals.fat)} g
      </p>
    </>
  );

  if (h === 1) return <div className="mt-1 grid gap-1">{summary}</div>;

  return (
    <div className="mt-1 grid min-h-0 flex-1 content-start gap-1">
      {summary}
      <div className="grid grid-cols-2 gap-x-2 text-[11px]">
        {MEAL_TYPES.map((m) => (
          <p key={m.value} className="flex justify-between">
            <span className="text-muted-foreground">{m.label}</span>
            <span className="tabular-nums">{Math.round(sumTotals((meals.data ?? []).filter((x) => x.meal === m.value)).kcal)}</span>
          </p>
        ))}
      </div>
      <form
        className="mt-auto"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          // AI 추정 → 확인 단계를 거치도록 식단 화면으로 넘긴다
          if (text.trim()) navigate(`/health?draft=${encodeURIComponent(text.trim())}`);
        }}
      >
        <input
          aria-label="식단 빠른 입력"
          placeholder="+ 먹은 음식 (AI 계산)"
          value={text}
          maxLength={300}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          className="h-7 w-full rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      </form>
    </div>
  );
}

// ── 체중: 1×1 현재 체중 / 2×1 7일 추세 / 2×2 1개월 그래프 + 목표 (DESIGN.md 6.5 표) ──
function WeightWidget({ w, h }: { w: number; h: number }) {
  const today = todayStr();
  const weights = useWeights({ from: addDays(today, -29), to: today });
  const settings = useSettings();
  const list = weights.data ?? [];
  const latest = list.at(-1);
  const goal = settings.data?.goalWeight ?? null;

  if (w === 1) return <Count value={latest?.weight} label={latest ? "kg" : "기록 없음"} />;

  const days = h === 1 ? 7 : 30;
  const recent = withMovingAverage(list).filter((e) => e.date >= addDays(today, -(days - 1)));
  const first = recent[0];
  const delta = latest && first && first !== recent.at(-1) ? latest.weight - first.weight : null;

  return (
    <div className="mt-1 grid min-h-0 flex-1 grid-rows-[auto_1fr] gap-1">
      <p className="text-xs">
        <b className="text-base tabular-nums">{latest ? latest.weight.toFixed(1) : "–"}</b> kg
        {delta !== null && (
          <span className={cn("ml-1.5 tabular-nums", delta <= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
            {delta > 0 ? "+" : ""}
            {delta.toFixed(1)} ({days}일)
          </span>
        )}
        {h === 2 && goal !== null && <span className="ml-1.5 text-muted-foreground">목표 {goal}kg</span>}
      </p>
      {recent.length > 1 ? (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={recent} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
            <YAxis hide domain={["dataMin - 0.5", "dataMax + 0.5"]} />
            {h === 2 && goal !== null && <ReferenceLine y={goal} stroke="#ef4444" strokeDasharray="3 3" ifOverflow="extendDomain" />}
            <Line type="monotone" dataKey="avg7" stroke="var(--primary)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <p className="text-[10px] text-muted-foreground">기록이 2개 이상이면 추세가 보입니다.</p>
      )}
    </div>
  );
}

// ── 운동: 1×1 이번 주 러닝 거리 / 2×1 오늘 할 훈련 / 2×2 주간 요약 + 프로그램 진행률 (DESIGN.md 6.5 표) ──
function ExerciseWidget({ w, h }: { w: number; h: number }) {
  const today = todayStr();
  const monday = mondayOf(today);
  const runs = useRuns(monday, today);
  const gym = useGymSessions(monday, today);
  const programs = usePrograms();
  const active = programs.data?.find((p) => p.active);
  const records = useProgramRecords(active);
  const km = (runs.data ?? []).reduce((s, r) => s + r.distanceKm, 0);

  if (w === 1) return <Count value={runs.data ? Math.round(km * 10) / 10 : undefined} label="이번 주 km" />;
  if (h === 1) return <div className="mt-1"><TodayTraining compact /></div>;

  const doneCount = active ? active.items.filter((i) => isPlanDone(active, i, records.runs, records.gym)).length : 0;
  const pct = active && active.items.length ? Math.round((doneCount / active.items.length) * 100) : null;
  return (
    <div className="mt-1 grid min-h-0 flex-1 content-start gap-1.5 text-xs">
      <p className="tabular-nums">
        이번 주 러닝 <b>{km.toFixed(1)}km</b> ({runs.data?.length ?? 0}회) · 헬스 <b>{gym.data?.length ?? 0}회</b>
      </p>
      <TodayTraining compact />
      {active && pct !== null && (
        <div className="mt-auto grid gap-0.5">
          <p className="text-[10px] text-muted-foreground">
            {active.name} 진행률 {pct}% ({doneCount}/{active.items.length})
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── 작업 보드: 1×1 내 진행 중 카드 수 / 2×1 내 담당 마감 임박 / 2×2 즐겨찾기 보드 요약 (DESIGN.md 6.6) ──
function BoardsWidget({ w, h }: { w: number; h: number }) {
  const data = useBoards();
  const navigate = useNavigate();
  const today = todayStr();
  const myCards = data.data?.myCards ?? [];

  // "진행 중" = 완료 컬럼·보관이 아닌 내 담당 카드
  if (w === 1) return <Count value={data.data ? myCards.length : undefined} label="내 진행 중 카드" />;

  const open = (e: MouseEvent, path: string) => {
    e.stopPropagation();
    void navigate(path);
  };

  if (h === 1) {
    const soon = myCards.filter((c) => c.due && c.due <= addDays(today, 2));
    return (
      <div className="mt-1 grid min-h-0 flex-1 content-start gap-0.5 overflow-hidden text-xs">
        {data.data && soon.length === 0 && <p className="text-muted-foreground">마감 임박한 내 카드가 없습니다.</p>}
        {soon.slice(0, 3).map((c) => (
          <button key={c.id} type="button" onClick={(e) => open(e, `/boards/${c.boardId}`)} className="flex min-w-0 items-center gap-1.5 text-left">
            <span className={cn("shrink-0 tabular-nums", c.due! < today ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400")}>{formatDay(c.due!)}</span>
            <span className="truncate">{c.title}</span>
          </button>
        ))}
        {soon.length > 3 && <p className="text-[10px] text-muted-foreground">외 {soon.length - 3}개</p>}
      </div>
    );
  }

  const boards = data.data?.boards ?? [];
  const favorites = boards.filter((b) => b.favorite);
  const shown = (favorites.length ? favorites : boards).slice(0, 4);
  return (
    <div className="mt-1 grid min-h-0 flex-1 content-start gap-1.5 overflow-hidden text-xs">
      {data.data && shown.length === 0 && <p className="text-muted-foreground">보드가 없습니다.</p>}
      {data.data && boards.length > 0 && favorites.length === 0 && <p className="text-[10px] text-muted-foreground">☆ 즐겨찾기한 보드가 여기에 보입니다</p>}
      {shown.map((b) => {
        const pct = b.progress.total ? Math.round((b.progress.done / b.progress.total) * 100) : 0;
        return (
          <button key={b.id} type="button" onClick={(e) => open(e, `/boards/${b.id}`)} className="grid gap-0.5 text-left">
            <span className="flex justify-between gap-2">
              <span className="truncate font-medium">{b.name}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">진행 중 {b.activeCount} · {pct}%</span>
            </span>
            <span className="h-1 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── 메모: 1×1 빠른 메모(새 메모) / 2×1 최근 메모 3개 / 2×2 고정 메모 (DESIGN.md 6.7) ──
function NotesWidget({ w, h }: { w: number; h: number }) {
  const navigate = useNavigate();
  const me = useMe();
  const notes = useNotes(false);
  const open = (e: MouseEvent, path: string) => {
    e.stopPropagation();
    void navigate(path);
  };

  if (w === 1) {
    const canEdit = me.data?.perms.notes === "edit";
    return (
      <button type="button" disabled={!canEdit} onClick={(e) => open(e, "/notes/new")} className="mt-1 grid flex-1 place-items-center rounded-lg border border-dashed text-xs text-muted-foreground hover:bg-muted/50">
        {canEdit ? "+ 빠른 메모" : "메모"}
      </button>
    );
  }

  const list = notes.data ?? [];
  const shown = h === 1 ? list.slice(0, 3) : list.filter((n) => n.pinned).slice(0, 4);
  return (
    <div className="mt-1 grid min-h-0 flex-1 content-start gap-1 overflow-hidden text-xs">
      {notes.data && shown.length === 0 && <p className="text-muted-foreground">{h === 1 ? "메모가 없습니다." : "고정한 메모가 없습니다."}</p>}
      {shown.map((n) => (
        <button key={n.id} type="button" onClick={(e) => open(e, `/notes/${n.id}`)} className="grid min-w-0 text-left">
          <span className="truncate font-medium">{noteTitle(n)}</span>
          {h === 2 && notePreview(n) && <span className="line-clamp-2 text-[11px] text-muted-foreground">{notePreview(n)}</span>}
        </button>
      ))}
    </div>
  );
}
