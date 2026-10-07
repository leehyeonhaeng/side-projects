import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ArrowLeftIcon, DownloadIcon, ExternalLinkIcon, FileTextIcon, PrinterIcon, Share2Icon, TagIcon } from "lucide-react";
import { CHARGE_TYPES, DOC_LABEL, type Doc, type DocType, type PdfFile, type Txn, useDocMutations, useDocs, usePartners, useTxns } from "@/api/company";
import { NativeSelect } from "@/components/NativeSelect";
import { ErrorAlert, FormError, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { addDays, formatDay, formatTime, todayStr } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { useCompanyOutlet } from "./CompanyLayout";
import { txnSummary } from "./TxnsPage";
import { Chip, Field, PageHead, Search, matches, money } from "./ui";

function toBlob(f: PdfFile): Blob {
  const bin = atob(f.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: f.contentType });
}

/** PDF 받은 뒤: 내려받기 · 공유(폰 공유 시트) · 열어서 인쇄 */
export function PdfSheet({ file, onClose }: { file: PdfFile; onClose: () => void }) {
  const blob = useMemo(() => toBlob(file), [file]);
  const [url, setUrl] = useState("");
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  const pdf = useMemo(() => new File([blob], file.filename, { type: file.contentType }), [blob, file]);
  const canShare = typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [pdf] });
  const [shareError, setShareError] = useState<string | null>(null);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileTextIcon className="size-5 text-primary" /> {file.no ?? "PDF"}
          </DialogTitle>
          <DialogDescription className="break-all">{file.filename}</DialogDescription>
        </DialogHeader>
        {file.canceled && <p className="rounded-lg bg-red-50 p-2.5 text-sm text-red-800 dark:bg-red-400/10 dark:text-red-300">원본 거래가 취소되어 "취소됨" 표시가 들어간 판입니다.</p>}
        <div className="grid gap-2">
          <Button nativeButton={false} render={<a href={url} download={file.filename} />}>
            <DownloadIcon /> 내려받기
          </Button>
          {canShare && (
            <Button
              variant="outline"
              onClick={() =>
                navigator.share({ files: [pdf], title: file.filename }).catch((e: unknown) => {
                  if (!(e instanceof DOMException && e.name === "AbortError")) setShareError("공유하지 못했습니다. 내려받아서 보내 주세요.");
                })
              }
            >
              <Share2Icon /> 공유 (카톡·메일 등)
            </Button>
          )}
          {/* 서명 URL(다른 주소)로 열어야 브라우저 PDF 보기가 이 앱의 보안 설정에 막히지 않는다 */}
          <Button variant="outline" nativeButton={false} render={<a href={file.url ?? url} target="_blank" rel="noopener noreferrer" />}>
            <PrinterIcon /> 열어서 인쇄
          </Button>
          <FormError message={shareError} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 발행(이미 있으면 그 문서) → PDF 받기 → 시트. 화면마다 같이 쓴다 */
