import type { ReactNode } from "react";
import { Link } from "react-router";
import { ChevronRightIcon, EyeOffIcon, GaugeIcon, ReceiptTextIcon, ShieldCheckIcon, UserPlusIcon, WrenchIcon } from "lucide-react";
import { AREAS, LEVEL_LABEL, type MoneySums, useBilling, useDashboard, useNotifications, useReadings, useServices } from "@/api/company";
import { useMe } from "@/api/me";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { useCompanyOutlet } from "./CompanyLayout";
import { money } from "./ui";


/** 회사 홈 (대시보드, C6): 오늘 할 일, 빠른 입력, 이번 달 돈, 미수 상위, 재고 부족, 계약 만료 임박, 최근 알림, 내 권한 */
export function CompanyHomePage() {
  const { cid, detail } = useCompanyOutlet();
  const me = useMe();
  const { company, me: access } = detail;

  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{company.name}</h1>
        <p className="text-sm text-muted-foreground">{me.data?.name}님 · {access.isAdmin ? "관리자" : "직원"}</p>
      </div>

      <Todos cid={cid} />
      <QuickTxns cid={cid} />
      <DashboardCards cid={cid} />
      <RecentNotes cid={cid} />
      {access.isAdmin && (
        <section className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-4">
          <UserPlusIcon className="size-5 text-primary" />
          <p className="min-w-0 flex-1 text-sm">직원을 초대하고 역할별로 권한을 나누세요.</p>
          <Button size="sm" nativeButton={false} render={<Link to={`/company/${cid}/members`} />}>
            직원·권한
          </Button>
        </section>
      )}

      <section className="grid gap-2 rounded-2xl border bg-card p-4">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheckIcon className="size-4 text-primary" /> 내 권한
        </h2>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
          {AREAS.map((a) => (
            <li key={a.id} className="flex justify-between gap-2">
              <span className="truncate text-muted-foreground">{a.label}</span>
              <span className={cn("shrink-0", access.perms[a.id] === "none" && "text-muted-foreground/60")}>{LEVEL_LABEL[access.perms[a.id]]}</span>
            </li>
          ))}
        </ul>
        {!access.showAmounts && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <EyeOffIcon className="size-3.5" /> 금액은 보이지 않습니다.
          </p>
        )}
      </section>

    </main>
  );
}

const QUICK: { to: string; label: string; area: "txns" | "money" | "contracts" | "assets"; money: boolean }[] = [
  { to: "contracts/new", label: "임대 출고", area: "contracts", money: false },
  { to: "txns/new?type=rental_return", label: "수거", area: "txns", money: false },
  { to: "readings", label: "검침", area: "assets", money: false },
  { to: "services/new", label: "A/S 접수", area: "assets", money: false },
  { to: "txns/new?type=receipt", label: "입금 받기", area: "money", money: true },
  { to: "txns/new?type=sale", label: "판매", area: "txns", money: true },
];

/** 오늘 할 일: 청구 대기, 처리할 A/S, 검침 필요 (권한 있는 것만) */
function Todos({ cid }: { cid: string }) {
  const { detail } = useCompanyOutlet();
  const me = detail.me;
  const canBill = me.perms.contracts !== "none" && me.showAmounts;
  const canAssets = me.perms.assets !== "none";
  const billing = useBilling(cid, canBill);
  const services = useServices(cid, { status: "open" }, canAssets);
  const readings = useReadings(cid, canAssets);
  const rows: { to: string; icon: ReactNode; label: string; n: number }[] = [];
  if (canBill && billing.data) rows.push({ to: "billing", icon: <ReceiptTextIcon />, label: "청구 대기", n: billing.data.length });
  if (canAssets && services.data) rows.push({ to: "services", icon: <WrenchIcon />, label: "처리할 A/S", n: services.data.length });
  if (canAssets && readings.data) rows.push({ to: "readings", icon: <GaugeIcon />, label: "검침 필요", n: readings.data.filter((r) => !r.lastReading || r.lastReading.date <= r.billedReadAt).length });
  if (rows.length === 0) return null;
  return (
    <section className="grid grid-cols-3 gap-2">
      {rows.map((r) => (
        <Link key={r.to} to={`/company/${cid}/${r.to}`} className={cn("grid gap-1 rounded-2xl border bg-card p-3 hover:bg-muted/50 [&_svg]:size-4", r.n > 0 && "border-primary/40")}>
          <span className="flex items-center justify-between text-xs text-muted-foreground">
            {r.icon}
            <ChevronRightIcon />
          </span>
          <span className={cn("text-2xl font-bold tabular-nums", r.n === 0 && "text-muted-foreground")}>{r.n}</span>
          <span className="truncate text-xs">{r.label}</span>
        </Link>
      ))}
    </section>
  );
}

