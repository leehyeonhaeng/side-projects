import { type ReactNode, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  RUN_TYPES,
  type Run,
  type RunType,
  formatDuration,
  formatPace,
  mondayOf,
  parseDuration,
  useDeleteRun,
  useRunRecords,
  useRuns,
  useSaveRun,
} from "@/api/exercise";
import { ConfirmButton } from "@/components/ConfirmButton";
import { NativeSelect } from "@/components/NativeSelect";
import { ErrorAlert, FormError, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addDays, formatDay, todayStr } from "@/lib/dates";

const TYPE_LABEL = Object.fromEntries(RUN_TYPES.map((t) => [t.value, t.label])) as Record<RunType, string>;

/** DESIGN.md 6.5 러닝: 입력, 페이스·소모 칼로리 자동 계산, 주간 누적, 주간·월간 거리 그래프, 5K·10K 최고 페이스 */
export function RunPanel({ readOnly }: { readOnly: boolean }) {
  const today = todayStr();
  const from = addDays(today, -190);
  const runs = useRuns(from, today);
  const records = useRunRecords();
  const [editing, setEditing] = useState<Run | null>(null);

  if (runs.isPending) return <InlineSpinner />;
  if (runs.isError) return <ErrorAlert error={runs.error} />;

  const monday = mondayOf(today);
  const weekKm = runs.data.filter((r) => r.date >= monday).reduce((s, r) => s + r.distanceKm, 0);

  return (
    <div className="grid gap-4">
      <section className="grid grid-cols-3 gap-3 rounded-2xl border bg-card p-4">
        <Stat label="이번 주" value={`${weekKm.toFixed(1)}km`} />
        <Stat label="5K 최고" value={records.data?.best5k ? formatPace(records.data.best5k.paceSecPerKm) : "–"} sub={records.data?.best5k ? formatDay(records.data.best5k.date) : undefined} />
        <Stat label="10K 최고" value={records.data?.best10k ? formatPace(records.data.best10k.paceSecPerKm) : "–"} sub={records.data?.best10k ? formatDay(records.data.best10k.date) : undefined} />
      </section>

      {!readOnly && <RunForm key={editing?.id ?? "new"} original={editing} onDone={() => setEditing(null)} />}

      <DistanceChart runs={runs.data} />

      <section className="grid gap-1">
        <h3 className="text-sm font-medium">최근 기록</h3>
        {runs.data.length === 0 && <p className="text-sm text-muted-foreground">아직 기록이 없습니다.</p>}
        <ul className="grid gap-1">
          {[...runs.data].reverse().slice(0, 20).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg border px-3 py-2 text-sm">
              <span className="w-24 text-xs text-muted-foreground">{formatDay(r.date)}</span>
              <span className="font-medium tabular-nums">{r.distanceKm}km</span>
              <span className="tabular-nums">{formatDuration(r.durationSec)}</span>
              <span className="tabular-nums text-muted-foreground">{formatPace(r.paceSecPerKm)}</span>
              <span className="text-xs text-muted-foreground">
                {TYPE_LABEL[r.type]}
                {r.effort && ` · 강도 ${r.effort}`}
                {r.kcal !== undefined && ` · ${Math.round(r.kcal)}kcal${r.kcalEstimated ? "(추정)" : ""}`}
              </span>
              {!readOnly && (
                <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setEditing(r)}>
                  수정
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function RunForm({ original, onDone }: { original: Run | null; onDone: () => void }) {
  const [date, setDate] = useState(original?.date ?? todayStr());
  const [km, setKm] = useState(original?.distanceKm.toString() ?? "");
  const [time, setTime] = useState(original ? formatDuration(original.durationSec) : "");
  const [type, setType] = useState<RunType>(original?.type ?? "easy");
  const [effort, setEffort] = useState(original?.effort?.toString() ?? "");
  const [kcal, setKcal] = useState(original && !original.kcalEstimated && original.kcal !== undefined ? original.kcal.toString() : "");
  const [memo, setMemo] = useState(original?.memo ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = useSaveRun();
  const remove = useDeleteRun();

  const sec = parseDuration(time);
  const dist = Number(km);
  const pace = sec && dist > 0 ? formatPace(Math.round(sec / dist)) : null;

  const submit = () => {
    setError(null);
    if (!sec) return setError("시간은 25:30 또는 1:05:00 형식으로 입력하세요.");
    save.mutate(
      {
        original: original ?? undefined,
        input: { date, distanceKm: dist, durationSec: sec, type, effort: effort ? Number(effort) : null, kcal: kcal ? Number(kcal) : null, memo: memo.trim() },
      },
      { onSuccess: () => (setKm(""), setTime(""), setEffort(""), setKcal(""), setMemo(""), onDone()) },
    );
  };

  return (
    <form
      className="grid gap-2 rounded-2xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <Field label="날짜">
          <Input type="date" max={todayStr()} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-8 w-36" />
        </Field>
        <Field label="거리 (km)">
          <Input type="number" inputMode="decimal" step="0.01" min={0.01} required value={km} onChange={(e) => setKm(e.target.value)} className="h-8 w-20" />
        </Field>
        <Field label="시간 (분:초)">
          <Input inputMode="numeric" placeholder="25:30" required value={time} onChange={(e) => setTime(e.target.value)} className="h-8 w-24" />
        </Field>
        <Field label="유형">
          <NativeSelect value={type} onChange={(e) => setType(e.target.value as RunType)}>
            {RUN_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="체감 강도">
          <NativeSelect value={effort} onChange={(e) => setEffort(e.target.value)}>
            <option value="">-</option>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="소모 kcal (비우면 체중으로 추정)">
          <Input type="number" inputMode="numeric" min={0} value={kcal} onChange={(e) => setKcal(e.target.value)} className="h-8 w-28" />
        </Field>
        <Field label="메모" grow>
          <Input maxLength={500} value={memo} onChange={(e) => setMemo(e.target.value)} className="h-8" />
        </Field>
        <span className="pb-1.5 text-xs tabular-nums text-muted-foreground">{pace && `페이스 ${pace}`}</span>
      </div>
      <div className="flex gap-1">
        <Button type="submit" size="sm" disabled={!km || !time || save.isPending}>
          {original ? "수정" : "기록"}
        </Button>
        {original && (
          <>
            <Button type="button" size="sm" variant="ghost" onClick={onDone}>
              취소
            </Button>
            <ConfirmButton type="button" size="sm" variant="ghost" title="이 러닝 기록을 삭제할까요?" description={`${formatDay(original.date)} ${original.distanceKm}km`} confirmLabel="삭제" onConfirm={() => remove.mutateAsync(original).then(onDone)}>
              삭제
            </ConfirmButton>
          </>
        )}
      </div>
      <FormError message={error} />
      <ErrorAlert error={save.error ?? remove.error} />
    </form>
  );
}

function Field({ label, grow, children }: { label: string; grow?: boolean; children: ReactNode }) {
  return <label className={`grid gap-1 text-xs text-muted-foreground ${grow ? "min-w-40 flex-1" : ""}`}>{label}{children}</label>;
}

function DistanceChart({ runs }: { runs: Run[] }) {
  const [mode, setMode] = useState<"week" | "month">("week");
  const today = todayStr();
  const data =
    mode === "week"
      ? Array.from({ length: 12 }, (_, i) => {
          const start = addDays(mondayOf(today), -7 * (11 - i));
          const end = addDays(start, 6);
          const km = runs.filter((r) => r.date >= start && r.date <= end).reduce((s, r) => s + r.distanceKm, 0);
          return { label: start.slice(5).replace("-", "/"), km: Math.round(km * 10) / 10 };
        })
      : Array.from({ length: 6 }, (_, i) => {
          const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
          d.setUTCMonth(d.getUTCMonth() - (5 - i));
          const ym = d.toISOString().slice(0, 7);
          const km = runs.filter((r) => r.date.startsWith(ym)).reduce((s, r) => s + r.distanceKm, 0);
          return { label: `${Number(ym.slice(5))}월`, km: Math.round(km * 10) / 10 };
        });

  return (
    <section className="grid gap-2 rounded-2xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">거리</h3>
        <div className="flex gap-1">
          <Button size="xs" variant={mode === "week" ? "default" : "outline"} onClick={() => setMode("week")}>
            주간
          </Button>
          <Button size="xs" variant={mode === "month" ? "default" : "outline"} onClick={() => setMode("month")}>
            월간
          </Button>
        </div>
      </div>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={40} />
            <Tooltip cursor={{ fill: "var(--muted)" }} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} formatter={(v) => [`${v} km`, "거리"]} />
            <Bar dataKey="km" fill="var(--primary)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
