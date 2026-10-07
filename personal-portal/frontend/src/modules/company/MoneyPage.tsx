import { useState } from "react";
import { Link } from "react-router";
import { LockIcon, LockOpenIcon } from "lucide-react";
import { TXN_LABEL, useAccounts, useCloses, useLedger, useReceivables, useTxnMutations } from "@/api/company";
import { ConfirmButton } from "@/components/ConfirmButton";
import { NativeSelect } from "@/components/NativeSelect";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { addDays, formatDay, todayStr } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { useCompanyOutlet } from "./CompanyLayout";
import { PageHead, money } from "./ui";

/** 돈 (COMPANY.md 4장): 미수·미지급 / 회사 장부 / 월 마감 */
export function MoneyPage() {
  const { cid, detail } = useCompanyOutlet();
  if (!detail.me.showAmounts || detail.me.perms.money === "none") return <main className="p-4 text-sm text-muted-foreground">돈 화면을 볼 권한이 없습니다.</main>;
  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 md:p-6">
      <PageHead title="돈" />
      <Tabs defaultValue="balances">
        <TabsList>
          <TabsTrigger value="balances">미수·미지급</TabsTrigger>
          <TabsTrigger value="ledger">회사 장부</TabsTrigger>
          {detail.me.isAdmin && <TabsTrigger value="close">월 마감</TabsTrigger>}
        </TabsList>
        <TabsContent value="balances" className="pt-3">
          <Balances cid={cid} canPay={detail.me.perms.money === "edit"} />
        </TabsContent>
        <TabsContent value="ledger" className="pt-3">
          <Ledger cid={cid} />
        </TabsContent>
        <TabsContent value="close" className="pt-3">
          <Closes cid={cid} />
        </TabsContent>
      </Tabs>
    </main>
  );
}

