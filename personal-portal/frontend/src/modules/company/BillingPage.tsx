import { useEffect, useState } from "react";
import { Link } from "react-router";
import { AlertTriangleIcon, CheckCircle2Icon, XCircleIcon } from "lucide-react";
import { type PendingBill, monthLabel, useBilling, useRentalMutations } from "@/api/company";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDay, todayStr } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { useCompanyOutlet } from "./CompanyLayout";
import { type DraftLine, TxnLinesEditor, lineAmounts, toLineInput } from "./TxnLinesEditor";
import { PageHead, money } from "./ui";

type Draft = { on: boolean; date: string; lines: DraftLine[] };
const keyOf = (p: PendingBill) => `${p.contractId}:${p.month}`;
const toDraft = (p: PendingBill): Draft => ({
  on: p.warnings.length === 0,
  date: p.dueOn <= todayStr() ? p.dueOn : todayStr(),
  lines: p.lines.map((l) => ({ key: crypto.randomUUID(), itemId: "", name: l.name, qty: String(l.qty), unitPrice: String(l.unitPrice), vatMode: l.vatMode, override: null, memo: l.memo })),
});

/** 청구 대기 (COMPANY.md 5장 정기 청구): 청구일이 지난 계약의 이번 청구를 확인·수정해서 발행. 자동 발행은 없다 */
export function BillingPage() {
  const { cid } = useCompanyOutlet();
  const pending = useBilling(cid);
  const mut = useRentalMutations(cid);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [results, setResults] = useState<{ label: string; ok: boolean; error?: string; link?: string; total?: number }[] | null>(null);

  // 새로 올라온 청구는 제안 금액으로 초안을 만든다 (이미 고친 초안은 유지)
  useEffect(() => {
    if (!pending.data) return;
    setDrafts((d) => Object.fromEntries(pending.data.map((p) => [keyOf(p), d[keyOf(p)] ?? toDraft(p)])));
  }, [pending.data]);

  const rows = pending.data ?? [];
  const chosen = rows.filter((p) => drafts[keyOf(p)]?.on);
  const sumOf = (d?: Draft) => (d ? d.lines.map(lineAmounts).reduce((s, a) => s + a.total, 0) : 0);
  const total = chosen.reduce((s, p) => s + sumOf(drafts[keyOf(p)]), 0);
  const set = (k: string, patch: Partial<Draft>) => setDrafts({ ...drafts, [k]: { ...drafts[k]!, ...patch } });

  const issue = () => {
    const items = chosen.map((p) => {
      const d = drafts[keyOf(p)]!;
      return { contractId: p.contractId, month: p.month, date: d.date, lines: d.lines.map((l) => toLineInput(l, [])).filter((l) => l.name) };
    });
    mut.issueBills.mutate(items, {
      onSuccess: (r) =>
        setResults(
          r.results.map((x) => {
            const p = rows.find((q) => q.contractId === x.contractId && q.month === x.month);
            return { label: `${p?.partnerName ?? ""} ${monthLabel(x.month)}`, ok: x.ok, error: x.error, total: x.txn?.total, link: x.txn && `/company/${cid}/txns/${x.txn.date}/${x.txn.id}` };
          }),
        ),
    });
  };

  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 pb-28 md:p-6 md:pb-28">
      <PageHead title="청구 대기" sub="청구일이 지난 계약입니다. 금액을 확인하고 발행하세요" />
      {results && (
        <section className="grid gap-1.5 rounded-2xl border bg-card p-4">
          <h2 className="text-sm font-medium">발행 결과</h2>
          {results.map((r, i) => (
            <p key={i} className="flex items-center gap-2 text-sm">
              {r.ok ? <CheckCircle2Icon className="size-4 shrink-0 text-emerald-600" /> : <XCircleIcon className="size-4 shrink-0 text-destructive" />}
              <span className="min-w-0 flex-1 truncate">{r.label}</span>
              {r.ok && r.link ? (
                <Link to={r.link} className="shrink-0 text-primary tabular-nums">
                  {money(r.total)}
                </Link>
              ) : (
                <span className="shrink-0 text-xs text-destructive">{r.error}</span>
              )}
            </p>
          ))}
          <Button size="xs" variant="ghost" className="justify-self-start" onClick={() => setResults(null)}>
            닫기
          </Button>
        </section>
      )}
      {pending.isPending ? (
        <InlineSpinner />
      ) : pending.isError ? (
        <ErrorAlert error={pending.error} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">청구할 계약이 없습니다.</p>
      ) : (
        rows.map((p) => {
          const k = keyOf(p);
          const d = drafts[k];
          if (!d) return null;
          return (
            <section key={k} className={cn("grid gap-3 rounded-2xl border bg-card p-4", d.on && "border-primary/50")}>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1 size-4 accent-primary" checked={d.on} onChange={(e) => set(k, { on: e.target.checked })} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {p.partnerName} · {p.month.slice(0, 4)}년 {monthLabel(p.month)}
                    {p.final && <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">종료 정산</span>}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    <Link to={`/company/${cid}/contracts/${p.contractId}`} className="underline">
                      {p.contractNo}
                    </Link>{" "}
                    · 청구일 {formatDay(p.dueOn)}
                    </span>
                  {p.behind > 1 && <span className="block text-xs text-amber-600 dark:text-amber-400">밀린 달 {p.behind}개 · 한 달씩 차례로 발행</span>}
                </span>
                <span className="shrink-0 font-semibold tabular-nums">{money(sumOf(d))}</span>
              </label>
              {p.warnings.map((w) => (
                <p key={w} className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:bg-amber-400/10 dark:text-amber-300">
                  <AlertTriangleIcon className="size-3.5 shrink-0" /> <span className="min-w-0">{w} · <Link to={`/company/${cid}/readings`} className="whitespace-nowrap underline">검침 입력</Link> 또는 기본료만 청구</span>
                </p>
              ))}
              {p.counters.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {p.counters.map((c) => `${c.code} 흑백 ${c.fromMono.toLocaleString()}→${c.toMono.toLocaleString()}${c.toColor ? ` / 컬러 ${c.fromColor.toLocaleString()}→${c.toColor.toLocaleString()}` : ""} (${c.readAt})`).join(" · ")}
                </p>
              )}
              <label className="grid max-w-48 gap-1 text-xs text-muted-foreground">
                청구 날짜
                <Input type="date" value={d.date} onChange={(e) => e.target.value && set(k, { date: e.target.value })} className="h-9" />
              </label>
              <TxnLinesEditor lines={d.lines} onChange={(lines) => set(k, { lines })} items={[]} defaultVat={p.lines[0]?.vatMode ?? "excluded"} />
            </section>
          );
        })
      )}
      <ErrorAlert error={mut.issueBills.error} />
      {rows.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 border-t bg-card/95 px-4 py-3 backdrop-blur md:bottom-0 md:left-60">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <p className="min-w-0 flex-1 text-sm">
              {chosen.length}건 · <b className="tabular-nums">{money(total)}</b>
            </p>
            <Button disabled={chosen.length === 0 || mut.issueBills.isPending} onClick={issue}>
              {chosen.length}건 발행
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