/** 자주 쓰는 거래 바로 입력 (현장에서 폰으로) */
function QuickTxns({ cid }: { cid: string }) {
  const { detail } = useCompanyOutlet();
  const me = detail.me;
  const acts = QUICK.filter((q) => me.perms[q.area] === "edit" && (!q.money || me.showAmounts) && (q.area !== "contracts" || me.perms.assets === "edit"));
  if (acts.length === 0) return null;
  return (
    <section className="grid grid-cols-3 gap-2">
      {acts.map((q) => (
        <Link key={q.to} to={`/company/${cid}/${q.to}`} className="grid place-items-center rounded-2xl border bg-card px-2 py-4 text-sm font-medium hover:bg-muted/50 active:bg-muted">
          {q.label}
        </Link>
      ))}
    </section>
  );
}

function Delta({ now, before }: { now: number; before: number }) {
  if (!before) return null;
  const pct = Math.round(((now - before) / before) * 100);
  return <span className={cn("text-[11px]", pct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>지난달 {pct >= 0 ? "+" : ""}{pct}%</span>;
}

const MONEY_TILES: [keyof MoneySums, string][] = [
  ["salesTotal", "매출"],
  ["receipts", "수금"],
  ["purchaseTotal", "매입"],
  ["expenses", "경비"],
];

/** 이번 달 돈·미수 상위·재고 부족·계약 만료 임박 (권한 있는 것만 서버가 보낸다) */
function DashboardCards({ cid }: { cid: string }) {
  const d = useDashboard(cid);
  if (!d.data) return null;
  const { money: m, receivables, lowStock, expiring } = d.data;
  return (
    <>
      {m && (
        <section className="grid gap-2">
          <h2 className="text-sm font-medium">{Number(d.data.month.slice(5))}월</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {MONEY_TILES.map(([k, label]) => (
              <div key={k} className="grid gap-0.5 rounded-2xl border bg-card p-3">
                <span className="text-xs text-muted-foreground">{label}</span>
                <span className="truncate font-bold tabular-nums">{money(m.this[k])}</span>
                <Delta now={m.this[k]} before={m.last[k]} />
              </div>
            ))}
          </div>
        </section>
      )}
      {receivables && receivables.top.length > 0 && (
        <section className="grid gap-2 rounded-2xl border bg-card p-4">
          <h2 className="flex items-center justify-between text-sm font-medium">
            미수 {receivables.partners}곳 · {money(receivables.total)}
            <Link to={`/company/${cid}/money`} className="text-xs font-normal text-primary">
              전체
            </Link>
          </h2>
          <ul className="grid gap-1 text-sm">
            {receivables.top.map((p) => (
              <li key={p.id}>
                <Link to={`/company/${cid}/partners/${p.id}`} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{p.name}</span>
                  <span className="shrink-0 text-right tabular-nums">
                    {money(p.receivable)}
                    {p.overdue > 0 && <span className="block text-[11px] text-red-600 dark:text-red-400">연체 {money(p.overdue)}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground">연체 = 청구 후 {receivables.overdueDays}일 지남 (회사 설정)</p>
        </section>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {lowStock && lowStock.length > 0 && (
          <section className="grid content-start gap-2 rounded-2xl border border-amber-300/60 bg-card p-4">
            <h2 className="text-sm font-medium">재고 부족 {lowStock.length}개</h2>
            <ul className="grid gap-1 text-sm">
              {lowStock.slice(0, 6).map((i) => (
                <li key={i.id} className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">{i.name}</span>
                  <span className="shrink-0 tabular-nums text-amber-700 dark:text-amber-400">
                    {i.qty}/{i.minStock}
                    {i.unit}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {expiring && expiring.length > 0 && (
          <section className="grid content-start gap-2 rounded-2xl border bg-card p-4">
            <h2 className="text-sm font-medium">계약 만료 임박 {expiring.length}건</h2>
            <ul className="grid gap-1 text-sm">
              {expiring.slice(0, 6).map((c) => (
                <li key={c.id}>
                  <Link to={`/company/${cid}/contracts/${c.id}`} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate">{c.partnerName}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{c.termEnd}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}

function RecentNotes({ cid }: { cid: string }) {
  const n = useNotifications(cid);
  const items = n.data?.notifications.slice(0, 3) ?? [];
  if (items.length === 0) return null;
  return (
    <section className="grid gap-2 rounded-2xl border bg-card p-4">
      <h2 className="flex items-center justify-between text-sm font-medium">
        최근 알림
        <Link to={`/company/${cid}/notifications`} className="text-xs font-normal text-primary">
          전체·설정
        </Link>
      </h2>
      <ul className="grid gap-1.5 text-sm">
        {items.map((x, i) => (
          <li key={i}>
            <Link to={x.url} className="flex justify-between gap-2">
              <span className={cn("min-w-0 truncate", x.unread && "font-semibold")}>{x.title}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{formatTime(x.at)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
