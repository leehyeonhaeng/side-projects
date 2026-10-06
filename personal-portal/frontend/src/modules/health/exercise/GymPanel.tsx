import { type ReactNode, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PlusIcon, XIcon } from "lucide-react";
import {
  type GymExercise,
  type GymSession,
  type Routine,
  useDeleteGym,
  useDeleteRoutine,
  useGymLast,
  useGymProgress,
  useGymSessions,
  useRoutines,
  useSaveGym,
  useSaveRoutine,
} from "@/api/exercise";
import { ConfirmButton } from "@/components/ConfirmButton";
import { NativeSelect } from "@/components/NativeSelect";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addDays, formatDay, todayStr } from "@/lib/dates";

/** DESIGN.md 6.5 헬스: 루틴 템플릿 → 운동별 세트·횟수·무게 (지난 기록 자동 채우기), 무게 추이, 소모 칼로리 선택 입력 */
export function GymPanel({ readOnly }: { readOnly: boolean }) {
  const today = todayStr();
  const sessions = useGymSessions(addDays(today, -365), today);
  const routines = useRoutines();
  const [draft, setDraft] = useState<{ key: number; routine: Routine | null; original: GymSession | null } | null>(null);
  const [managing, setManaging] = useState(false);

  if (sessions.isPending || routines.isPending) return <InlineSpinner />;
  if (sessions.isError || routines.isError) return <ErrorAlert error={sessions.error ?? routines.error} />;

  const exerciseNames = [...new Set(sessions.data.flatMap((s) => s.exercises.map((e) => e.name)))];

  return (
    <div className="grid gap-4">
      {!readOnly && !draft && (
        <div className="flex flex-wrap items-center gap-1.5">
          <NativeSelect
            aria-label="루틴으로 시작"
            value=""
            onChange={(e) => {
              const r = routines.data.find((x) => x.id === e.target.value);
              setDraft({ key: Date.now(), routine: r ?? null, original: null });
            }}
          >
            <option value="">+ 운동 기록 (루틴 선택)</option>
            {routines.data.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
            <option value="free">자유 운동</option>
          </NativeSelect>
          <Button size="sm" variant="ghost" onClick={() => setManaging((v) => !v)}>
            루틴 관리
          </Button>
        </div>
      )}
      {managing && <RoutineManager routines={routines.data} />}
      {draft && <SessionEditor key={draft.key} routine={draft.routine} original={draft.original} onDone={() => setDraft(null)} />}

      {exerciseNames.length > 0 && <ProgressChart names={exerciseNames} />}

      <section className="grid gap-1">
        <h3 className="text-sm font-medium">최근 기록</h3>
        {sessions.data.length === 0 && <p className="text-sm text-muted-foreground">아직 기록이 없습니다.</p>}
        <ul className="grid gap-1">
          {[...sessions.data].reverse().slice(0, 20).map((s) => (
            <li key={s.id} className="grid gap-0.5 rounded-lg border px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="w-24 text-xs text-muted-foreground">{formatDay(s.date)}</span>
                <span className="font-medium">{s.title}</span>
                {s.kcal !== undefined && <span className="text-xs text-muted-foreground">{Math.round(s.kcal)}kcal</span>}
                {!readOnly && (
                  <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setDraft({ key: Date.now(), routine: null, original: s })}>
                    수정
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {s.exercises.map((e) => `${e.name} ${e.sets.map((st) => (st.weight ? `${st.weight}×${st.reps}` : `${st.reps}회`)).join(", ")}`).join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function SessionEditor({ routine, original, onDone }: { routine: Routine | null; original: GymSession | null; onDone: () => void }) {
  const names = routine?.exercises.map((e) => e.name) ?? [];
  const last = useGymLast(original ? [] : names);
  const [date, setDate] = useState(original?.date ?? todayStr());
  const [title, setTitle] = useState(original?.title ?? routine?.name ?? "자유 운동");
  const [kcal, setKcal] = useState(original?.kcal?.toString() ?? "");
  const [memo, setMemo] = useState(original?.memo ?? "");
  const [exercises, setExercises] = useState<GymExercise[] | null>(original?.exercises ?? (routine ? null : [{ name: "", sets: [{ reps: 10, weight: 0 }] }]));
  const save = useSaveGym();
  const remove = useDeleteGym();

  if (!exercises && last.isPending) return <InlineSpinner />;
  // 루틴으로 시작하면 지난 기록으로 세트를 채운다 (없으면 루틴의 세트 수만큼 빈 칸)
  const current =
    exercises ??
    (routine?.exercises ?? []).map((e) => ({ name: e.name, sets: last.data?.[e.name]?.sets ?? Array.from({ length: e.sets }, () => ({ reps: 10, weight: 0 })) }));
  const update = (fn: (ex: GymExercise[]) => GymExercise[]) => setExercises(fn(current.map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s })) }))));

  const submit = () => {
    const clean = current.filter((e) => e.name.trim() && e.sets.length).map((e) => ({ ...e, name: e.name.trim() }));
    save.mutate(
      { original: original ?? undefined, input: { date, title: title.trim() || "운동", routineId: routine?.id, exercises: clean, kcal: kcal ? Number(kcal) : null, memo: memo.trim() } },
      { onSuccess: onDone },
    );
  };

  return (
    <section className="grid gap-3 rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="날짜">
          <Input type="date" max={todayStr()} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-8 w-36" />
        </Field>
        <Field label="제목">
          <Input maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} className="h-8 w-36" />
        </Field>
        <Field label="소모 kcal (선택)">
          <Input type="number" min={0} inputMode="numeric" value={kcal} onChange={(e) => setKcal(e.target.value)} className="h-8 w-24" />
        </Field>
      </div>
      {!original && routine && Object.keys(last.data ?? {}).length > 0 && <p className="text-xs text-muted-foreground">지난 기록으로 무게·횟수를 채웠습니다.</p>}

      {current.map((ex, i) => (
        <div key={i} className="grid gap-1.5 rounded-lg border p-2">
          <div className="flex items-center gap-1">
            <Input aria-label="운동 이름" placeholder="운동 이름" maxLength={60} value={ex.name} onChange={(e) => update((all) => (all[i]!.name = e.target.value, all))} className="h-8" />
            <Button size="icon-xs" variant="ghost" aria-label="운동 빼기" onClick={() => update((all) => all.filter((_, j) => j !== i))}>
              <XIcon />
            </Button>
          </div>
          {ex.sets.map((st, k) => (
            <div key={k} className="flex items-center gap-1.5 text-xs">
              <span className="w-8 text-muted-foreground">{k + 1}세트</span>
              <Input type="number" inputMode="decimal" step="0.5" min={0} aria-label={`${k + 1}세트 무게`} value={st.weight} onChange={(e) => update((all) => (all[i]!.sets[k]!.weight = Number(e.target.value) || 0, all))} className="h-7 w-20" />
              kg ×
              <Input type="number" inputMode="numeric" min={0} aria-label={`${k + 1}세트 횟수`} value={st.reps} onChange={(e) => update((all) => (all[i]!.sets[k]!.reps = Number(e.target.value) || 0, all))} className="h-7 w-16" />
              회
              <Button size="icon-xs" variant="ghost" aria-label="세트 빼기" disabled={ex.sets.length === 1} onClick={() => update((all) => (all[i]!.sets.splice(k, 1), all))}>
                <XIcon />
              </Button>
            </div>
          ))}
          <Button size="xs" variant="ghost" className="justify-self-start" onClick={() => update((all) => (all[i]!.sets.push({ ...(ex.sets.at(-1) ?? { reps: 10, weight: 0 }) }), all))}>
            + 세트
          </Button>
        </div>
      ))}
      <Button size="sm" variant="outline" className="justify-self-start" onClick={() => update((all) => [...all, { name: "", sets: [{ reps: 10, weight: 0 }] }])}>
        <PlusIcon data-icon="inline-start" />
        운동 추가
      </Button>
      <Field label="메모">
        <Input maxLength={500} value={memo} onChange={(e) => setMemo(e.target.value)} className="h-8" />
      </Field>
      <div className="flex gap-1">
        <Button size="sm" disabled={!current.some((e) => e.name.trim()) || save.isPending} onClick={submit}>
          저장
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          취소
        </Button>
        {original && (
          <ConfirmButton size="sm" variant="ghost" title="이 운동 기록을 삭제할까요?" description={`${formatDay(original.date)} ${original.title}`} confirmLabel="삭제" onConfirm={() => remove.mutateAsync(original).then(onDone)}>
            삭제
          </ConfirmButton>
        )}
      </div>
      <ErrorAlert error={save.error ?? remove.error} />
    </section>
  );
}

function RoutineManager({ routines }: { routines: Routine[] }) {
  const [editing, setEditing] = useState<Routine | { id?: undefined; name: string; exercises: Routine["exercises"] } | null>(null);
  const save = useSaveRoutine();
  const remove = useDeleteRoutine();

  return (
    <section className="grid gap-2 rounded-2xl border bg-card p-4">
      <h3 className="text-sm font-medium">루틴 (예: 상체 A, 코어)</h3>
      {routines.map((r) => (
        <div key={r.id} className="flex items-center gap-2 text-sm">
          <span className="font-medium">{r.name}</span>
          <span className="flex-1 truncate text-xs text-muted-foreground">{r.exercises.map((e) => `${e.name} ${e.sets}세트`).join(", ")}</span>
          <Button size="xs" variant="ghost" onClick={() => setEditing(r)}>
            수정
          </Button>
          <ConfirmButton size="xs" variant="ghost" title="루틴을 삭제할까요?" description={r.name} confirmLabel="삭제" onConfirm={() => remove.mutateAsync(r.id)}>
            삭제
          </ConfirmButton>
        </div>
      ))}
      {editing ? (
        <div className="grid gap-1.5 rounded-lg border p-2">
          <Input aria-label="루틴 이름" placeholder="루틴 이름" maxLength={40} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="h-8" />
          {editing.exercises.map((ex, i) => (
            <div key={i} className="flex items-center gap-1 text-xs">
              <Input aria-label="운동 이름" placeholder="운동 이름" maxLength={60} value={ex.name} onChange={(e) => setEditing({ ...editing, exercises: editing.exercises.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} className="h-7" />
              <Input type="number" min={1} max={30} aria-label="세트 수" value={ex.sets} onChange={(e) => setEditing({ ...editing, exercises: editing.exercises.map((x, j) => (j === i ? { ...x, sets: Number(e.target.value) || 1 } : x)) })} className="h-7 w-14" />
              세트
              <Button size="icon-xs" variant="ghost" aria-label="빼기" onClick={() => setEditing({ ...editing, exercises: editing.exercises.filter((_, j) => j !== i) })}>
                <XIcon />
              </Button>
            </div>
          ))}
          <div className="flex gap-1">
            <Button size="xs" variant="ghost" onClick={() => setEditing({ ...editing, exercises: [...editing.exercises, { name: "", sets: 3 }] })}>
              + 운동
            </Button>
            <Button
              size="xs"
              disabled={!editing.name.trim() || !editing.exercises.some((e) => e.name.trim()) || save.isPending}
              onClick={() =>
                save.mutate(
                  { id: editing.id, name: editing.name.trim(), exercises: editing.exercises.filter((e) => e.name.trim()).map((e) => ({ ...e, name: e.name.trim() })) },
                  { onSuccess: () => setEditing(null) },
                )
              }
            >
              저장
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setEditing(null)}>
              취소
            </Button>
          </div>
        </div>
      ) : (
        <Button size="xs" variant="outline" className="justify-self-start" onClick={() => setEditing({ name: "", exercises: [{ name: "", sets: 3 }] })}>
          + 루틴 만들기
        </Button>
      )}
      <ErrorAlert error={save.error ?? remove.error} />
    </section>
  );
}

function ProgressChart({ names }: { names: string[] }) {
  const [name, setName] = useState(names[0] ?? "");
  const progress = useGymProgress(name);
  const data = (progress.data ?? []).map((p) => ({ ...p, label: p.date.slice(5).replace("-", "/") }));

  return (
    <section className="grid gap-2 rounded-2xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">무게 추이</h3>
        <NativeSelect aria-label="운동 선택" value={name} onChange={(e) => setName(e.target.value)}>
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </NativeSelect>
      </div>
      {data.length < 2 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">기록이 2번 이상이면 추이가 보입니다.</p>
      ) : (
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} minTickGap={16} />
              <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={40} domain={["dataMin - 5", "dataMax + 5"]} />
              <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} formatter={(v) => [`${v} kg`, "최고 무게"]} />
              <Line type="monotone" dataKey="maxWeight" stroke="var(--primary)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      {label}
      {children}
    </label>
  );
}
