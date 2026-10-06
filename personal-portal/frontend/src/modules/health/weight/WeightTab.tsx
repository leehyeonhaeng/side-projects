import { useState } from "react";
import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { useMe } from "@/api/me";
import { useSettings } from "@/api/preferences";
import { type WeightEntry, entryOnOrBefore, useDeleteWeight, useSaveWeight, useWeights, withMovingAverage } from "@/api/weights";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addDays, formatDay, relativeDay, todayStr } from "@/lib/dates";
import { cn } from "@/lib/utils";

type Period = "1m" | "3m" | "all";
const PERIODS: { value: Period; label: string; days?: number }[] = [
  { value: "1m", label: "1개월", days: 30 },
  { value: "3m", label: "3개월", days: 90 },
  { value: "all", label: "전체" },
];

const fmt = (n: number) => `${n.toFixed(1)}kg`;
const signed = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}kg`;

/** DESIGN.md 6.4 체중: 요약 카드, 일별 + 7일 이동평균 그래프(인바디는 입력한 날만 점), 기록 */
export function WeightTab() {
  const me = useMe();
  const settings = useSettings();
  const all = useWeights();
  const [period, setPeriod] = useState<Period>("1m");
  const [editing, setEditing] = useState<WeightEntry | null>(null);
  const readOnly = me.data?.perms.health !== "edit";
  const today = todayStr();

  if (all.isPending) return <InlineSpinner />;
  if (all.isError) return <ErrorAlert error={all.error} />;

  const entries = all.data;
  const latest = entries.at(-1);
  const goal = settings.data?.goalWeight ?? null;
  // 지난주 대비: 최근 기록일 7일 전(포함 이전) 가장 가까운 기록과 비교
  const weekAgo = latest ? entryOnOrBefore(entries, addDays(latest.date, -7)) : undefined;

  const days = PERIODS.find((p) => p.value === period)?.days;
  const shown = withMovingAverage(entries).filter((e) => !days || e.date >= addDays(today, -(days - 1)));

  return (
    <div className="grid gap-4">
      <section className="grid grid-cols-2 gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-4">
        <Stat label="현재" value={latest ? fmt(latest.weight) : "–"} sub={latest ? relativeDay(latest.date) : "기록 없음"} />
        <Stat label="목표" value={goal !== null ? fmt(goal) : "–"} sub={goal === null ? "설정에서 입력" : undefined} />
        <Stat
          label="남은 차이"
          value={latest && goal !== null ? signed(latest.weight - goal) : "–"}
          tone={latest && goal !== null ? (Math.abs(latest.weight - goal) < 0.05 ? "good" : undefined) : undefined}
        />
        <Stat
          label="지난주 대비"
          value={latest && weekAgo ? signed(latest.weight - weekAgo.weight) : "–"}
          sub={weekAgo ? `${formatDay(weekAgo.date)} 기준` : "비교할 기록 없음"}
        />
      </section>

      {!readOnly && <WeightForm key={editing?.date ?? "new"} initial={editing} onDone={() => setEditing(null)} />}

      <section className="grid gap-2 rounded-2xl border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">추이</h2>
          <div className="flex gap-1">
            {PERIODS.map((p) => (
              <Button key={p.value} size="xs" variant={period === p.value ? "default" : "outline"} onClick={() => setPeriod(p.value)}>
                {p.label}
              </Button>
            ))}
          </div>
        </div>
        {shown.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">이 기간에 기록이 없습니다.</p>
        ) : (
          <WeightChart data={shown} goal={goal} />
        )}
        <p className="text-[11px] text-muted-foreground">실선: 7일 이동평균 · 점: 일별 체중 · 주황 점: 체지방률(%) · 초록 점: 골격근량(kg){goal !== null && " · 빨간 점선: 목표"}</p>
      </section>

      <section className="grid gap-1">
        <h2 className="text-sm font-medium">기록</h2>
        {entries.length === 0 && <p className="text-sm text-muted-foreground">아직 기록이 없습니다.</p>}
        <ul className="grid gap-1">
          {[...entries].reverse().slice(0, 30).map((e) => (
            <li key={e.date} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
              <span className="w-24 shrink-0 text-xs text-muted-foreground">{formatDay(e.date)}</span>
              <span className="font-medium tabular-nums">{fmt(e.weight)}</span>
              <span className="flex-1 truncate text-xs text-muted-foreground">
                {[e.bodyFat !== undefined && `체지방 ${e.bodyFat}%`, e.muscle !== undefined && `골격근 ${e.muscle}kg`, e.memo].filter(Boolean).join(" · ")}
              </span>
              {!readOnly && (
                <Button size="xs" variant="ghost" onClick={() => setEditing(e)}>
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

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-semibold tabular-nums", tone === "good" && "text-emerald-600 dark:text-emerald-400")}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function WeightForm({ initial, onDone }: { initial: WeightEntry | null; onDone: () => void }) {
  const [date, setDate] = useState(initial?.date ?? todayStr());
  const [weight, setWeight] = useState(initial?.weight.toString() ?? "");
  const [bodyFat, setBodyFat] = useState(initial?.bodyFat?.toString() ?? "");
  const [muscle, setMuscle] = useState(initial?.muscle?.toString() ?? "");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [showInbody, setShowInbody] = useState(Boolean(initial?.bodyFat || initial?.muscle));
  const save = useSaveWeight();
  const remove = useDeleteWeight();
  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  return (
    <form
      className="grid gap-2 rounded-2xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(
          { date, weight: Number(weight), bodyFat: num(bodyFat), muscle: num(muscle), memo: memo.trim() },
          {
            onSuccess: () => {
              setWeight("");
              setBodyFat("");
              setMuscle("");
              setMemo("");
              onDone();
            },
          },
        );
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs text-muted-foreground">
          날짜
          <Input type="date" max={todayStr()} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-8 w-36" />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          체중 (kg)
          <Input type="number" inputMode="decimal" step="0.1" min={20} max={300} required value={weight} onChange={(e) => setWeight(e.target.value)} className="h-8 w-24" autoFocus={Boolean(initial)} />
        </label>
        <Button type="submit" size="sm" disabled={!weight || save.isPending}>
          {initial ? "수정" : "기록"}
        </Button>
        {initial && (
          <>
            <Button type="button" size="sm" variant="ghost" onClick={onDone}>
              취소
            </Button>
            <ConfirmButton type="button" size="sm" variant="ghost" title="이 날 기록을 삭제할까요?" description={formatDay(initial.date)} confirmLabel="삭제" onConfirm={() => remove.mutateAsync(initial.date).then(onDone)}>
              삭제
            </ConfirmButton>
          </>
        )}
        {!showInbody && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setShowInbody(true)}>
            + 인바디·메모
          </Button>
        )}
      </div>
      {showInbody && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs text-muted-foreground">
            체지방률 (%)
            <Input type="number" inputMode="decimal" step="0.1" min={1} max={70} value={bodyFat} onChange={(e) => setBodyFat(e.target.value)} className="h-8 w-24" />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            골격근량 (kg)
            <Input type="number" inputMode="decimal" step="0.1" min={5} max={100} value={muscle} onChange={(e) => setMuscle(e.target.value)} className="h-8 w-24" />
          </label>
          <label className="grid flex-1 gap-1 text-xs text-muted-foreground">
            메모
            <Input maxLength={500} value={memo} onChange={(e) => setMemo(e.target.value)} className="h-8" />
          </label>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">같은 날짜에 다시 기록하면 그 날 기록이 바뀝니다.</p>
      <ErrorAlert error={save.error ?? remove.error} />
    </form>
  );
}

function WeightChart({ data, goal }: { data: (WeightEntry & { avg7: number })[]; goal: number | null }) {
  const rows = data.map((d) => ({ ...d, label: d.date.slice(5).replace("-", "/") }));
  const weights = data.map((d) => d.weight).concat(goal !== null ? [goal] : []);
  const min = Math.floor(Math.min(...weights) - 1);
  const max = Math.ceil(Math.max(...weights) + 1);
  const hasInbody = data.some((d) => d.bodyFat !== undefined || d.muscle !== undefined);

  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: hasInbody ? 0 : 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} minTickGap={16} />
          <YAxis yAxisId="w" domain={[min, max]} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={44} />
          {hasInbody && <YAxis yAxisId="i" orientation="right" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={32} />}
          <Tooltip
            contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
            formatter={(v, name) => {
              const label = name === "weight" ? "체중" : name === "avg7" ? "7일 평균" : name === "bodyFat" ? "체지방률" : "골격근량";
              return [name === "bodyFat" ? `${v}%` : `${v}kg`, label];
            }}
          />
          {goal !== null && <ReferenceLine yAxisId="w" y={goal} stroke="#ef4444" strokeDasharray="3 4" />}
          <Line yAxisId="w" type="monotone" dataKey="avg7" stroke="var(--primary)" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Scatter yAxisId="w" dataKey="weight" fill="var(--muted-foreground)" isAnimationActive={false} />
          {hasInbody && <Scatter yAxisId="i" dataKey="bodyFat" fill="#f97316" isAnimationActive={false} />}
          {hasInbody && <Scatter yAxisId="i" dataKey="muscle" fill="#22c55e" isAnimationActive={false} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
