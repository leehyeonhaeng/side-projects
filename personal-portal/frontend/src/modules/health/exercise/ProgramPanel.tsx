import { type MouseEvent, useState } from "react";
import { CheckIcon, XIcon } from "lucide-react";
import {
  type PlanItem,
  type Program,
  type ProgramInput,
  isPlanDone,
  planDate,
  programEnd,
  useDeleteProgram,
  useGymSessions,
  useProgramDone,
  usePrograms,
  useRuns,
  useSaveProgram,
} from "@/api/exercise";
import { ConfirmButton } from "@/components/ConfirmButton";
import { NativeSelect } from "@/components/NativeSelect";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ISO_WEEKDAYS, formatDay, todayStr } from "@/lib/dates";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<PlanItem["kind"], string> = { run: "러닝", gym: "헬스", other: "기타" };

/** 프로그램 기간의 러닝·헬스 기록 (자동 완료 판정용) */
export function useProgramRecords(program: Program | undefined) {
  const from = program?.startDate ?? todayStr();
  const to = program ? programEnd(program) : todayStr();
  const runs = useRuns(from, to, Boolean(program));
  const gym = useGymSessions(from, to, Boolean(program));
  return { runs: runs.data ?? [], gym: gym.data ?? [], pending: Boolean(program) && (runs.isPending || gym.isPending) };
}

/** 오늘 할 훈련 (DESIGN.md 6.5): 진행 중 프로그램의 오늘 항목과 완료 여부 */
export function TodayTraining({ compact = false }: { compact?: boolean }) {
  const programs = usePrograms();
  const active = programs.data?.find((p) => p.active);
  const { runs, gym } = useProgramRecords(active);
  const done = useProgramDone();
  const today = todayStr();
  if (!active) return compact ? <p className="text-xs text-muted-foreground">진행 중인 프로그램 없음</p> : null;
  const items = active.items.filter((i) => planDate(active, i) === today);

  return (
    <div className={cn("grid gap-1", !compact && "rounded-2xl border bg-card p-4")}>
      {!compact && <p className="text-xs text-muted-foreground">오늘 할 훈련 · {active.name}</p>}
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">오늘은 계획이 없습니다 (휴식).</p>
      ) : (
        items.map((item, i) => {
          const ok = isPlanDone(active, item, runs, gym);
          return (
            <div key={i} className="flex items-center gap-2 text-sm">
              <PlanCheck
                done={ok}
                manual={item.kind === "other"}
                onToggle={(e) => {
                  e.stopPropagation();
                  done.mutate({ id: active.id, date: today, done: !ok });
                }}
              />
              <span className={cn("truncate", ok && "text-muted-foreground line-through")}>{item.title}</span>
              <span className="text-[10px] text-muted-foreground">{KIND_LABEL[item.kind]}</span>
            </div>
          );
        })
      )}
    </div>
  );
}

