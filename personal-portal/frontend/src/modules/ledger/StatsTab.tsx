import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { type Category, type Txn, categoryColor, expenseByCategory, useTxnSummary, won } from "@/api/ledger";
import { ErrorAlert, InlineSpinner } from "@/components/states";

const TOOLTIP = { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 };

/** 카테고리 원형 차트 (이 달 지출) + 월별 추이 (최근 6개월) */
export function StatsTab({ txns, categories }: { txns: Txn[]; categories: Category[] }) {
  const summary = useTxnSummary(6);
  const name = (id: string) => categories.find((c) => c.id === id)?.name ?? "(삭제된 카테고리)";
  const byCat = expenseByCategory(txns);
  const total = byCat.reduce((s, c) => s + c.amount, 0);

  return (
    <div className="grid gap-4">
      <section className="grid gap-2 rounded-2xl border bg-card p-4">
        <h3 className="text-sm font-medium">카테고리별 지출</h3>
        {byCat.length === 0 ? (
          <p className="text-sm text-muted-foreground">이 달 지출이 없습니다.</p>
        ) : (
          <div className="grid items-center gap-4 sm:grid-cols-2">
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={byCat.map((c) => ({ ...c, name: name(c.categoryId) }))} dataKey="amount" nameKey="name" innerRadius="55%" outerRadius="90%" paddingAngle={1} stroke="var(--card)">
                    {byCat.map((c) => (
                      <Cell key={c.categoryId} fill={categoryColor(categories, c.categoryId)} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP} formatter={(v) => won(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="grid gap-1 text-sm">
              {byCat.map((c) => (
                <li key={c.categoryId} className="flex items-center gap-2">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: categoryColor(categories, c.categoryId) }} />
                  <span className="flex-1 truncate">{name(c.categoryId)}</span>
                  <span className="tabular-nums">{won(c.amount)}</span>
                  <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{Math.round((c.amount / total) * 100)}%</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="grid gap-2 rounded-2xl border bg-card p-4">
        <h3 className="text-sm font-medium">월별 추이 (최근 6개월)</h3>
        {summary.isPending ? (
          <InlineSpinner />
        ) : summary.isError ? (
          <ErrorAlert error={summary.error} />
        ) : (
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summary.data.months.map((m) => ({ ...m, label: `${Number(m.month.slice(5))}월` }))} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => (v >= 10000 ? `${Math.round(v / 10000)}만` : String(v))} />
                <Tooltip cursor={{ fill: "var(--muted)" }} contentStyle={TOOLTIP} formatter={(v, n) => [won(Number(v)), n === "income" ? "수입" : "지출"]} />
                <Legend formatter={(v) => (v === "income" ? "수입" : "지출")} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="income" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                <Bar dataKey="expense" fill="#ef4444" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
    </div>
  );
}
