import { type ReactNode, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ArrowLeftIcon, FileTextIcon, PlusIcon, XIcon } from "lucide-react";
import { SERVICE_STATUS_LABEL, type Service, type ServiceStatus, useAssets, useItems, usePartners, useRentalMutations, useService, useServices, useStaff } from "@/api/company";
import { NativeSelect } from "@/components/NativeSelect";
import { ErrorAlert, FormError, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDay, todayStr } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { useCompanyOutlet } from "./CompanyLayout";
import { useDocFlow } from "./DocsPage";
import { type DraftLine, TxnLinesEditor, newLine, toLineInput } from "./TxnLinesEditor";
import { TxnRow } from "./TxnsPage";
import { Chip, Field, PageHead, Search, matches } from "./ui";

const TONE: Record<ServiceStatus, string> = {
  open: "bg-orange-100 text-orange-700 dark:bg-orange-400/15 dark:text-orange-300",
  done: "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300",
  canceled: "bg-zinc-200 text-zinc-500 line-through dark:bg-zinc-500/20",
};

export function ServiceBadge({ s }: { s: Pick<Service, "status" | "needsBilling"> }) {
  return (
    <>
      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", TONE[s.status])}>{SERVICE_STATUS_LABEL[s.status]}</span>
      {s.needsBilling && <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-400/15 dark:text-red-300">청구 필요</span>}
    </>
  );
}

export function ServiceRow({ cid, s }: { cid: string; s: Service }) {
  return (
    <Link to={`/company/${cid}/services/${s.id}`} className={cn("flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 hover:bg-muted/50", s.status === "canceled" && "opacity-60")}>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <ServiceBadge s={s} />
          <span className="truncate text-sm font-medium">{s.partnerName}</span>
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {s.no} · {[s.assetCode, s.symptom].filter(Boolean).join(" · ")}
        </span>
      </span>
      <span className="shrink-0 text-right text-xs text-muted-foreground">
        {formatDay(s.done?.date ?? s.date)}
        {s.assigneeName && <span className="block">{s.assigneeName}</span>}
      </span>
    </Link>
  );
}

/** A/S·점검 (접수 → 완료) */
export function ServicesPage() {
  const { cid, detail } = useCompanyOutlet();
  const services = useServices(cid);
  const [status, setStatus] = useState<ServiceStatus | "billing" | "all">("open");
  const [q, setQ] = useState("");
  const canEdit = detail.me.perms.assets === "edit";
  const all = services.data ?? [];
  const shown = all.filter((s) => (status === "all" ? true : status === "billing" ? s.needsBilling : s.status === status)).filter((s) => matches([s.no, s.partnerName, s.assetCode ?? "", s.symptom, s.assigneeName ?? ""].join(" "), q));

  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 md:p-6">
      <PageHead
        title="A/S"
        sub="전화 받으면 접수, 현장에서 조치·부품을 입력하고 완료"
        action={
          canEdit && (
            <Button nativeButton={false} render={<Link to={`/company/${cid}/services/new`} />}>
              <PlusIcon /> A/S 접수
            </Button>
          )
        }
      />
      <Search value={q} onChange={setQ} placeholder="거래처·기기·증상·담당자" />
      <div className="flex flex-wrap gap-1">
        <Chip on={status === "open"} onClick={() => setStatus("open")}>
          접수 {all.filter((s) => s.status === "open").length}
        </Chip>
        <Chip on={status === "done"} onClick={() => setStatus("done")}>
          완료
        </Chip>
        {all.some((s) => s.needsBilling) && (
          <Chip on={status === "billing"} onClick={() => setStatus("billing")}>
            청구 필요 {all.filter((s) => s.needsBilling).length}
          </Chip>
        )}
        <Chip on={status === "all"} onClick={() => setStatus("all")}>
          전체
        </Chip>
      </div>
      {services.isPending ? (
        <InlineSpinner />
      ) : services.isError ? (
        <ErrorAlert error={services.error} />
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{status === "open" ? "처리할 A/S가 없습니다." : "A/S가 없습니다."}</p>
      ) : (
        <ul className="grid gap-1.5">
          {shown.map((s) => (
            <li key={s.id}>
              <ServiceRow cid={cid} s={s} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

/** A/S 접수 (?partner ?asset) */
export function ServiceNewPage() {
  const { cid } = useCompanyOutlet();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const partners = usePartners(cid);
  const assets = useAssets(cid);
  const staff = useStaff(cid);
  const mut = useRentalMutations(cid);
  const [partnerId, setPartnerId] = useState(params.get("partner") ?? "");
  const [assetId, setAssetId] = useState(params.get("asset") ?? "");
  const [date, setDate] = useState(todayStr());
  const [symptom, setSymptom] = useState("");
  const [contact, setContact] = useState("");
  const [assignee, setAssignee] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (partners.isPending || assets.isPending) return <main className="p-4"><InlineSpinner /></main>;
  const partnerList = (partners.data ?? []).filter((p) => p.active && p.kind !== "supplier");
  const rented = (assets.data ?? []).filter((a) => a.status === "rented" && a.partnerId === partnerId);

  const submit = () => {
    setError(null);
    if (!partnerId) return setError("거래처를 고르세요.");
    if (!symptom.trim()) return setError("증상을 적으세요.");
    mut.createService.mutate(
      { partnerId, ...(assetId ? { assetId } : {}), date, symptom: symptom.trim(), contact: contact.trim(), ...(assignee ? { assignee } : {}) },
      { onSuccess: (r) => void navigate(`/company/${cid}/services/${r.service.id}`, { replace: true }) },
    );
  };

  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 md:p-6">
      <Link to={`/company/${cid}/services`} className="flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeftIcon className="size-4" /> A/S
      </Link>
      <h1 className="text-xl font-bold tracking-tight">A/S 접수</h1>
      <form
        className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="거래처">
          <NativeSelect value={partnerId} onChange={(e) => (setPartnerId(e.target.value), setAssetId(""))} className="h-9">
            <option value="">고르세요</option>
            {partnerList.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="기기">
          <NativeSelect value={assetId} onChange={(e) => setAssetId(e.target.value)} className="h-9" disabled={!partnerId}>
            <option value="">{rented.length ? "고르세요 (없으면 비워 두기)" : "임대 중인 기기 없음"}</option>
            {rented.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} {a.itemName}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="접수일">
          <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </Field>
        <Field label="담당 (선택)">
          <NativeSelect value={assignee} onChange={(e) => setAssignee(e.target.value)} className="h-9">
            <option value="">정하지 않음</option>
            {(staff.data ?? []).map((s) => (
              <option key={s.sub} value={s.sub}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="증상" wide>
          <Textarea rows={3} maxLength={500} value={symptom} onChange={(e) => setSymptom(e.target.value)} placeholder="예: 용지 걸림, 인쇄물 줄 생김, 토너 교체 요청" />
        </Field>
        <Field label="현장 연락처 (선택)" wide>
          <Input maxLength={60} value={contact} onChange={(e) => setContact(e.target.value)} placeholder="예: 행정실 김주무관 010-…" />
        </Field>
        <div className="grid gap-2 sm:col-span-2">
          <FormError message={error} />
          <ErrorAlert error={mut.createService.error} />
          <Button type="submit" size="lg" disabled={mut.createService.isPending}>
            접수
          </Button>
        </div>
      </form>
    </main>
  );
}

type Part = { itemId: string; qty: string };

/** A/S 상세: 접수 내용, 완료 입력(조치·부품·작업비), 청구 */
export function ServiceDetailPage() {
  const { cid, detail } = useCompanyOutlet();
  const me = detail.me;
  const { sid = "" } = useParams();
  const data = useService(cid, sid);
  const items = useItems(cid);
  const staff = useStaff(cid);
  const mut = useRentalMutations(cid);
  const [action, setAction] = useState("");
  const [date, setDate] = useState(todayStr());
  const [parts, setParts] = useState<Part[]>([]);
  const [withFees, setWithFees] = useState(false);
  const [fees, setFees] = useState<DraftLine[]>(() => [newLine(detail.company.vatDefault)]);
  const [billable, setBillable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (data.isPending) return <main className="p-4"><InlineSpinner /></main>;
  if (data.isError) return <main className="p-4"><ErrorAlert error={data.error} /></main>;
  const { service: s, txn } = data.data;
  const canEdit = me.perms.assets === "edit";
  const stock = (items.data ?? []).filter((i) => i.active && i.tracking === "stock");

  const complete = () => {
    setError(null);
    if (!action.trim()) return setError("조치 내용을 적으세요.");
    const ps = parts.filter((p) => p.itemId && Number(p.qty) > 0).map((p) => ({ itemId: p.itemId, name: "", qty: Number(p.qty), unitPrice: 0, vatMode: detail.company.vatDefault, memo: "부품" }));
    const fs = withFees ? fees.map((l) => toLineInput(l, [])).filter((l) => l.name) : [];
    mut.completeService.mutate({ id: s.id, date, action: action.trim(), parts: ps, fees: fs, billable: billable && fs.length === 0 });
  };

  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 md:p-6">
      <Link to={`/company/${cid}/services`} className="flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeftIcon className="size-4" /> A/S
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <ServiceBadge s={s} />
        <h1 className="text-xl font-bold tracking-tight">{s.no}</h1>
      </div>
      <section className="grid gap-2 rounded-2xl border bg-card p-4 text-sm">
        <Row label="거래처" value={<Link className="text-primary" to={`/company/${cid}/partners/${s.partnerId}`}>{s.partnerName}</Link>} />
        {s.assetId && <Row label="기기" value={<Link className="text-primary" to={`/company/${cid}/assets/${s.assetId}`}>{s.assetCode} {s.itemName}</Link>} />}
        <Row label="접수일" value={formatDay(s.date)} />
        <Row label="증상" value={<span className="whitespace-pre-wrap">{s.symptom}</span>} />
        {s.contact && <Row label="연락처" value={s.contact} />}
        {s.status === "open" && canEdit ? (
          <Row
            label="담당"
            value={
              <NativeSelect value={s.assignee ?? ""} onChange={(e) => mut.patchService.mutate({ id: s.id, assignee: e.target.value })} className="h-8 w-44" aria-label="담당">
                <option value="">정하지 않음</option>
                {(staff.data ?? []).map((x) => (
                  <option key={x.sub} value={x.sub}>
                    {x.name}
                  </option>
                ))}
              </NativeSelect>
            }
          />
        ) : (
          s.assigneeName && <Row label="담당" value={s.assigneeName} />
        )}
        {s.done && <Row label="완료" value={`${formatDay(s.done.date)} · ${s.done.action}`} />}
        {s.cancelReason !== undefined && s.status === "canceled" && <Row label="취소" value={s.cancelReason || "—"} />}
      </section>

      {txn && (
        <section className="grid gap-1.5">
          <h2 className="text-sm font-medium">A/S 거래 (부품·작업비)</h2>
          <TxnRow cid={cid} t={txn} showPartner={false} />
        </section>
      )}
      {s.chargeTxn && (
        <Link to={`/company/${cid}/txns/${s.chargeTxn.date}/${s.chargeTxn.id}`} className="text-sm text-primary">
          청구 {s.chargeTxn.no} 보기
        </Link>
      )}
      {s.needsBilling && me.showAmounts && me.perms.txns === "edit" && (
        <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-red-300/60 bg-red-50/50 p-4 dark:bg-red-400/5">
          <p className="min-w-0 flex-1 text-sm">유상 A/S입니다. 작업비를 청구하세요.</p>
          <Button size="sm" nativeButton={false} render={<Link to={`/company/${cid}/txns/new?type=charge&partner=${s.partnerId}&service=${s.id}`} />}>
            청구 만들기
          </Button>
        </section>
      )}

      {s.status === "open" && canEdit && (
        <form
          className="grid gap-3 rounded-2xl border bg-card p-4"
          onSubmit={(e) => {
            e.preventDefault();
            complete();
          }}
        >
          <h2 className="text-sm font-medium">완료 입력</h2>
          <Field label="완료일">
            <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="max-w-48" />
          </Field>
          <Field label="조치 내용">
            <Textarea rows={3} maxLength={500} value={action} onChange={(e) => setAction(e.target.value)} placeholder="예: 급지 롤러 교체, 드럼 청소" />
          </Field>
          <div className="grid gap-2">
            <p className="text-xs text-muted-foreground">사용 부품 (재고에서 빠집니다)</p>
            {parts.map((p, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_4.5rem_auto] gap-2">
                <NativeSelect value={p.itemId} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)))} className="h-9 w-full min-w-0" aria-label="부품">
                  <option value="">부품</option>
                  {stock.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name} (재고 {it.qty ?? 0})
                    </option>
                  ))}
                </NativeSelect>
                <Input inputMode="decimal" value={p.qty} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} className="h-9" aria-label="수량" />
                <Button type="button" size="icon-sm" variant="ghost" aria-label="부품 빼기" onClick={() => setParts(parts.filter((_, j) => j !== i))}>
                  <XIcon />
                </Button>
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" className="justify-self-start" onClick={() => setParts([...parts, { itemId: "", qty: "1" }])}>
              부품 추가
            </Button>
          </div>
          {me.showAmounts && (
            <div className="grid gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-primary" checked={withFees} onChange={(e) => setWithFees(e.target.checked)} />
                작업비·출장비 바로 청구
              </label>
              {withFees && <TxnLinesEditor lines={fees} onChange={setFees} items={[]} defaultVat={detail.company.vatDefault} />}
            </div>
          )}
          {!withFees && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={billable} onChange={(e) => setBillable(e.target.checked)} />
              유상 (사무실에서 나중에 청구)
            </label>
          )}
          <FormError message={error} />
          <ErrorAlert error={mut.completeService.error} />
          <Button type="submit" size="lg" disabled={mut.completeService.isPending}>
            완료
          </Button>
        </form>
      )}
      {s.status === "open" && canEdit && <CancelService cid={cid} id={s.id} />}
      {s.status === "done" && (me.perms.docs === "edit" || canEdit) && <WorkDoc cid={cid} id={s.id} />}
      {s.status === "done" && txn && <p className="text-xs text-muted-foreground">완료를 되돌리려면 A/S 거래를 취소하세요 (부품 재고도 돌아옵니다).</p>}
    </main>
  );
}

function WorkDoc({ cid, id }: { cid: string; id: string }) {
  const flow = useDocFlow(cid);
  return (
    <div className="grid justify-items-start gap-2">
      <Button size="sm" variant="outline" disabled={flow.busy} onClick={() => flow.issueAndOpen({ type: "work", serviceId: id })}>
        <FileTextIcon /> 작업 확인서 (고객 서명용)
      </Button>
      <ErrorAlert error={flow.error} />
      {flow.sheet}
    </div>
  );
}

function CancelService({ cid, id }: { cid: string; id: string }) {
  const mut = useRentalMutations(cid);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open)
    return (
      <Button variant="ghost" size="sm" className="justify-self-start text-destructive" onClick={() => setOpen(true)}>
        접수 취소
      </Button>
    );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input placeholder="취소 사유 (예: 고객이 해결함)" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} className="h-9 min-w-0 flex-1" />
      <Button size="sm" variant="destructive" disabled={mut.cancelService.isPending} onClick={() => mut.cancelService.mutate({ id, reason: reason.trim() })}>
        취소하기
      </Button>
      <ErrorAlert error={mut.cancelService.error} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-14 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{value}</span>
    </div>
  );
}