function Balances({ cid, canPay }: { cid: string; canPay: boolean }) {
  const rows = useReceivables(cid);
  if (rows.isPending) return <InlineSpinner />;
  if (rows.isError) return <ErrorAlert error={rows.error} />;
  const sum = (k: "receivable" | "advance" | "payable" | "prepaid") => rows.data.reduce((s, r) => s + r[k], 0);
  return (
    <div className="grid gap-3">
      <section className="grid grid-cols-2 gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-4">
        {(
          [
            ["미수금", "receivable", "text-red-600 dark:text-red-400"],
            ["선수금", "advance", ""],
            ["미지급금", "payable", "text-amber-600 dark:text-amber-400"],
            ["선급금", "prepaid", ""],
          ] as const
        ).map(([label, k, tone]) => (
          <div key={k} className="min-w-0">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={cn("truncate font-semibold tabular-nums", sum(k) > 0 && tone)}>{money(sum(k))}</p>
          </div>
        ))}
      </section>
      {rows.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">남은 미수·미지급이 없습니다.</p>
      ) : (
        <ul className="grid gap-1.5">
          {rows.data.map((r) => (
            <li key={r.id} className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2.5">
              <Link to={`/company/${cid}/partners/${r.id}`} className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{r.name}</span>
                <span className="block text-xs text-muted-foreground tabular-nums">
                  {[r.receivable && `미수 ${money(r.receivable)}`, r.advance && `선수 ${money(r.advance)}`, r.payable && `미지급 ${money(r.payable)}`, r.prepaid && `선급 ${money(r.prepaid)}`].filter(Boolean).join(" · ")}
                </span>
              </Link>
              {canPay && r.receivable > 0 && (
                <Button size="xs" variant="outline" nativeButton={false} render={<Link to={`/company/${cid}/txns/new?type=receipt&partner=${r.id}`} />}>
                  입금 받기
                </Button>
              )}
              {canPay && r.payable > 0 && (
                <Button size="xs" variant="outline" nativeButton={false} render={<Link to={`/company/${cid}/txns/new?type=payment&partner=${r.id}`} />}>
                  지급
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Ledger({ cid }: { cid: string }) {
  const today = todayStr();
  const [from, setFrom] = useState(addDays(today, -30));
  const [to, setTo] = useState(today);
  const [accountId, setAccountId] = useState("");
  const accounts = useAccounts(cid);
  const ledger = useLedger(cid, from, to, accountId || undefined);
  const name = (id: string) => accounts.data?.find((a) => a.id === id)?.name ?? "";

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <Input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} className="h-9 w-40" aria-label="시작일" />
        <Input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} className="h-9 w-40" aria-label="종료일" />
        <NativeSelect value={accountId} onChange={(e) => setAccountId(e.target.value)} className="h-9" aria-label="계좌">
          <option value="">모든 계좌</option>
          {accounts.data?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      {ledger.isPending ? (
        <InlineSpinner />
      ) : ledger.isError ? (
        <ErrorAlert error={ledger.error} />
      ) : (
        <>
          <section className="flex flex-wrap gap-x-4 gap-y-1 rounded-xl bg-muted/50 px-4 py-2.5 text-sm tabular-nums">
            {ledger.data.accounts.map((a) => (
              <span key={a.id}>
                {a.name} <b>{money(a.balance)}</b>
              </span>
            ))}
          </section>
          {ledger.data.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">이 기간에 입출금이 없습니다.</p>
          ) : (
            <ul className="grid divide-y overflow-hidden rounded-2xl border bg-card">
              {ledger.data.rows.map((r) => (
                <li key={r.id}>
                  <Link to={`/company/${cid}/txns/${r.date}/${r.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">
                        {TXN_LABEL[r.type]} · {r.partnerName || r.category || r.memo || "—"}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {formatDay(r.date)} · {r.accountName || name(r.accountId)}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-sm tabular-nums">
                      <span className={cn("block font-semibold", r.amount > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                        {r.amount > 0 ? "+" : ""}
                        {money(r.amount)}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">잔액 {money(r.balanceAfter)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function Closes({ cid }: { cid: string }) {
  const closes = useCloses(cid);
  const mut = useTxnMutations(cid);
  const thisMonth = todayStr().slice(0, 7);
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(`${thisMonth}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - (i + 1));
    return d.toISOString().slice(0, 7);
  });
  if (closes.isPending) return <InlineSpinner />;
  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted-foreground">마감한 달의 거래는 새로 넣거나 취소할 수 없습니다. 필요하면 관리자가 마감을 풀 수 있고, 모든 기록이 남습니다.</p>
      <ul className="grid gap-1.5">
        {months.map((m) => {
          const closed = closes.data?.includes(m);
          return (
            <li key={m} className="flex items-center gap-3 rounded-xl border bg-card px-4 py-2.5 text-sm">
              {closed ? <LockIcon className="size-4 text-primary" /> : <LockOpenIcon className="size-4 text-muted-foreground" />}
              <span className="flex-1">
                {m.slice(0, 4)}년 {Number(m.slice(5))}월 {closed && <span className="text-xs text-muted-foreground">마감됨</span>}
              </span>
              {closed ? (
                <ConfirmButton size="xs" variant="ghost" title="마감을 풀까요?" description={`${m} 거래를 다시 넣거나 취소할 수 있게 됩니다.`} confirmLabel="마감 해제" onConfirm={() => mut.reopen.mutateAsync(m)}>
                  해제
                </ConfirmButton>
              ) : (
                <ConfirmButton size="xs" variant="outline" title={`${m} 마감할까요?`} description="이 달의 거래를 더 이상 넣거나 취소할 수 없게 됩니다." confirmLabel="마감" onConfirm={() => mut.close.mutateAsync(m)}>
                  마감
                </ConfirmButton>
              )}
            </li>
          );
        })}
      </ul>
      <ErrorAlert error={mut.close.error ?? mut.reopen.error} />
    </div>
  );
}
