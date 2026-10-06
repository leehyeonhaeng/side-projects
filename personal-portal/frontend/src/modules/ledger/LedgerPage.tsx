import { useEffect, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { addMonths, monthLabel, monthOf, totals, useApplyRecurring, useCategories, useTxns, won } from "@/api/ledger";
import { useMe } from "@/api/me";
import { PageTitle } from "@/components/ModuleIcon";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { todayStr } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { BudgetTab } from "./BudgetTab";
import { SettingsTab } from "./SettingsTab";
import { StatsTab } from "./StatsTab";
import { TxnTab } from "./TxnTab";

/** DESIGN.md 6.8 가계부: 월별 내역, 월간 요약, 통계, 예산, 고정 지출·카테고리 */
export function LedgerPage() {
  const me = useMe();
  const readOnly = me.data?.perms.ledger !== "edit";
  const thisMonth = monthOf(todayStr());
  const [month, setMonth] = useState(thisMonth);
  const txns = useTxns(month);
  const categories = useCategories();
  const apply = useApplyRecurring();

  // 열 때 한 번: 빠진 고정 지출 회차 생성
  const { mutate: applyRecurring } = apply;
  useEffect(() => {
    if (!readOnly) applyRecurring();
  }, [readOnly, applyRecurring]);

  const sum = totals(txns.data ?? []);

  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 md:p-6">
      <div className="flex items-center justify-between gap-2">
        <PageTitle module="ledger" />
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="이전 달" onClick={() => setMonth(addMonths(month, -1))}>
            <ChevronLeftIcon />
          </Button>
          <button type="button" className="min-w-24 text-sm font-medium" onClick={() => setMonth(thisMonth)} title="이번 달로">
            {monthLabel(month)}
          </button>
          <Button variant="ghost" size="icon-sm" aria-label="다음 달" disabled={month >= thisMonth} onClick={() => setMonth(addMonths(month, 1))}>
            <ChevronRightIcon />
          </Button>
        </div>
      </div>

      <section className="grid grid-cols-3 gap-3 rounded-2xl border bg-card p-4">
        <Stat label="수입" value={won(sum.income)} className="text-blue-600 dark:text-blue-400" />
        <Stat label="지출" value={won(sum.expense)} className="text-red-600 dark:text-red-400" />
        <Stat label="잔액" value={won(sum.balance)} />
      </section>
      <ErrorAlert error={apply.error} />

      {txns.isPending || categories.isPending ? (
        <InlineSpinner />
      ) : txns.isError || categories.isError ? (
        <ErrorAlert error={txns.error ?? categories.error} />
      ) : (
        <Tabs defaultValue="txns">
          <TabsList>
            <TabsTrigger value="txns">내역</TabsTrigger>
            <TabsTrigger value="stats">통계</TabsTrigger>
            <TabsTrigger value="budget">예산</TabsTrigger>
            <TabsTrigger value="settings">고정·카테고리</TabsTrigger>
          </TabsList>
          <TabsContent value="txns" className="pt-3">
            <TxnTab month={month} txns={txns.data} categories={categories.data} readOnly={readOnly} />
          </TabsContent>
          <TabsContent value="stats" className="pt-3">
            <StatsTab txns={txns.data} categories={categories.data} />
          </TabsContent>
          <TabsContent value="budget" className="pt-3">
            <BudgetTab month={month} txns={txns.data} categories={categories.data} readOnly={readOnly} />
          </TabsContent>
          <TabsContent value="settings" className="pt-3">
            <SettingsTab categories={categories.data} readOnly={readOnly} />
          </TabsContent>
        </Tabs>
      )}
    </main>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("truncate text-base font-semibold tabular-nums sm:text-lg", className)}>{value}</p>
    </div>
  );
}
