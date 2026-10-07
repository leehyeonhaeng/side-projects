import { Link } from "react-router";
import { EyeOffIcon, ShieldCheckIcon, UserPlusIcon } from "lucide-react";
import { AREAS, LEVEL_LABEL } from "@/api/company";
import { useMe } from "@/api/me";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCompanyOutlet } from "./CompanyLayout";

// COMPANY.md 11장 구현 단계 — 대시보드가 생기기 전까지 홈에서 진행 상황을 보여 준다
const COMING = [
  { phase: "C4", items: "임대 계약 · 정기 청구 · 카운터 검침 · A/S" },
  { phase: "C5", items: "직인 영수증·명세서·청구서 PDF · 기기 라벨 QR" },
  { phase: "C6", items: "대시보드 · 보고서 · 알림" },
];

/** 회사 홈 (C1): 내 권한 요약, 관리자 바로가기. C6에서 대시보드로 바뀐다 */
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

const QUICK: { type: string; label: string; area: "txns" | "money"; money: boolean }[] = [
  { type: "rental_out", label: "임대 출고", area: "txns", money: false },
  { type: "rental_return", label: "수거", area: "txns", money: false },
  { type: "receipt", label: "입금 받기", area: "money", money: true },
  { type: "sale", label: "판매", area: "txns", money: true },
  { type: "charge", label: "청구", area: "txns", money: true },
  { type: "purchase", label: "매입", area: "txns", money: true },
];

/** 자주 쓰는 거래 바로 입력 (현장에서 폰으로) */
function QuickTxns({ cid }: { cid: string }) {
  const { detail } = useCompanyOutlet();
  const me = detail.me;
  const acts = QUICK.filter((q) => me.perms[q.area] === "edit" && (!q.money || me.showAmounts));
  if (acts.length === 0) return null;
  return (
    <section className="grid grid-cols-3 gap-2">
      {acts.map((q) => (
        <Link key={q.type} to={`/company/${cid}/txns/new?type=${q.type}`} className="grid place-items-center rounded-2xl border bg-card px-2 py-4 text-sm font-medium hover:bg-muted/50 active:bg-muted">
          {q.label}
        </Link>
      ))}
    </section>
  );
}
