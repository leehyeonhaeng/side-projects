import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useMealStats } from "@/api/meals";
import { InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { addDays, todayStr } from "@/lib/dates";

/** 기록: 최근 7일·30일 일별 섭취 칼로리 + 평균선 (DESIGN.md 6.3) */
export function MealHistory({ goal }: { goal: number | null }) {
  const [days, setDays] = useState<7 | 30>(7);
  const today = todayStr();
  const from = addDays(today, -(days - 1));
  const stats = useMealStats(from, today);

  const data = Array.from({ length: days }, (_, i) => {
    const d = addDays(from, i);
    return { day: d.slice(5).replace("-", "/"), kcal: Math.round(stats.data?.[d]?.kcal ?? 0) };
  });
  // 기록이 있는 날만 평균에 넣는다 (안 먹은 날이 아니라 기록 안 한 날일 수 있음)
  const logged = data.filter((d) => d.kcal > 0);
  const avg = logged.length ? Math.round(logged.reduce((s, d) => s + d.kcal, 0) / logged.length) : 0;

  return (
    <section className="grid gap-2 rounded-2xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">
          기록 <span className="ml-1 text-xs font-normal text-muted-foreground">평균 {avg} kcal (기록한 {logged.length}일)</span>
        </h2>
        <div className="flex gap-1">
          {([7, 30] as const).map((n) => (
            <Button key={n} size="xs" variant={days === n ? "default" : "outline"} onClick={() => setDays(n)}>
              {n === 7 ? "주간" : "월간"}
            </Button>
          ))}
        </div>
      </div>
      {stats.isPending ? (
        <InlineSpinner />
      ) : (
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} interval={days === 30 ? 4 : 0} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={44} />
              <Tooltip
                cursor={{ fill: "var(--muted)" }}
                contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                formatter={(v) => [`${v} kcal`, "섭취"]}
              />
              <Bar dataKey="kcal" fill="var(--primary)" radius={[3, 3, 0, 0]} />
              {avg > 0 && <ReferenceLine y={avg} stroke="var(--muted-foreground)" strokeDasharray="4 4" />}
              {goal !== null && <ReferenceLine y={goal} stroke="#ef4444" strokeDasharray="2 4" />}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">점선: 평균{goal !== null && " · 빨간 점선: 목표"}</p>
    </section>
  );
}
