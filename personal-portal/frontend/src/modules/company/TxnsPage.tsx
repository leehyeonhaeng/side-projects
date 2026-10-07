import { type ReactNode, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { ArrowLeftIcon, CheckCircle2Icon, PlusIcon } from "lucide-react";
import { CHARGE_TYPES, TXN_LABEL, TXN_TONE, type Txn, type TxnType, monthLabel, useTxn, useTxnMutations, useTxns } from "@/api/company";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { addDays, formatDay, formatTime, todayStr } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { useCompanyOutlet } from "./CompanyLayout";
import { TxnDocs } from "./DocsPage";
import { Chip, Field, PageHead, Search, matches, money } from "./ui";

export function TypeBadge({ type, canceled }: { type: TxnType; canceled?: boolean }) {
  return <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", canceled ? "bg-zinc-200 text-zinc-500 line-through dark:bg-zinc-500/20" : TXN_TONE[type])}>{TXN_LABEL[type]}</span>;
}

export function txnSummary(t: Txn): string {
  if (t.type === "rental_out" || t.type === "rental_return") return [t.contractNo, ...(t.assetCodes ?? [])].filter(Boolean).join(" · ") || "기기";
  if (t.billMonth) return `${t.contractNo} ${monthLabel(t.billMonth)} 임대료`;
  if (t.type === "receipt" || t.type === "payment") return t.accountName ?? "";
  if (t.type === "expense") return [t.category, t.memo].filter(Boolean).join(" · ") || "경비";
  const names = t.lines.map((l) => l.name).filter(Boolean);
  return names.length ? names[0] + (names.length > 1 ? ` 외 ${names.length - 1}건` : "") : "";
}

export const txnAmount = (t: Txn) => t.total ?? t.amount;

/** 거래 한 줄 (목록·거래처 화면 공용) */
export function TxnRow({ cid, t, showPartner = true }: { cid: string; t: Txn; showPartner?: boolean }) {
  const canceled = t.status === "canceled";
  const open = !canceled && CHARGE_TYPES.includes(t.type) && t.total !== undefined && t.paid !== undefined && t.total > t.paid;
  return (
    <Link to={`/company/${cid}/txns/${t.date}/${t.id}`} className={cn("flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 hover:bg-muted/50", canceled && "opacity-60")}>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <TypeBadge type={t.type} canceled={canceled} />
          <span className="truncate text-sm font-medium">{showPartner ? t.partnerName || txnSummary(t) : txnSummary(t)}</span>
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {t.no} · {showPartner && t.partnerName ? txnSummary(t) : formatDay(t.date)}
        </span>
      </span>
      <span className="shrink-0 text-right text-sm tabular-nums">
        {txnAmount(t) !== undefined && txnAmount(t) !== 0 && <span className={cn("block font-semibold", (t.type === "payment" || t.type === "expense") && "text-rose-600 dark:text-rose-400", t.type === "receipt" && "text-emerald-600 dark:text-emerald-400")}>{money(txnAmount(t))}</span>}
        {open && <span className="block text-[11px] text-red-600 dark:text-red-400">미수 {money(t.total! - t.paid!)}</span>}
        {canceled && <span className="block text-[11px] text-muted-foreground">취소됨</span>}
      </span>
    </Link>
  );
}

type Range = "7" | "31" | "92";

/** 거래 목록 (최근 기간, 종류 필터, 검색) */
export function TxnsPage() {
  const { cid, detail } = useCompanyOutlet();
  const [range, setRange] = useState<Range>("31");
  const [type, setType] = useState<TxnType | "all">("all");
  const [q, setQ] = useState("");
  const today = todayStr();
  const txns = useTxns(cid, { from: addDays(today, -Number(range)), to: today });
  const canAdd = detail.me.perms.txns === "edit" || detail.me.perms.money === "edit";

  const shown = (txns.data ?? []).filter((t) => type === "all" || t.type === type).filter((t) => matches([t.no, t.partnerName, txnSummary(t), t.memo].join(" "), q));
  const days = [...new Set(shown.map((t) => t.date))];

  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 md:p-6">
      <PageHead
        title="거래"
        action={
          canAdd && (
            <Button nativeButton={false} render={<Link to={`/company/${cid}/txns/new`} />}>
              <PlusIcon /> 새 거래
            </Button>
          )
        }
      />
      <Search value={q} onChange={setQ} placeholder="거래 번호·거래처·내용 검색" />
      <div className="flex flex-wrap gap-1">
        {(["7", "31", "92"] as const).map((r) => (
          <Chip key={r} on={range === r} onClick={() => setRange(r)}>
            최근 {r === "7" ? "1주" : r === "31" ? "1달" : "3달"}
          </Chip>
        ))}
      </div>
      <div className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1">
        <Chip on={type === "all"} onClick={() => setType("all")}>
          전체
        </Chip>
        {(Object.keys(TXN_LABEL) as TxnType[]).map((t) => (
          <Chip key={t} on={type === t} onClick={() => setType(t)}>
            {TXN_LABEL[t]}
          </Chip>
        ))}
      </div>
      {txns.isPending ? (
        <InlineSpinner />
      ) : txns.isError ? (
        <ErrorAlert error={txns.error} />
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">이 기간에 거래가 없습니다.</p>
      ) : (
        days.map((d) => (
          <section key={d} className="grid gap-1.5">
            <h2 className="text-xs font-medium text-muted-foreground">{formatDay(d)}</h2>
            <ul className="grid gap-1.5">
              {shown
                .filter((t) => t.date === d)
                .map((t) => (
                  <li key={t.id}>
                    <TxnRow cid={cid} t={t} />
                  </li>
                ))}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}

/** 거래 상세: 내용, 결제 상태, 배분, 취소 */
export function TxnDetailPage() {
  const { cid, detail } = useCompanyOutlet();
  const { day = "", tid = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const txn = useTxn(cid, day, tid);
  const [canceling, setCanceling] = useState(false);
  const created = (location.state as { created?: boolean } | null)?.created;

  if (txn.isPending) return <main className="p-4"><InlineSpinner /></main>;
  if (txn.isError) return <main className="p-4"><ErrorAlert error={txn.error} /></main>;
  const t = txn.data;
  const canceled = t.status === "canceled";
  const area = t.type === "receipt" || t.type === "payment" || t.type === "expense" ? "money" : t.type === "service" ? "assets" : "txns";
  const canCancel = !canceled && detail.me.perms[area] === "edit";
  const links = t.paidBy?.length ? t.paidBy : t.allocations;

  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 md:p-6">
      <button type="button" onClick={() => void navigate(-1)} className="flex items-center gap-1 justify-self-start text-sm text-muted-foreground">
        <ArrowLeftIcon className="size-4" /> 뒤로
      </button>
      {created && (
        <p className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300">
          <CheckCircle2Icon className="size-4" /> 저장했습니다. 재고·기기·잔액이 함께 바뀌었습니다.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <TypeBadge type={t.type} canceled={canceled} />
        <h1 className="text-xl font-bold tracking-tight">{t.no}</h1>
        {canceled && <span className="text-sm text-red-600 dark:text-red-400">취소됨</span>}
      </div>
      <section className="grid gap-2 rounded-2xl border bg-card p-4 text-sm">
        <Row label="날짜" value={formatDay(t.date)} />
        {t.partnerId && <Row label="거래처" value={<Link className="text-primary" to={`/company/${cid}/partners/${t.partnerId}`}>{t.partnerName}</Link>} />}
        {t.contractId && <Row label="계약" value={<Link className="text-primary" to={`/company/${cid}/contracts/${t.contractId}`}>{t.contractNo}{t.billMonth ? ` · ${monthLabel(t.billMonth)} 정기 청구` : ""}</Link>} />}
        {t.serviceId && <Row label="A/S" value={<Link className="text-primary" to={`/company/${cid}/services/${t.serviceId}`}>{t.serviceNo}</Link>} />}
        {t.accountName && <Row label="계좌" value={t.accountName} />}
        {t.category && <Row label="항목" value={t.category} />}
        {t.memo && <Row label="메모" value={t.memo} />}
        {canceled && <Row label="취소" value={`${t.canceledAt ? formatTime(t.canceledAt) : ""}${t.cancelReason ? ` · ${t.cancelReason}` : ""}`} />}
      </section>

      {t.assetIds && t.assetIds.length > 0 && (
        <section className="grid gap-1.5">
          <h2 className="text-sm font-medium">기기 {t.assetIds.length}대</h2>
          <ul className="grid gap-1.5">
            {t.assetIds.map((aid, i) => (
              <li key={aid}>
                <Link to={`/company/${cid}/assets/${aid}`} className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm">
                  <span className="font-mono font-semibold">{t.assetCodes?.[i]}</span>
                  <span className="truncate text-muted-foreground">{t.assetNames?.[i]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {t.lines.length > 0 && (
        <section className="grid gap-1.5">
          <h2 className="text-sm font-medium">내역</h2>
          <ul className="grid divide-y overflow-hidden rounded-2xl border bg-card">
            {t.lines.map((l, i) => (
              <li key={i} className="grid gap-0.5 px-4 py-2.5 text-sm">
                <span className="flex justify-between gap-3">
                  <span className="min-w-0 break-words">{l.name}</span>
                  <span className="shrink-0 font-medium tabular-nums">{l.total !== undefined ? money(l.total) : `${l.qty > 0 && t.type === "adjust" ? "+" : ""}${l.qty}${l.unit ?? ""}`}</span>
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {l.unitPrice !== undefined ? `${l.qty}${l.unit ?? ""} × ${money(l.unitPrice)} · 공급 ${money(l.supply)} · 세액 ${money(l.vat)}${l.manual ? " (직접 수정)" : ""}` : l.memo}
                  {l.assetIds?.length ? ` · 기기 ${l.assetIds.length}대 등록` : ""}
                </span>
              </li>
            ))}
          </ul>
          {t.total !== undefined && (
            <p className="flex justify-between rounded-xl bg-muted/50 px-4 py-2.5 text-sm tabular-nums">
              <span className="text-muted-foreground">공급 {money(t.supply)} · 세액 {money(t.vat)}</span>
              <b>합계 {money(t.total)}</b>
            </p>
          )}
        </section>
      )}

      {t.amount !== undefined && (
        <p className="rounded-xl bg-muted/50 px-4 py-3 text-sm tabular-nums">
          금액 <b>{money(t.amount)}</b>
          {t.allocated !== undefined && ` · 배분 ${money(t.allocated)} · ${t.type === "receipt" ? "선수금" : "선급금"} ${money(t.unallocated)}`}
        </p>
      )}
      {t.paid !== undefined && t.total !== undefined && t.total > 0 && (
        <p className={cn("rounded-xl px-4 py-3 text-sm tabular-nums", t.paid >= t.total ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300" : "bg-red-50 text-red-800 dark:bg-red-400/10 dark:text-red-300")}>
          {t.paid >= t.total ? "결제 완료" : `받은 금액 ${money(t.paid)} · 남은 금액 ${money(t.total - t.paid)}`}
        </p>
      )}
      {links && links.length > 0 && (
        <section className="grid gap-1.5">
          <h2 className="text-sm font-medium">{t.paidBy?.length ? "결제한 거래" : "배분한 청구"}</h2>
          <ul className="grid gap-1.5">
            {links.map((l) => (
              <li key={l.txnId}>
                <Link to={`/company/${cid}/txns/${l.date}/${l.txnId}`} className="flex justify-between rounded-xl border bg-card px-3 py-2 text-sm">
                  <span>{l.no ?? formatDay(l.date)}</span>
                  <span className="tabular-nums">{money(l.amount)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {t.lines.some((l) => l.assetIds?.length) && !canceled && (
        <Button size="sm" variant="outline" className="justify-self-start" nativeButton={false} render={<Link to={`/company/${cid}/labels?ids=${t.lines.flatMap((l) => l.assetIds ?? []).join(",")}`} />}>
          매입한 기기 라벨 출력
        </Button>
      )}
      {t.partnerId && <TxnDocs cid={cid} t={t} />}
      {canCancel && (
        <Button variant="outline" className="justify-self-start text-destructive" onClick={() => setCanceling(true)}>
          거래 취소
        </Button>
      )}
      {canceling && <CancelDialog cid={cid} t={t} onClose={() => setCanceling(false)} />}
    </main>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <p className="flex gap-3">
      <span className="w-14 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{value}</span>
    </p>
  );
}

function CancelDialog({ cid, t, onClose }: { cid: string; t: Txn; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const mut = useTxnMutations(cid);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.no} 취소</DialogTitle>
          <DialogDescription>거래는 지워지지 않고 "취소"로 남습니다. 이 거래가 바꾼 재고·기기·잔액·계좌가 모두 원래대로 돌아갑니다{t.paid ? " (받은 돈은 선수금으로 남습니다)" : ""}.</DialogDescription>
        </DialogHeader>
        <Field label="취소 사유">
          <Input autoFocus maxLength={200} placeholder="잘못 입력, 거래처 요청 등" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <ErrorAlert error={mut.cancel.error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            닫기
          </Button>
          <Button variant="destructive" disabled={mut.cancel.isPending} onClick={() => mut.cancel.mutate({ date: t.date, id: t.id, reason: reason.trim() }, { onSuccess: onClose })}>
            취소하기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
