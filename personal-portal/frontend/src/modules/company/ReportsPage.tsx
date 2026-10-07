import { type ReactNode, useState } from "react";
import { DownloadIcon } from "lucide-react";
import { type Report, monthLabel, useReport } from "@/api/company";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { todayStr } from "@/lib/dates";
import { useCompanyOutlet } from "./CompanyLayout";
import { Chip, PageHead, money } from "./ui";

const addMonths = (ym: string, n: number) => {
  let y = Number(ym.slice(0, 4));
  let m = Number(ym.slice(5, 7)) + n;
  while (m < 1) (y -= 1), (m += 12);
  while (m > 12) (y += 1), (m -= 12);
  return `${y}-${String(m).padStart(2, "0")}`;
};

/** CSV 내려받기: 엑셀에서 한글이 안 깨지게 BOM, 값의 쉼표·따옴표는 감싼다 */
function downloadCsv(name: string, head: string[], rows: (string | number)[][]) {
  const cell = (v: string | number) => (typeof v === "number" ? String(v) : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const text = "﻿" + [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Range = "3" | "6" | "12" | "year";

/** 보고서 (COMPANY.md 4장): 월별 매출·수금·매입·경비, 거래처별, 품목별, 경비 항목별, 기기 가동률 + CSV */
export function ReportsPage() {
  const { cid, detail } = useCompanyOutlet();
  const [range, setRange] = useState<Range>("6");
  const to = todayStr().slice(0, 7);
  const from = range === "year" ? `${to.slice(0, 4)}-01` : addMonths(to, -(Number(range) - 1));
  const report = useReport(cid, from, to);
  const tag = `${detail.company.name}_${from}_${to}`;

  return (
    <main className="mx-auto grid max-w-4xl gap-4 p-4 md:p-6">
      <PageHead title="보고서" sub={`${from} ~ ${to} · 금액은 원, 매출은 청구 기준(부가세 별도 공급가액 / 합계)`} />
      <div className="flex flex-wrap gap-1">
        {(["3", "6", "12", "year"] as const).map((r) => (
          <Chip key={r} on={range === r} onClick={() => setRange(r)}>
            {r === "year" ? "올해" : `최근 ${r}개월`}
          </Chip>
        ))}
      </div>
      {report.isPending ? <InlineSpinner /> : report.isError ? <ErrorAlert error={report.error} /> : <Body r={report.data} tag={tag} />}
    </main>
  );
}

function Body({ r, tag }: { r: Report; tag: string }) {
  const max = Math.max(1, ...r.monthly.flatMap((m) => [m.salesSupply, m.receipts, m.purchaseSupply + m.expenses]));
  const total = r.monthly.reduce((s, m) => ({ sales: s.sales + m.salesTotal, receipts: s.receipts + m.receipts, purchase: s.purchase + m.purchaseTotal, expenses: s.expenses + m.expenses }), { sales: 0, receipts: 0, purchase: 0, expenses: 0 });
  return (
    <>
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["매출 (합계)", total.sales],
          ["수금", total.receipts],
          ["매입 (합계)", total.purchase],
          ["경비", total.expenses],
        ].map(([k, v]) => (
          <div key={k} className="rounded-2xl border bg-card p-3">
            <p className="text-xs text-muted-foreground">{k}</p>
            <p className="truncate text-lg font-bold tabular-nums">{money(v as number)}</p>
          </div>
        ))}
      </section>

      <Card
        title="월별"
        onCsv={() =>
          downloadCsv(`월별_${tag}.csv`, ["월", "매출 공급가액", "매출 세액", "매출 합계", "수금", "매입 공급가액", "매입 합계", "지급", "경비"], r.monthly.map((m) => [m.month, m.salesSupply, m.salesVat, m.salesTotal, m.receipts, m.purchaseSupply, m.purchaseTotal, m.payments, m.expenses]))
        }
      >
        <div className="grid gap-2">
          {r.monthly.map((m) => (
            <div key={m.month} className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-2 text-xs">
              <span className="text-muted-foreground">{monthLabel(m.month)}</span>
              <div className="grid gap-0.5">
                <Bar v={m.salesSupply} max={max} cls="bg-sky-500" label={`매출 ${money(m.salesSupply)}`} />
                <Bar v={m.receipts} max={max} cls="bg-emerald-500" label={`수금 ${money(m.receipts)}`} />
                <Bar v={m.purchaseSupply + m.expenses} max={max} cls="bg-rose-400" label={`매입+경비 ${money(m.purchaseSupply + m.expenses)}`} />
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="거래처별" onCsv={() => downloadCsv(`거래처별_${tag}.csv`, ["거래처", "매출", "수금", "매입", "지급", "현재 미수", "현재 미지급"], r.partners.map((p) => [p.name, p.salesTotal, p.receipts, p.purchaseTotal, p.payments, p.receivable, p.payable]))}>
        <Table head={["거래처", "매출", "미수"]} rows={r.partners.slice(0, 15).map((p) => [p.name, money(p.salesTotal), money(p.receivable)])} more={r.partners.length - 15} />
      </Card>

      <Card title="품목별" onCsv={() => downloadCsv(`품목별_${tag}.csv`, ["품목", "단위", "판매 수량", "판매 공급가액", "A/S 사용 수량", "매입 수량", "매입 공급가액"], r.items.map((i) => [i.name, i.unit, i.saleQty, i.saleSupply, i.usedQty, i.purchaseQty, i.purchaseSupply]))}>
        <Table head={["품목", "판매", "판매 금액", "매입"]} rows={r.items.slice(0, 15).map((i) => [i.name, `${i.saleQty}${i.unit}`, money(i.saleSupply), `${i.purchaseQty}${i.unit}`])} more={r.items.length - 15} />
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="경비 항목별" onCsv={() => downloadCsv(`경비_${tag}.csv`, ["항목", "금액"], r.expenses.map((e) => [e.category, e.amount]))}>
          <Table head={["항목", "금액"]} rows={r.expenses.map((e) => [e.category, money(e.amount)])} />
        </Card>
        <Card title="기기 가동률 (지금)" onCsv={() => downloadCsv(`기기가동률_${tag}.csv`, ["모델", "전체", "임대 중", "창고", "수리", "가동률(%)"], r.assets.map((a) => [a.name, a.total, a.rented, a.in_stock, a.repair, a.total ? Math.round((a.rented / a.total) * 100) : 0]))}>
          <Table head={["모델", "임대/전체", "가동률"]} rows={r.assets.map((a) => [a.name, `${a.rented}/${a.total}`, `${a.total ? Math.round((a.rented / a.total) * 100) : 0}%`])} />
        </Card>
      </div>
    </>
  );
}

function Card({ title, onCsv, children }: { title: string; onCsv: () => void; children: ReactNode }) {
  return (
    <section className="grid gap-3 rounded-2xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">{title}</h2>
        <Button size="xs" variant="outline" onClick={onCsv}>
          <DownloadIcon /> CSV
        </Button>
      </div>
      {children}
    </section>
  );
}

function Bar({ v, max, cls, label }: { v: number; max: number; cls: string; label: string }) {
  return (
    <div className="flex items-center gap-2" title={label}>
      <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${cls}`} style={{ width: `${Math.round((v / max) * 100)}%` }} />
      </div>
      <span className="w-24 shrink-0 truncate text-right tabular-nums">{money(v)}</span>
    </div>
  );
}

function Table({ head, rows, more = 0 }: { head: string[]; rows: string[][]; more?: number }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">이 기간에 없습니다.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            {head.map((h, i) => (
              <th key={h} className={`py-1.5 font-normal ${i === 0 ? "text-left" : "text-right"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b last:border-0">
              {r.map((c, j) => (
                <td key={j} className={`py-1.5 tabular-nums ${j === 0 ? "max-w-40 truncate pr-2 text-left" : "whitespace-nowrap pl-2 text-right"}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {more > 0 && <p className="pt-1 text-xs text-muted-foreground">외 {more}개는 CSV에</p>}
    </div>
  );
}
