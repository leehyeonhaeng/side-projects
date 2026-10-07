import { type ReactNode, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { ArrowLeftIcon, CheckCircle2Icon, PlusIcon, ReceiptTextIcon } from "lucide-react";
import { CONTRACT_STATUS_LABEL, type Contract, type ContractMachine, type ContractStatus, VAT_LABEL, billingDayLabel, monthLabel, useContract, useContracts } from "@/api/company";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { addDays, formatDay, todayStr } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { useCompanyOutlet } from "./CompanyLayout";
import { TxnRow } from "./TxnsPage";
import { Chip, PageHead, Search, matches, money } from "./ui";

export const CONTRACT_TONE: Record<ContractStatus, string> = {
  active: "bg-sky-100 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300",
  ended: "bg-zinc-200 text-zinc-600 dark:bg-zinc-500/20 dark:text-zinc-400",
  canceled: "bg-zinc-200 text-zinc-500 line-through dark:bg-zinc-500/20",
};

export function ContractBadge({ status }: { status: ContractStatus }) {
  return <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", CONTRACT_TONE[status])}>{CONTRACT_STATUS_LABEL[status]}</span>;
}

/** 기기 한 대 요금 한 줄 요약: "월 120,000원 · 흑백 기본 1,000매, 초과 10원" */
export function termsText(m: Pick<ContractMachine, "monthly" | "counter" | "freeMono" | "freeColor" | "overMono" | "overColor">, showAmounts: boolean): string {
  const parts: string[] = [];
  if (showAmounts) parts.push(m.monthly ? `월 ${money(m.monthly)}` : "기본료 없음");
  if (m.counter) {
    const mono = `흑백 기본 ${m.freeMono.toLocaleString()}매${showAmounts && m.overMono ? `, 초과 ${m.overMono}원` : ""}`;
    const color = m.freeColor || m.overColor ? `컬러 기본 ${m.freeColor.toLocaleString()}매${showAmounts && m.overColor ? `, 초과 ${m.overColor}원` : ""}` : "";
    parts.push([mono, color].filter(Boolean).join(" / "));
  } else parts.push("월 고정");
  return parts.join(" · ");
}

const active = (c: Contract) => Object.values(c.machines).filter((m) => !m.endedAt);
const monthlySum = (c: Contract) => active(c).reduce((s, m) => s + (m.monthly ?? 0), 0);

/** 임대 계약 목록 (COMPANY.md 4장) */
export function ContractsPage() {
  const { cid, detail } = useCompanyOutlet();
  const me = detail.me;
  const contracts = useContracts(cid);
  const [status, setStatus] = useState<ContractStatus | "all">("active");
  const [q, setQ] = useState("");
  const canAdd = me.perms.contracts === "edit" && me.perms.assets === "edit";
  const soon = addDays(todayStr(), 31);

  const shown = (contracts.data ?? []).filter((c) => (status === "all" ? c.status !== "canceled" : c.status === status)).filter((c) => matches([c.no, c.partnerName, ...Object.values(c.machines).map((m) => m.code)].join(" "), q));

  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 md:p-6">
      <PageHead
        title="임대 계약"
        sub="거래처 + 기기 + 요금. 매달 청구 대기에 올라옵니다"
        action={
          canAdd && (
            <Button nativeButton={false} render={<Link to={`/company/${cid}/contracts/new`} />}>
              <PlusIcon /> 새 계약
            </Button>
          )
        }
      />
      <Search value={q} onChange={setQ} placeholder="계약 번호·거래처·기기 번호" />
      <div className="flex flex-wrap gap-1">
        {(["active", "ended", "all"] as const).map((s) => (
          <Chip key={s} on={status === s} onClick={() => setStatus(s)}>
            {s === "all" ? "전체" : CONTRACT_STATUS_LABEL[s]}
          </Chip>
        ))}
      </div>
      {contracts.isPending ? (
        <InlineSpinner />
      ) : contracts.isError ? (
        <ErrorAlert error={contracts.error} />
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{status === "active" ? "진행 중인 계약이 없습니다. 기기를 임대 출고하면 계약이 만들어집니다." : "계약이 없습니다."}</p>
      ) : (
        <ul className="grid gap-1.5">
          {shown.map((c) => (
            <li key={c.id}>
              <Link to={`/company/${cid}/contracts/${c.id}`} className={cn("flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 hover:bg-muted/50", c.status !== "active" && "opacity-70")}>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <ContractBadge status={c.status} />
                    <span className="truncate text-sm font-medium">{c.partnerName}</span>
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {c.no} · 기기 {active(c).length}대 · 매월 {billingDayLabel(c.billingDay)} 청구{c.billedThrough ? ` · ${monthLabel(c.billedThrough)}까지 청구` : ""}
                  </span>
                  {c.status === "active" && c.termEnd && c.termEnd <= soon && <span className="block text-[11px] text-amber-600 dark:text-amber-400">만료 {c.termEnd <= todayStr() ? "지남" : "임박"} · {c.termEnd}</span>}
                </span>
                {me.showAmounts && c.status === "active" && <span className="shrink-0 text-sm font-semibold tabular-nums">월 {money(monthlySum(c))}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

/** 계약 상세: 조건, 기기별 요금, 다음 청구, 이 계약의 거래 */
export function ContractDetailPage() {
  const { cid, detail } = useCompanyOutlet();
  const me = detail.me;
  const { kid = "" } = useParams();
  const location = useLocation();
  const data = useContract(cid, kid);
  const notice = (location.state as { notice?: string } | null)?.notice;

  if (data.isPending) return <main className="p-4"><InlineSpinner /></main>;
  if (data.isError) return <main className="p-4"><ErrorAlert error={data.error} /></main>;
  const { contract: c, txns, pending } = data.data;
  const machines = Object.values(c.machines).sort((a, b) => Number(!!a.endedAt) - Number(!!b.endedAt) || a.code.localeCompare(b.code));
  const canEdit = me.perms.contracts === "edit";
  const today = todayStr();
  const due = pending && (pending.final || pending.dueOn <= today);
  const pendingTotal = pending?.lines.reduce((s, l) => s + Math.round(l.qty * l.unitPrice), 0) ?? 0;

  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 md:p-6">
      <Link to={`/company/${cid}/contracts`} className="flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeftIcon className="size-4" /> 임대 계약
      </Link>
      {notice && (
        <p className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300">
          <CheckCircle2Icon className="size-4 shrink-0" /> {notice}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <ContractBadge status={c.status} />
        <h1 className="text-xl font-bold tracking-tight">{c.no}</h1>
      </div>
      <section className="grid gap-2 rounded-2xl border bg-card p-4 text-sm">
        <Row label="거래처" value={<Link className="text-primary" to={`/company/${cid}/partners/${c.partnerId}`}>{c.partnerName}</Link>} />
        <Row label="시작" value={formatDay(c.startDate)} />
        {c.endedAt && <Row label="종료" value={formatDay(c.endedAt)} />}
        {c.termEnd && <Row label="만료 예정" value={c.termEnd} />}
        <Row label="청구일" value={`매월 ${billingDayLabel(c.billingDay)} · ${VAT_LABEL[c.vatMode]}`} />
        <Row label="청구한 달" value={c.billedThrough ? `${c.billedThrough.slice(0, 4)}년 ${monthLabel(c.billedThrough)}까지` : "아직 없음"} />
        {c.memo && <Row label="메모" value={c.memo} />}
      </section>

      {pending && (
        <section className={cn("flex flex-wrap items-center gap-3 rounded-2xl border p-4", due ? "border-primary/40 bg-primary/5" : "bg-card")}>
          <ReceiptTextIcon className="size-5 text-primary" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium">
              다음 청구: {pending.month.slice(0, 4)}년 {monthLabel(pending.month)}
              {pending.final && " (종료 정산)"}
            </p>
            <p className="text-xs text-muted-foreground">
              {due ? "청구할 수 있습니다" : `${formatDay(pending.dueOn)}부터 청구 대기에 올라옵니다`} · 제안 금액 {money(pendingTotal)} (부가세 전)
            </p>
            {pending.warnings.map((w) => (
              <p key={w} className="text-xs text-amber-600 dark:text-amber-400">
                {w}
              </p>
            ))}
          </div>
          {due && canEdit && (
            <Button size="sm" nativeButton={false} render={<Link to={`/company/${cid}/billing`} />}>
              청구 대기로
            </Button>
          )}
        </section>
      )}

      {/* 기기 추가·조건 수정은 계약 편집(사무실), 수거는 기기 편집 권한(현장 기사)도 */}
      {c.status === "active" && (canEdit || me.perms.assets === "edit") && (
        <div className="flex flex-wrap gap-2">
          {canEdit && me.perms.assets === "edit" && (
            <Button size="sm" nativeButton={false} render={<Link to={`/company/${cid}/contracts/new?contract=${c.id}&partner=${c.partnerId}`} />}>
              기기 추가
            </Button>
          )}
          {(canEdit || me.perms.assets === "edit") && (
            <Button size="sm" variant="outline" nativeButton={false} render={<Link to={`/company/${cid}/contracts/${c.id}/return`} />}>
              수거
            </Button>
          )}
          {canEdit && (
            <Button size="sm" variant="outline" nativeButton={false} render={<Link to={`/company/${cid}/contracts/${c.id}/edit`} />}>
              조건 수정
            </Button>
          )}
        </div>
      )}

      <section className="grid gap-2">
        <h2 className="text-sm font-medium">기기 {active(c).length}대{machines.length > active(c).length && <span className="text-muted-foreground"> (수거 {machines.length - active(c).length}대)</span>}</h2>
        <ul className="grid gap-1.5">
          {machines.map((m) => (
            <li key={m.assetId}>
              <Link to={`/company/${cid}/assets/${m.assetId}`} className={cn("grid gap-0.5 rounded-xl border bg-card px-3 py-2.5 text-sm", m.endedAt && "opacity-60")}>
                <span className="flex items-center gap-2">
                  <span className="font-mono font-semibold">{m.code}</span>
                  <span className="min-w-0 flex-1 truncate">{m.itemName}</span>
                  {m.endedAt && <span className="shrink-0 text-[11px] text-muted-foreground">수거 {m.endedAt}</span>}
                </span>
                <span className="text-xs text-muted-foreground">{termsText(m, me.showAmounts)}</span>
                <span className="text-xs text-muted-foreground">
                  {m.startedAt} 설치{m.counter && ` · 지난 청구 카운터 흑백 ${m.billedMono.toLocaleString()}${m.billedColor || m.freeColor ? ` / 컬러 ${m.billedColor.toLocaleString()}` : ""}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-2">
        <h2 className="text-sm font-medium">이 계약의 거래</h2>
        {txns.length === 0 ? (
          <p className="text-sm text-muted-foreground">거래가 없습니다.</p>
        ) : (
          <ul className="grid gap-1.5">
            {txns.map((t) => (
              <li key={t.id}>
                <TxnRow cid={cid} t={t} showPartner={false} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <p className="flex gap-3">
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{value}</span>
    </p>
  );
}
