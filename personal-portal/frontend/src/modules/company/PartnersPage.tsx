import { type ReactNode, useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeftIcon, MapPinIcon, PhoneIcon, PlusIcon } from "lucide-react";
import { type Partner, type PartnerInput, type PartnerKind, PARTNER_KIND_LABEL, billingDayLabel, useContracts, useMasterMutations, usePartner, usePartners, useServices, useTxns } from "@/api/company";
import { ContractBadge } from "./ContractsPage";
import { ServiceRow } from "./ServicesPage";
import { TxnRow } from "./TxnsPage";
import { ConfirmButton } from "@/components/ConfirmButton";
import { NativeSelect } from "@/components/NativeSelect";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useCompanyOutlet } from "./CompanyLayout";
import { Chip, Field, PageHead, Search, StatusBadge, matches, money } from "./ui";

type KindFilter = "all" | PartnerKind;

/** 거래처 목록 (COMPANY.md 4장) */
export function PartnersPage() {
  const { cid, detail } = useCompanyOutlet();
  const canEdit = detail.me.perms.partners === "edit";
  const partners = usePartners(cid);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [showInactive, setShowInactive] = useState(false);
  const [adding, setAdding] = useState(false);

  const shown = (partners.data ?? [])
    .filter((p) => showInactive || p.active)
    .filter((p) => kind === "all" || p.kind === kind || (p.kind === "both" && kind !== "both"))
    .filter((p) => matches([p.name, p.contactName, p.phone, p.mobile, p.address, p.bizNo, p.memo].join(" "), q));

  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 md:p-6">
      <PageHead
        title="거래처"
        sub={partners.data ? `${partners.data.filter((p) => p.active).length}곳` : undefined}
        action={
          canEdit && (
            <Button onClick={() => setAdding(true)}>
              <PlusIcon /> 거래처 추가
            </Button>
          )
        }
      />
      <Search value={q} onChange={setQ} placeholder="이름·담당자·전화·주소 검색" />
      <div className="flex flex-wrap gap-1">
        {(["all", "customer", "supplier"] as const).map((k) => (
          <Chip key={k} on={kind === k} onClick={() => setKind(k)}>
            {k === "all" ? "전체" : PARTNER_KIND_LABEL[k]}
          </Chip>
        ))}
        <Chip on={showInactive} onClick={() => setShowInactive(!showInactive)}>
          사용 안 함 포함
        </Chip>
      </div>
      {partners.isPending ? (
        <InlineSpinner />
      ) : partners.isError ? (
        <ErrorAlert error={partners.error} />
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{partners.data.length ? "조건에 맞는 거래처가 없습니다." : "거래처를 추가하세요."}</p>
      ) : (
        <ul className="grid gap-2">
          {shown.map((p) => (
            <li key={p.id}>
              <Link to={`/company/${cid}/partners/${p.id}`} className={cn("grid gap-1 rounded-2xl border bg-card p-3 hover:bg-muted/50", !p.active && "opacity-60")}>
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{PARTNER_KIND_LABEL[p.kind]}</span>
                </span>
                <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                  {p.contactName && <span>{p.contactName}</span>}
                  {(p.phone || p.mobile) && <span>{p.phone || p.mobile}</span>}
                  {p.receivable !== undefined && p.receivable > 0 && <span className="text-red-600 dark:text-red-400">미수 {money(p.receivable)}</span>}
                  {!p.active && <span>사용 안 함</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {adding && <PartnerDialog cid={cid} partner={null} onClose={() => setAdding(false)} />}
    </main>
  );
}

/** 거래처 상세: 정보, 잔액(C3), 지금 나가 있는 기기 */
export function PartnerDetailPage() {
  const { cid, detail } = useCompanyOutlet();
  const { pid = "" } = useParams();
  const data = usePartner(cid, pid);
  const [editing, setEditing] = useState(false);
  const canEdit = detail.me.perms.partners === "edit";

  if (data.isPending) return <main className="p-4"><InlineSpinner /></main>;
  if (data.isError) return <main className="p-4"><ErrorAlert error={data.error} /></main>;
  const { partner: p, assets } = data.data;

  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 md:p-6">
      <Link to={`/company/${cid}/partners`} className="flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeftIcon className="size-4" /> 거래처
      </Link>
      <PageHead
        title={p.name}
        sub={`${PARTNER_KIND_LABEL[p.kind]}${p.active ? "" : " · 사용 안 함"}`}
        action={
          canEdit && (
            <Button variant="outline" onClick={() => setEditing(true)}>
              수정
            </Button>
          )
        }
      />
      {p.receivable !== undefined && (
        <section className="grid grid-cols-3 gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-4">
          {[
            ["미수금", p.receivable, "text-red-600 dark:text-red-400"],
            ["선수금", p.advance, ""],
            ["미지급금", p.payable, ""],
            ...(p.prepaid ? [["선급금", p.prepaid, ""]] : []),
          ].map(([label, v, tone]) => (
            <div key={label as string} className="min-w-0">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className={cn("truncate font-semibold tabular-nums", (v as number) > 0 && (tone as string))}>{money(v as number)}</p>
            </div>
          ))}
        </section>
      )}
      <section className="grid gap-2 rounded-2xl border bg-card p-4 text-sm">
        <Info label="사업자번호" value={p.bizNo} />
        <Info label="대표" value={p.ceo} />
        <Info label="담당자" value={p.contactName} />
        <Info label="전화" value={p.phone} href={p.phone && `tel:${p.phone}`} icon={<PhoneIcon className="size-3.5" />} />
        <Info label="휴대폰" value={p.mobile} href={p.mobile && `tel:${p.mobile}`} icon={<PhoneIcon className="size-3.5" />} />
        <Info label="이메일" value={p.email} href={p.email && `mailto:${p.email}`} />
        <Info label="주소" value={p.address} icon={<MapPinIcon className="size-3.5" />} />
        {p.memo && <p className="whitespace-pre-wrap rounded-lg bg-muted/50 p-2 text-muted-foreground">{p.memo}</p>}
      </section>
      <PartnerQuickActions cid={cid} pid={p.id} kind={p.kind} />
      <section className="grid gap-2">
        <h2 className="text-sm font-medium">나가 있는 기기 {assets.length}대</h2>
        {assets.length === 0 ? (
          <p className="text-sm text-muted-foreground">이 거래처에 임대 중인 기기가 없습니다.</p>
        ) : (
          <ul className="grid gap-1.5">
            {assets.map((a) => (
              <li key={a.id}>
                <Link to={`/company/${cid}/assets/${a.id}`} className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm">
                  <span className="font-mono text-xs">{a.code}</span>
                  <span className="min-w-0 flex-1 truncate">{a.itemName}</span>
                  <StatusBadge status={a.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      {detail.me.perms.contracts !== "none" && p.kind !== "supplier" && <PartnerContracts cid={cid} pid={p.id} />}
      {detail.me.perms.assets !== "none" && p.kind !== "supplier" && <PartnerServices cid={cid} pid={p.id} />}
      {detail.me.perms.txns !== "none" && <PartnerTxns cid={cid} pid={p.id} />}
      {editing && <PartnerDialog cid={cid} partner={p} onClose={() => setEditing(false)} />}
    </main>
  );
}

/** 이 거래처로 바로 거래 입력 */
function PartnerQuickActions({ cid, pid, kind }: { cid: string; pid: string; kind: Partner["kind"] }) {
  const { detail } = useCompanyOutlet();
  const me = detail.me;
  const acts: [string, string][] = [];
  if (kind !== "supplier") {
    if (me.perms.contracts === "edit" && me.perms.assets === "edit") acts.push(["rental_out", "임대 출고"]);
    if (me.perms.txns === "edit" && me.perms.assets === "edit") acts.push(["rental_return", "수거"]);
    if (me.perms.assets === "edit") acts.push(["service", "A/S 접수"]);
    if (me.perms.txns === "edit" && me.showAmounts) acts.push(["charge", "청구"], ["sale", "판매"]);
    if (me.perms.money === "edit" && me.showAmounts) acts.push(["receipt", "입금 받기"]);
  }
  if (kind !== "customer") {
    if (me.perms.txns === "edit" && me.showAmounts) acts.push(["purchase", "매입"]);
    if (me.perms.money === "edit" && me.showAmounts) acts.push(["payment", "지급"]);
  }
  if (acts.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {acts.map(([type, label]) => (
        <Button key={type} size="sm" variant="outline" nativeButton={false} render={<Link to={type === "service" ? `/company/${cid}/services/new?partner=${pid}` : `/company/${cid}/txns/new?type=${type}&partner=${pid}`} />}>
          {label}
        </Button>
      ))}
    </div>
  );
}

function PartnerContracts({ cid, pid }: { cid: string; pid: string }) {
  const contracts = useContracts(cid, { partnerId: pid });
  const shown = (contracts.data ?? []).filter((c) => c.status !== "canceled");
  if (contracts.isPending || shown.length === 0) return null;
  return (
    <section className="grid gap-2">
      <h2 className="text-sm font-medium">임대 계약</h2>
      <ul className="grid gap-1.5">
        {shown.map((c) => (
          <li key={c.id}>
            <Link to={`/company/${cid}/contracts/${c.id}`} className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm">
              <ContractBadge status={c.status} />
              <span className="min-w-0 flex-1 truncate">
                {c.no} · 기기 {Object.values(c.machines).filter((m) => !m.endedAt).length}대 · 매월 {billingDayLabel(c.billingDay)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PartnerServices({ cid, pid }: { cid: string; pid: string }) {
  const services = useServices(cid, { partnerId: pid });
  const shown = (services.data ?? []).filter((s) => s.status === "open" || s.needsBilling).slice(0, 10);
  if (shown.length === 0) return null;
  return (
    <section className="grid gap-2">
      <h2 className="text-sm font-medium">처리 중인 A/S</h2>
      <ul className="grid gap-1.5">
        {shown.map((s) => (
          <li key={s.id}>
            <ServiceRow cid={cid} s={s} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PartnerTxns({ cid, pid }: { cid: string; pid: string }) {
  const txns = useTxns(cid, { partnerId: pid });
  return (
    <section className="grid gap-2">
      <h2 className="text-sm font-medium">거래 내역</h2>
      {txns.isPending ? (
        <InlineSpinner />
      ) : txns.isError ? (
        <ErrorAlert error={txns.error} />
      ) : txns.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">거래가 없습니다.</p>
      ) : (
        <ul className="grid gap-1.5">
          {txns.data.slice(0, 50).map((t) => (
            <li key={t.id}>
              <TxnRow cid={cid} t={t} showPartner={false} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Info({ label, value, href, icon }: { label: string; value?: string; href?: string | false; icon?: ReactNode }) {
  if (!value) return null;
  return (
    <p className="flex gap-3">
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      {href ? (
        <a href={href} className="flex min-w-0 items-center gap-1 text-primary">
          {icon}
          <span className="truncate">{value}</span>
        </a>
      ) : (
        <span className="min-w-0 break-words">{value}</span>
      )}
    </p>
  );
}

const EMPTY: Required<Omit<PartnerInput, "active">> = { name: "", kind: "customer", bizNo: "", ceo: "", contactName: "", phone: "", mobile: "", email: "", address: "", memo: "" };

export function PartnerDialog({ cid, partner, onClose, onCreated }: { cid: string; partner: Partner | null; onClose: () => void; onCreated?: (p: Partner) => void }) {
  const [form, setForm] = useState(() => ({ ...EMPTY, ...Object.fromEntries(Object.entries(partner ?? {}).filter(([k]) => k in EMPTY)) }) as typeof EMPTY);
  const mut = useMasterMutations(cid);
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v])) as typeof EMPTY;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{partner ? "거래처 수정" : "거래처 추가"}</DialogTitle>
        </DialogHeader>
        <form
          id="partner-form"
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (partner) mut.patchPartner.mutate({ id: partner.id, ...body }, { onSuccess: onClose });
            else mut.createPartner.mutate(body, { onSuccess: (p) => (onCreated?.(p), onClose()) });
          }}
        >
          <Field label="이름 *" wide>
            <Input autoFocus required maxLength={60} value={form.name} onChange={set("name")} />
          </Field>
          <Field label="구분">
            <NativeSelect value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as PartnerKind })} className="h-9">
              {(Object.keys(PARTNER_KIND_LABEL) as PartnerKind[]).map((k) => (
                <option key={k} value={k}>
                  {PARTNER_KIND_LABEL[k]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="사업자번호">
            <Input inputMode="numeric" maxLength={20} placeholder="123-45-67890" value={form.bizNo} onChange={set("bizNo")} />
          </Field>
          <Field label="대표">
            <Input maxLength={30} value={form.ceo} onChange={set("ceo")} />
          </Field>
          <Field label="담당자">
            <Input maxLength={30} value={form.contactName} onChange={set("contactName")} />
          </Field>
          <Field label="전화">
            <Input type="tel" maxLength={30} value={form.phone} onChange={set("phone")} />
          </Field>
          <Field label="휴대폰">
            <Input type="tel" maxLength={30} value={form.mobile} onChange={set("mobile")} />
          </Field>
          <Field label="이메일" wide>
            <Input type="email" maxLength={100} value={form.email} onChange={set("email")} />
          </Field>
          <Field label="주소" wide>
            <Input maxLength={200} value={form.address} onChange={set("address")} />
          </Field>
          <Field label="메모" wide>
            <Textarea rows={2} maxLength={1000} value={form.memo} onChange={set("memo")} />
          </Field>
        </form>
        <ErrorAlert error={mut.createPartner.error ?? mut.patchPartner.error ?? mut.deletePartner.error} />
        <DialogFooter className="flex-row flex-wrap items-center">
          {partner && (
            <>
              <Button type="button" variant="ghost" onClick={() => mut.patchPartner.mutate({ id: partner.id, active: !partner.active }, { onSuccess: onClose })}>
                {partner.active ? "사용 안 함" : "다시 사용"}
              </Button>
              <ConfirmButton type="button" variant="ghost" className="mr-auto" title="거래처를 삭제할까요?" description="거래·기기 이력이 있으면 삭제할 수 없고 '사용 안 함'으로 숨겨야 합니다." confirmLabel="삭제" onConfirm={() => mut.deletePartner.mutateAsync(partner.id).then(onClose)}>
                삭제
              </ConfirmButton>
            </>
          )}
          <Button type="button" variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" form="partner-form" disabled={!form.name.trim() || mut.createPartner.isPending || mut.patchPartner.isPending}>
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