export function useDocFlow(cid: string) {
  const mut = useDocMutations(cid);
  const [file, setFile] = useState<PdfFile | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const run = async (get: () => Promise<PdfFile>) => {
    setError(null);
    setBusy(true);
    try {
      setFile(await get());
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return {
    mut,
    busy,
    error,
    issueAndOpen: (body: Parameters<typeof mut.issue.mutateAsync>[0]) => run(async () => mut.pdf.mutateAsync((await mut.issue.mutateAsync(body)).doc.id)),
    openDoc: (id: string) => run(() => mut.pdf.mutateAsync(id)),
    run,
    sheet: file && <PdfSheet file={file} onClose={() => setFile(null)} />,
  };
}

const TYPE_TONE: Record<DocType, string> = {
  receipt: "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300",
  statement: "bg-sky-100 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300",
  invoice: "bg-violet-100 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300",
  work: "bg-orange-100 text-orange-700 dark:bg-orange-400/15 dark:text-orange-300",
};

export function DocRow({ d, onOpen }: { d: Doc; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className={cn("flex w-full items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left hover:bg-muted/50", d.canceled && "opacity-60")}>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", d.canceled ? "bg-zinc-200 text-zinc-500 line-through dark:bg-zinc-500/20" : TYPE_TONE[d.type])}>{DOC_LABEL[d.type]}</span>
          <span className="truncate text-sm font-medium">{d.partnerName}</span>
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {d.no} · {formatDay(d.date)}
          {d.canceled && " · 취소됨"}
        </span>
      </span>
      {d.total !== undefined && d.total > 0 && <span className="shrink-0 text-sm font-semibold tabular-nums">{money(d.total)}</span>}
    </button>
  );
}

/** 거래 상세의 문서 버튼: 영수증(입금)·거래명세서(판매·청구·임대·A/S)·청구서 만들기 + 이 거래로 발행한 문서 */
export function TxnDocs({ cid, t }: { cid: string; t: Txn }) {
  const { detail } = useCompanyOutlet();
  const me = detail.me;
  const flow = useDocFlow(cid);
  const docs = useDocs(cid, { source: t.id }, me.perms.docs !== "none");
  if (me.perms.docs === "none") return null;
  const canIssue = me.perms.docs === "edit" && me.showAmounts && t.status === "confirmed";
  const hasStatement = ["sale", "charge", "rental_out", "rental_return", "service"].includes(t.type) && t.lines.length > 0;
  const chargeable = CHARGE_TYPES.includes(t.type) && (t.total ?? 0) > 0;

  return (
    <section className="grid gap-2">
      <h2 className="text-sm font-medium">문서</h2>
      {canIssue && (
        <div className="flex flex-wrap gap-2">
          {t.type === "receipt" && (
            <Button size="sm" disabled={flow.busy} onClick={() => flow.issueAndOpen({ type: "receipt", txnDate: t.date, txnId: t.id })}>
              <FileTextIcon /> 영수증
            </Button>
          )}
          {hasStatement && (
            <Button size="sm" variant="outline" disabled={flow.busy} onClick={() => flow.issueAndOpen({ type: "statement", txnDate: t.date, txnId: t.id })}>
              <FileTextIcon /> 거래명세서
            </Button>
          )}
          {chargeable && t.partnerId && (
            <Button size="sm" variant="outline" nativeButton={false} render={<Link to={`/company/${cid}/docs/invoice?partner=${t.partnerId}&txn=${t.date}/${t.id}`} />}>
              청구서 만들기
            </Button>
          )}
        </div>
      )}
      {flow.busy && <InlineSpinner />}
      <ErrorAlert error={flow.error} />
      {(docs.data ?? []).length > 0 && (
        <ul className="grid gap-1.5">
          {docs.data!.map((d) => (
            <li key={d.id}>
              <DocRow d={d} onOpen={() => flow.openDoc(d.id)} />
            </li>
          ))}
        </ul>
      )}
      {flow.sheet}
    </section>
  );
}

/** 문서함 (COMPANY.md 4장): 발행한 문서 전부, 다시 받기·공유·인쇄 */
export function DocsPage() {
  const { cid, detail } = useCompanyOutlet();
  const me = detail.me;
  const docs = useDocs(cid);
  const flow = useDocFlow(cid);
  const [type, setType] = useState<DocType | "all">("all");
  const [q, setQ] = useState("");
  const shown = (docs.data ?? []).filter((d) => type === "all" || d.type === type).filter((d) => matches([d.no, d.partnerName, ...d.sources.map((s) => s.no)].join(" "), q));

  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 md:p-6">
      <PageHead
        title="문서함"
        sub="발행한 영수증·명세서·청구서·작업 확인서. 누르면 같은 파일을 다시 받습니다"
        action={
          <div className="flex gap-2">
            {me.perms.docs === "edit" && me.showAmounts && (
              <Button variant="outline" nativeButton={false} render={<Link to={`/company/${cid}/docs/invoice`} />}>
                청구서 만들기
              </Button>
            )}
            {me.perms.assets !== "none" && (
              <Button variant="outline" nativeButton={false} render={<Link to={`/company/${cid}/labels`} />}>
                <TagIcon /> 기기 라벨
              </Button>
            )}
          </div>
        }
      />
      <Search value={q} onChange={setQ} placeholder="문서 번호·거래처·거래 번호" />
      <div className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1">
        <Chip on={type === "all"} onClick={() => setType("all")}>
          전체
        </Chip>
        {(Object.keys(DOC_LABEL) as DocType[]).map((t) => (
          <Chip key={t} on={type === t} onClick={() => setType(t)}>
            {DOC_LABEL[t]}
          </Chip>
        ))}
      </div>
      {flow.busy && <InlineSpinner />}
      <ErrorAlert error={flow.error} />
      {docs.isPending ? (
        <InlineSpinner />
      ) : docs.isError ? (
        <ErrorAlert error={docs.error} />
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">발행한 문서가 없습니다. 거래 화면에서 영수증·명세서를 발행하세요.</p>
      ) : (
        <ul className="grid gap-1.5">
          {shown.map((d) => (
            <li key={d.id}>
              <DocRow d={d} onOpen={() => flow.openDoc(d.id)} />
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">발행 시각은 문서 아래쪽에 찍힙니다. 최근 발행 {docs.data?.[0] ? formatTime(docs.data[0].issuedAt) : "—"}</p>
      {flow.sheet}
    </main>
  );
}

const openOf = (t: Txn) => (t.total ?? 0) - (t.paid ?? 0);

/** 청구서 만들기: 거래처의 청구 건 중 넣을 것을 고르고, 이전 미수·검침 카운터·입금 계좌 표시를 선택 */
export function InvoiceNewPage() {
  const { cid } = useCompanyOutlet();
  const [params] = useSearchParams();
  const partners = usePartners(cid);
  const [partnerId, setPartnerId] = useState(params.get("partner") ?? "");
  const txns = useTxns(cid, { partnerId }, !!partnerId);
  const flow = useDocFlow(cid);
  const preset = params.get("txn"); // "날짜/id"
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [previous, setPrevious] = useState(true);
  const [counters, setCounters] = useState(true);
  const [bank, setBank] = useState(true);
  const [date, setDate] = useState(todayStr());
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const charges = (txns.data ?? []).filter((t) => CHARGE_TYPES.includes(t.type) && t.status === "confirmed" && (t.total ?? 0) > 0);
  // 처음엔: 넘겨받은 거래, 없으면 남은 금액이 있는 청구 전부
  useEffect(() => {
    if (!txns.data || picked) return;
    const presetId = preset?.split("/")[1];
    setPicked(new Set(presetId ? [presetId] : charges.filter((t) => openOf(t) > 0).map((t) => t.id)));
  }, [txns.data, picked, preset, charges]);
  const chosen = charges.filter((t) => picked?.has(t.id));
  const recent = addDays(todayStr(), -120);
  const listed = charges.filter((t) => showAll || openOf(t) > 0 || picked?.has(t.id) || t.date >= recent);
  const charged = chosen.reduce((s, t) => s + (t.total ?? 0), 0);
  const paid = chosen.reduce((s, t) => s + (t.paid ?? 0), 0);
  const prev = charges.filter((t) => !picked?.has(t.id)).reduce((s, t) => s + Math.max(0, openOf(t)), 0);
  const due = charged - paid + (previous ? prev : 0);
  const toggle = (id: string) => setPicked((p) => (p?.has(id) ? new Set([...p].filter((x) => x !== id)) : new Set([...(p ?? []), id])));

  const submit = () => {
    setError(null);
    if (!partnerId) return setError("거래처를 고르세요.");
    if (chosen.length === 0) return setError("넣을 청구를 하나 이상 고르세요.");
    void flow.run(async () => {
      const r = await flow.mut.invoice.mutateAsync({ partnerId, date, txns: chosen.map((t) => ({ date: t.date, id: t.id })), previous, counters, bank, memo: memo.trim() });
      return flow.mut.pdf.mutateAsync(r.doc.id);
    });
  };

  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 pb-28 md:p-6 md:pb-28">
      <Link to={`/company/${cid}/docs`} className="flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeftIcon className="size-4" /> 문서함
      </Link>
      <h1 className="text-xl font-bold tracking-tight">청구서 만들기</h1>
      <section className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2">
        <Field label="거래처">
          <NativeSelect value={partnerId} onChange={(e) => (setPartnerId(e.target.value), setPicked(null))} className="h-9">
            <option value="">고르세요</option>
            {(partners.data ?? [])
              .filter((p) => p.active && p.kind !== "supplier")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </NativeSelect>
        </Field>
        <Field label="청구서 날짜">
          <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </Field>
      </section>

      {partnerId && (
        <section className="grid gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">넣을 청구 {chosen.length > 0 && <span className="text-primary">{chosen.length}건</span>}</h2>
            <Button size="xs" variant="ghost" onClick={() => setShowAll(!showAll)}>
              {showAll ? "최근·남은 것만" : "지난 청구 모두 보기"}
            </Button>
          </div>
          {txns.isPending ? (
            <InlineSpinner />
          ) : listed.length === 0 ? (
            <p className="text-sm text-muted-foreground">청구 거래가 없습니다.</p>
          ) : (
            <ul className="grid gap-1.5">
              {listed.map((t) => {
                const on = !!picked?.has(t.id);
                return (
                  <li key={t.id}>
                    <label className={cn("flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5", on && "border-primary ring-1 ring-primary")}>
                      <input type="checkbox" className="size-4 accent-primary" checked={on} onChange={() => toggle(t.id)} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{txnSummary(t)}</span>
                        <span className="block text-xs text-muted-foreground">
                          {formatDay(t.date)} · {t.no}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-sm tabular-nums">
                        {money(t.total)}
                        <span className={cn("block text-[11px]", openOf(t) > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>{openOf(t) > 0 ? `남은 ${money(openOf(t))}` : "결제 완료"}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {partnerId && (
        <section className="grid gap-2 rounded-2xl border bg-card p-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-4 accent-primary" checked={previous} onChange={(e) => setPrevious(e.target.checked)} />
            이전 미수 합계 넣기 <span className="text-muted-foreground">(고르지 않은 남은 청구 {money(prev)})</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-4 accent-primary" checked={counters} onChange={(e) => setCounters(e.target.checked)} />
            정기 청구의 검침 카운터 넣기
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-4 accent-primary" checked={bank} onChange={(e) => setBank(e.target.checked)} />
            입금 계좌 넣기 <span className="text-muted-foreground">(회사 설정)</span>
          </label>
          <Field label="하고 싶은 말 (선택)">
            <Input maxLength={300} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="예: 말일까지 입금 부탁드립니다" />
          </Field>
        </section>
      )}
      <FormError message={error} />
      <ErrorAlert error={flow.error} />
      {partnerId && (
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 border-t bg-card/95 px-4 py-3 backdrop-blur md:bottom-0 md:left-60">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <p className="min-w-0 flex-1 text-sm">
              받을 금액 <b className="tabular-nums">{money(due)}</b>
            </p>
            <Button disabled={flow.busy || chosen.length === 0} onClick={submit}>
              <ExternalLinkIcon /> 청구서 발행
            </Button>
          </div>
        </div>
      )}
      {flow.sheet}
    </main>
  );
}

/** 거래처 원장 PDF (기간) */
export function LedgerDialog({ cid, partnerId, onClose }: { cid: string; partnerId: string; onClose: () => void }) {
  const flow = useDocFlow(cid);
  const [from, setFrom] = useState(addDays(todayStr(), -92));
  const [to, setTo] = useState(todayStr());
  if (flow.sheet) return flow.sheet;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>거래처 원장</DialogTitle>
          <DialogDescription>기간 안의 청구·입금(매입·지급)과 잔액을 PDF로</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <Field label="부터">
            <Input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          </Field>
          <Field label="까지">
            <Input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
          </Field>
        </div>
        <ErrorAlert error={flow.error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button disabled={flow.busy} onClick={() => flow.run(() => flow.mut.ledger.mutateAsync({ partnerId, from, to }))}>
            PDF 만들기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
