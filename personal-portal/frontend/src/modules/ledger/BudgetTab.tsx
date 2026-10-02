import { useState } from "react";
import { type Category, type Txn, expenseByCategory, monthLabel, useBudget, useLedgerMutations, won } from "@/api/ledger";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = { month: string; txns: Txn[]; categories: Category[]; readOnly: boolean };

/** 카테고리별 월 예산 + 초과 표시. 저장하면 이 달부터 계속 적용 (DESIGN.md 6.8 구현 결정) */
export function BudgetTab({ month, txns, categories, readOnly }: Props) {
  const budget = useBudget(month);
  const [editing, setEditing] = useState(false);

  if (budget.isPending) return <InlineSpinner />;
  if (budget.isError) return <ErrorAlert error={budget.error} />;

  const spent = new Map(expenseByCategory(txns).map((c) => [c.categoryId, c.amount]));
  const expenseCats = categories.filter((c) => c.type === "expense");
  const amounts = budget.data.amounts;
  const budgeted = expenseCats.filter((c) => amounts[c.id]);
  const totalBudget = budgeted.reduce((s, c) => s + (amounts[c.id] ?? 0), 0);
  const totalSpent = budgeted.reduce((s, c) => s + (spent.get(c.id) ?? 0), 0);

  if (editing) return <BudgetEditor key={month} month={month} categories={expenseCats} amounts={amounts} onDone={() => setEditing(false)} />;

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{budget.data.from ? `${monthLabel(budget.data.from)}에 정한 예산 적용 중` : "예산이 없습니다."}</p>
        {!readOnly && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            예산 {budget.data.from ? "수정" : "정하기"}
          </Button>
        )}
      </div>
      {budgeted.length > 0 && (
        <section className="grid gap-2 rounded-2xl border bg-card p-4">
          <Gauge label="전체 (예산 있는 카테고리)" spent={totalSpent} budget={totalBudget} strong />
          {budgeted.map((c) => (
            <Gauge key={c.id} label={c.name} spent={spent.get(c.id) ?? 0} budget={amounts[c.id] ?? 0} />
          ))}
        </section>
      )}
    </div>
  );
}

export function Gauge({ label, spent, budget, strong }: { label: string; spent: number; budget: number; strong?: boolean }) {
  const over = spent > budget;
  const pct = budget ? Math.min(100, (spent / budget) * 100) : 0;
  return (
    <div className="grid gap-1">
      <div className="flex justify-between gap-2 text-sm">
        <span className={cn(strong && "font-medium")}>{label}</span>
        <span className={cn("tabular-nums", over ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
          {won(spent)} / {won(budget)}
          {over && ` (${won(spent - budget)} 초과)`}
        </span>
      </div>
      <div className={cn("overflow-hidden rounded-full bg-muted", strong ? "h-2.5" : "h-1.5")}>
        <div className={cn("h-full rounded-full", over ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-primary")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function BudgetEditor({ month, categories, amounts, onDone }: { month: string; categories: Category[]; amounts: Record<string, number>; onDone: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(categories.map((c) => [c.id, amounts[c.id] ? String(amounts[c.id]) : ""])));
  const mut = useLedgerMutations();
  const total = Object.values(values).reduce((s, v) => s + (Number(v) || 0), 0);

  return (
    <form
      className="grid gap-3 rounded-2xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const out = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v) || 0]));
        mut.putBudget.mutate({ month, amounts: out }, { onSuccess: onDone });
      }}
    >
      <p className="text-xs text-muted-foreground">{monthLabel(month)}부터 계속 적용됩니다. 비우면 예산 없음.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {categories.map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-sm">
            <span className="w-24 shrink-0 truncate">{c.name}</span>
            <Input inputMode="numeric" placeholder="0" value={values[c.id]} onChange={(e) => setValues({ ...values, [c.id]: e.target.value.replace(/\D/g, "") })} className="h-8" />
          </label>
        ))}
      </div>
      <p className="text-sm tabular-nums">합계 {won(total)}</p>
      <ErrorAlert error={mut.putBudget.error} />
      <div className="flex gap-1">
        <Button type="submit" size="sm" disabled={mut.putBudget.isPending}>
          저장
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          취소
        </Button>
      </div>
    </form>
  );
}
