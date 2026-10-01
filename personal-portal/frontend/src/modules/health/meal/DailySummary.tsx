import type { Totals } from "@/api/meals";
import type { Settings } from "@/api/preferences";
import { cn } from "@/lib/utils";

const MACROS = [
  { key: "carb", label: "탄수화물", goal: "goalCarb", kcalPerG: 4, color: "bg-amber-500" },
  { key: "protein", label: "단백질", goal: "goalProtein", kcalPerG: 4, color: "bg-sky-500" },
  { key: "fat", label: "지방", goal: "goalFat", kcalPerG: 9, color: "bg-rose-500" },
] as const;

function Bar({ value, max, color }: { value: number; max: number | null; color: string }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  const over = max !== null && value > max;
  return (
    <div className="h-2 overflow-hidden rounded-full bg-muted">
      <div className={cn("h-full rounded-full transition-all", over ? "bg-red-500" : color)} style={{ width: `${max ? pct : 0}%` }} />
    </div>
  );
}

/** 오늘 섭취 칼로리 / 목표 게이지 + 탄단지 (DESIGN.md 6.3 화면) */
export function DailySummary({ totals, settings, burned }: { totals: Totals; settings?: Settings; burned: number }) {
  const goal = settings?.goalKcal ?? null;
  const macroKcal = totals.carb * 4 + totals.protein * 4 + totals.fat * 9;
  const remaining = goal !== null ? Math.round(goal - totals.kcal) : null;

  return (
    <section className="grid gap-3 rounded-2xl border bg-card p-4">
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-xs text-muted-foreground">섭취</p>
          <p className="text-2xl font-semibold tabular-nums">
            {Math.round(totals.kcal)}
            <span className="ml-1 text-sm font-normal text-muted-foreground">{goal !== null ? `/ ${goal} kcal` : "kcal"}</span>
          </p>
        </div>
        {remaining !== null && (
          <p className={cn("text-sm tabular-nums", remaining < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
            {remaining >= 0 ? `${remaining} kcal 남음` : `${-remaining} kcal 초과`}
          </p>
        )}
      </div>
      {goal !== null ? <Bar value={totals.kcal} max={goal} color="bg-primary" /> : <p className="text-xs text-muted-foreground">설정에서 목표 칼로리를 정하면 게이지가 표시됩니다.</p>}
      {/* 순섭취량 = 섭취 − 운동 소모 (러닝은 체중 기반 추정, 헬스는 직접 입력한 값) */}
      <p className="text-xs tabular-nums text-muted-foreground">
        운동 소모 {burned} kcal · 순섭취 <b className="text-foreground">{Math.round(totals.kcal - burned)}</b> kcal
      </p>

      <div className="grid grid-cols-3 gap-3">
        {MACROS.map((m) => {
          const grams = totals[m.key];
          const max = settings?.[m.goal] ?? null;
          const ratio = macroKcal > 0 ? Math.round(((grams * m.kcalPerG) / macroKcal) * 100) : 0;
          return (
            <div key={m.key} className="grid gap-1">
              <p className="text-xs text-muted-foreground">{m.label}</p>
              <p className="text-sm tabular-nums">
                {Math.round(grams)}
                {max !== null && <span className="text-muted-foreground">/{max}</span>}g <span className="text-xs text-muted-foreground">{ratio}%</span>
              </p>
              <Bar value={grams} max={max ?? (macroKcal > 0 ? macroKcal / m.kcalPerG : null)} color={m.color} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