function PlanCheck({ done, manual, onToggle }: { done: boolean; manual: boolean; onToggle: (e: MouseEvent) => void }) {
  const mark = (
    <span className={cn("grid size-4 shrink-0 place-items-center rounded-full border", done ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/60")}>
      {done && <CheckIcon className="size-3" />}
    </span>
  );
  // 러닝·헬스는 기록으로 자동 체크되므로 버튼이 아니다
  return manual ? (
    <button type="button" aria-label={done ? "완료 취소" : "완료"} onClick={onToggle} className="-m-1 p-1">
      {mark}
    </button>
  ) : (
    <span title="그날 기록이 있으면 자동 완료">{mark}</span>
  );
}

/** DESIGN.md 6.5 훈련 프로그램: 주차·요일별 계획, 오늘 할 훈련, 기록 입력 시 자동 완료, 주차별 달성률 */
export function ProgramPanel({ readOnly }: { readOnly: boolean }) {
  const programs = usePrograms();
  const [editing, setEditing] = useState<{ key: number; program: Program | null } | null>(null);

  if (programs.isPending) return <InlineSpinner />;
  if (programs.isError) return <ErrorAlert error={programs.error} />;
  const active = programs.data.find((p) => p.active);
  const others = programs.data.filter((p) => !p.active);

  return (
    <div className="grid gap-4">
      {editing ? (
        <ProgramEditor key={editing.key} program={editing.program} onDone={() => setEditing(null)} />
      ) : (
        !readOnly && (
          <Button size="sm" variant="outline" className="justify-self-start" onClick={() => setEditing({ key: Date.now(), program: null })}>
            + 새 프로그램
          </Button>
        )
      )}
      {active ? (
        <ActiveProgram program={active} readOnly={readOnly} onEdit={() => setEditing({ key: Date.now(), program: active })} />
      ) : (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">진행 중인 프로그램이 없습니다.</p>
      )}
      {others.length > 0 && <OtherPrograms programs={others} readOnly={readOnly} />}
    </div>
  );
}

function ActiveProgram({ program, readOnly, onEdit }: { program: Program; readOnly: boolean; onEdit: () => void }) {
  const { runs, gym, pending } = useProgramRecords(program);
  const done = useProgramDone();
  const today = todayStr();
  if (pending) return <InlineSpinner />;

  const rate = (items: PlanItem[]) => (items.length ? Math.round((items.filter((i) => isPlanDone(program, i, runs, gym)).length / items.length) * 100) : null);
  const overall = rate(program.items);
  const weeks = Array.from({ length: program.weeks }, (_, i) => i + 1);

  return (
    <section className="grid gap-3 rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-medium">{program.name}</h3>
          <p className="text-xs text-muted-foreground">
            {formatDay(planDate(program, { week: 1, weekday: 1, kind: "other", title: "" }))} ~ {formatDay(programEnd(program))} · {program.weeks}주
            {overall !== null && ` · 전체 달성률 ${overall}%`}
          </p>
        </div>
        {!readOnly && (
          <Button size="xs" variant="ghost" onClick={onEdit}>
            편집
          </Button>
        )}
      </div>
      {weeks.map((w) => {
        const items = program.items.filter((i) => i.week === w).sort((a, b) => a.weekday - b.weekday);
        const r = rate(items);
        return (
          <div key={w} className="grid gap-1">
            <p className="text-xs font-medium text-muted-foreground">
              {w}주차 {r !== null && <span className="ml-1 font-normal">달성률 {r}%</span>}
            </p>
            {items.length === 0 && <p className="text-xs text-muted-foreground">계획 없음</p>}
            {items.map((item, i) => {
              const day = planDate(program, item);
              const ok = isPlanDone(program, item, runs, gym);
              return (
                <div key={i} className={cn("flex items-center gap-2 rounded-md px-2 py-1 text-sm", day === today && "bg-primary/5")}>
                  <PlanCheck done={ok} manual={item.kind === "other" && !readOnly} onToggle={() => done.mutate({ id: program.id, date: day, done: !ok })} />
                  <span className="w-20 shrink-0 text-xs text-muted-foreground">{formatDay(day)}</span>
                  <span className={cn("flex-1 truncate", ok && "text-muted-foreground line-through")}>{item.title}</span>
                  <span className="text-[10px] text-muted-foreground">{KIND_LABEL[item.kind]}</span>
                </div>
              );
            })}
          </div>
        );
      })}
      <p className="text-[11px] text-muted-foreground">러닝·헬스 계획은 그날 기록을 넣으면 자동으로 완료됩니다. 기타는 직접 체크하세요.</p>
    </section>
  );
}

function OtherPrograms({ programs, readOnly }: { programs: Program[]; readOnly: boolean }) {
  const save = useSaveProgram();
  const remove = useDeleteProgram();
  return (
    <section className="grid gap-1">
      <h3 className="text-sm font-medium">다른 프로그램</h3>
      {programs.map((p) => (
        <div key={p.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          <span className="flex-1 truncate">
            {p.name} <span className="text-xs text-muted-foreground">{p.weeks}주 · {formatDay(p.startDate)} 시작</span>
          </span>
          {!readOnly && (
            <>
              <Button size="xs" variant="outline" onClick={() => save.mutate({ id: p.id, input: { name: p.name, startDate: p.startDate, weeks: p.weeks, items: p.items, active: true } })}>
                진행하기
              </Button>
              <ConfirmButton size="xs" variant="ghost" title="프로그램을 삭제할까요?" description={p.name} confirmLabel="삭제" onConfirm={() => remove.mutateAsync(p.id)}>
                삭제
              </ConfirmButton>
            </>
          )}
        </div>
      ))}
    </section>
  );
}

function ProgramEditor({ program, onDone }: { program: Program | null; onDone: () => void }) {
  const [input, setInput] = useState<ProgramInput>(
    program ? { name: program.name, startDate: program.startDate, weeks: program.weeks, items: program.items, active: program.active } : { name: "", startDate: todayStr(), weeks: 4, items: [], active: true },
  );
  const save = useSaveProgram();
  const set = (patch: Partial<ProgramInput>) => setInput((p) => ({ ...p, ...patch }));
  const setItem = (i: number, patch: Partial<PlanItem>) => set({ items: input.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) });

  // 마지막 주 계획을 다음 주로 그대로 복사 (매주 같은 패턴을 빠르게 입력)
  const copyLastWeek = () => {
    const lastWeek = Math.max(0, ...input.items.map((i) => i.week));
    if (lastWeek === 0 || lastWeek >= input.weeks) return;
    set({ items: [...input.items, ...input.items.filter((i) => i.week === lastWeek).map((i) => ({ ...i, week: lastWeek + 1 }))] });
  };

  return (
    <section className="grid gap-3 rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs text-muted-foreground">
          이름
          <Input maxLength={40} value={input.name} onChange={(e) => set({ name: e.target.value })} className="h-8 w-40" placeholder="예: 10K 준비" />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          시작일 (그 주 월요일이 1주차)
          <Input type="date" value={input.startDate} onChange={(e) => e.target.value && set({ startDate: e.target.value })} className="h-8 w-36" />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          기간 (주)
          <Input type="number" min={1} max={52} value={input.weeks} onChange={(e) => set({ weeks: Math.max(1, Math.min(52, Number(e.target.value) || 1)) })} className="h-8 w-16" />
        </label>
      </div>

      <div className="grid gap-1">
        {input.items.map((item, i) => (
          <div key={i} className="flex flex-wrap items-center gap-1 text-xs">
            <NativeSelect aria-label="주차" value={item.week} onChange={(e) => setItem(i, { week: Number(e.target.value) })}>
              {Array.from({ length: input.weeks }, (_, w) => (
                <option key={w + 1} value={w + 1}>
                  {w + 1}주
                </option>
              ))}
            </NativeSelect>
            <NativeSelect aria-label="요일" value={item.weekday} onChange={(e) => setItem(i, { weekday: Number(e.target.value) })}>
              {ISO_WEEKDAYS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect aria-label="종류" value={item.kind} onChange={(e) => setItem(i, { kind: e.target.value as PlanItem["kind"] })}>
              <option value="run">러닝</option>
              <option value="gym">헬스</option>
              <option value="other">기타</option>
            </NativeSelect>
            <Input aria-label="내용" placeholder="예: 이지런 5km" maxLength={80} value={item.title} onChange={(e) => setItem(i, { title: e.target.value })} className="h-8 min-w-32 flex-1" />
            <Button size="icon-xs" variant="ghost" aria-label="빼기" onClick={() => set({ items: input.items.filter((_, j) => j !== i) })}>
              <XIcon />
            </Button>
          </div>
        ))}
        <div className="flex gap-1">
          <Button size="xs" variant="ghost" onClick={() => set({ items: [...input.items, { week: Math.max(1, ...input.items.map((x) => x.week)), weekday: 1, kind: "run", title: "" }] })}>
            + 계획
          </Button>
          <Button size="xs" variant="ghost" disabled={input.items.length === 0} onClick={copyLastWeek}>
            마지막 주를 다음 주로 복사
          </Button>
        </div>
      </div>

      <div className="flex gap-1">
        <Button
          size="sm"
          disabled={!input.name.trim() || save.isPending}
          onClick={() =>
            save.mutate(
              { id: program?.id, input: { ...input, name: input.name.trim(), items: input.items.filter((i) => i.title.trim() && i.week <= input.weeks).map((i) => ({ ...i, title: i.title.trim() })) } },
              { onSuccess: onDone },
            )
          }
        >
          저장{!program && " (진행 중으로 설정)"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          취소
        </Button>
      </div>
      <ErrorAlert error={save.error} />
    </section>
  );
}

