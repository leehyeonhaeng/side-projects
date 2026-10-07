import type { ReactNode } from "react";
import { Link } from "react-router";
import { ChevronRightIcon, EyeOffIcon, GaugeIcon, ReceiptTextIcon, ShieldCheckIcon, UserPlusIcon, WrenchIcon } from "lucide-react";
import { AREAS, LEVEL_LABEL, useBilling, useReadings, useServices } from "@/api/company";
import { useMe } from "@/api/me";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCompanyOutlet } from "./CompanyLayout";

// COMPANY.md 11장 구현 단계 — 대시보드가 생기기 전까지 홈에서 진행 상황을 보여 준다
const COMING = [
  { phase: "C6", items: "대시보드 · 보고서 · 알림" },
];

/** 회사 홈: 오늘 할 일(청구 대기·A/S·검침), 빠른 입력, 내 권한. C6에서 대시보드로 바뀐다 */
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

      <section className="grid gap-2 rounded-2xl border border-dashed p-4">
        <h2 className="text-sm font-medium">준비 중인 기능</h2>
        <ul className="grid gap-1 text-sm">
          {COMING.map((c) => (
            <li key={c.phase} className="flex gap-2">
              <span className="w-8 shrink-0 text-xs font-medium text-muted-foreground">{c.phase}</span>
              <span className="text-muted-foreground">{c.items}</span>
            </li>
          ))}
        </ul>
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
