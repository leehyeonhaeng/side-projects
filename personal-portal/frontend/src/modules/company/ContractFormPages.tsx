import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ArrowLeftIcon } from "lucide-react";
import { type ContractMachine, type MachineInput, type Terms, VAT_LABEL, type VatMode, billingDayLabel, useAssets, useContract, useContracts, useItems, usePartners, useRentalMutations } from "@/api/company";
import { NativeSelect } from "@/components/NativeSelect";
import { ErrorAlert, FormError, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { todayStr } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { useCompanyOutlet } from "./CompanyLayout";
import { termsText } from "./ContractsPage";
import { type DraftLine, TxnLinesEditor, newLine, toLineInput } from "./TxnLinesEditor";
import { AssetPicker } from "./TxnNewPage";
import { Chip, Field } from "./ui";

const num = (v: string) => Number(v.replace(/,/g, "")) || 0;
const digits = (v: string) => v.replace(/[^\d,]/g, "");

type TermsDraft = { monthly: string; counter: boolean; freeMono: string; freeColor: string; overMono: string; overColor: string; startMono: string; startColor: string };
const draftOf = (t: Partial<Terms>, monthly?: number): TermsDraft => ({
  monthly: (t.monthly ?? monthly ?? "").toString(),
  counter: t.counter ?? false,
  freeMono: (t.freeMono ?? "").toString(),
  freeColor: (t.freeColor ?? "").toString(),
  overMono: (t.overMono ?? "").toString(),
  overColor: (t.overColor ?? "").toString(),
  startMono: "",
  startColor: "",
});
const termsOf = (d: TermsDraft, showAmounts: boolean): Terms => ({
  counter: d.counter,
  freeMono: d.counter ? num(d.freeMono) : 0,
  freeColor: d.counter ? num(d.freeColor) : 0,
  ...(showAmounts ? { monthly: num(d.monthly), overMono: d.counter ? num(d.overMono) : 0, overColor: d.counter ? num(d.overColor) : 0 } : {}),
});

/** 기기 한 대 요금 입력: 월 기본료 + (카운터 과금이면) 기본 매수·초과 단가·설치 카운터 */
function TermsCard({ title, sub, d, onChange, showAmounts, withStart }: { title: string; sub: string; d: TermsDraft; onChange: (d: TermsDraft) => void; showAmounts: boolean; withStart: boolean }) {
  const set = (p: Partial<TermsDraft>) => onChange({ ...d, ...p });
  return (
    <div className="grid gap-2 rounded-xl border bg-muted/20 p-3">
      <p className="flex items-center gap-2 text-sm">
        <span className="font-mono font-semibold">{title}</span>
        <span className="min-w-0 truncate text-muted-foreground">{sub}</span>
      </p>
      <div className="grid grid-cols-2 gap-2">
        {showAmounts && (
          <Field label="월 기본료 (원)">
            <Input inputMode="numeric" value={d.monthly} onChange={(e) => set({ monthly: digits(e.target.value) })} className="h-9" />
          </Field>
        )}
        <Field label="과금 방식">
          <NativeSelect value={d.counter ? "counter" : "fixed"} onChange={(e) => set({ counter: e.target.value === "counter" })} className="h-9">
            <option value="fixed">월 고정</option>
            <option value="counter">기본료 + 초과 매수</option>
          </NativeSelect>
        </Field>
      </div>
      {d.counter && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="흑백 기본 매수">
            <Input inputMode="numeric" value={d.freeMono} onChange={(e) => set({ freeMono: digits(e.target.value) })} className="h-9" />
          </Field>
          {showAmounts && (
            <Field label="흑백 초과 1매 (원)">
              <Input inputMode="numeric" value={d.overMono} onChange={(e) => set({ overMono: digits(e.target.value) })} className="h-9" />
            </Field>
          )}
          <Field label="컬러 기본 매수">
            <Input inputMode="numeric" value={d.freeColor} onChange={(e) => set({ freeColor: digits(e.target.value) })} className="h-9" />
          </Field>
          {showAmounts && (
            <Field label="컬러 초과 1매 (원)">
              <Input inputMode="numeric" value={d.overColor} onChange={(e) => set({ overColor: digits(e.target.value) })} className="h-9" />
            </Field>
          )}
          {withStart && (
            <>
              <Field label="설치 카운터 흑백">
                <Input inputMode="numeric" value={d.startMono} onChange={(e) => set({ startMono: digits(e.target.value) })} className="h-9" />
              </Field>
              <Field label="설치 카운터 컬러">
                <Input inputMode="numeric" value={d.startColor} onChange={(e) => set({ startColor: digits(e.target.value) })} className="h-9" />
              </Field>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** 임대 출고: 새 계약 또는 진행 중 계약에 기기 추가 (COMPANY.md 5장). ?partner ?asset ?contract */
export function RentalOutPage() {
  const { cid, detail } = useCompanyOutlet();
  const me = detail.me;
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const partners = usePartners(cid);
  const assets = useAssets(cid);
  const items = useItems(cid);
  const mut = useRentalMutations(cid);

  const [partnerId, setPartnerId] = useState(params.get("partner") ?? "");
  const contracts = useContracts(cid, { partnerId, status: "active" }, !!partnerId);
  const [target, setTarget] = useState<string>(params.get("contract") ?? "new"); // "new" 또는 계약 id
  const [date, setDate] = useState(todayStr());
  const [billingDay, setBillingDay] = useState("25");
  const [vatMode, setVatMode] = useState<VatMode>(detail.company.vatDefault);
  const [termEnd, setTermEnd] = useState("");
  const [memo, setMemo] = useState("");
  const [assetIds, setAssetIds] = useState<string[]>(params.get("asset") ? [params.get("asset")!] : []);
  const [terms, setTerms] = useState<Record<string, TermsDraft>>({});
  const [withLines, setWithLines] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>(() => [newLine(detail.company.vatDefault)]);
  const [error, setError] = useState<string | null>(null);

  const rentOf = (aid: string) => {
    const a = assets.data?.find((x) => x.id === aid);
    return items.data?.find((i) => i.id === a?.itemId)?.rentPrice;
  };
  // 고른 기기마다 요금 초안 (모델의 기본 임대료로 시작)
  useEffect(() => {
    if (!assets.data || !items.data) return;
    setTerms((t) => Object.fromEntries(assetIds.map((aid) => [aid, t[aid] ?? draftOf({}, rentOf(aid))])));
  }, [assetIds, assets.data, items.data]);
  const partnerList = (partners.data ?? []).filter((p) => p.active && p.kind !== "supplier");
  const isAdd = target !== "new";

  const submit = () => {
    setError(null);
    if (!partnerId) return setError("거래처를 고르세요.");
    if (assetIds.length === 0) return setError("출고할 기기를 고르세요.");
    const machines: MachineInput[] = assetIds.map((aid) => {
      const d = terms[aid] ?? draftOf({});
      return { assetId: aid, ...termsOf(d, me.showAmounts), ...(d.counter && d.startMono ? { startMono: num(d.startMono), startColor: num(d.startColor) } : {}) };
    });
    const ls = withLines ? lines.map((l) => toLineInput(l, [])).filter((l) => l.name) : [];
    const done = (kid: string) => void navigate(`/company/${cid}/contracts/${kid}`, { replace: true, state: { notice: "출고했습니다. 기기가 임대 중으로 바뀌었습니다." } });
    if (isAdd) mut.addMachines.mutate({ id: target, date, machines, lines: ls, memo: memo.trim() }, { onSuccess: () => done(target) });
    else {
      const day = Number(billingDay);
      if (!(day >= 1 && day <= 31)) return setError("청구일은 1~31 (31 = 말일)");
      mut.createContract.mutate({ partnerId, date, billingDay: day, vatMode, ...(termEnd ? { termEnd } : {}), machines, lines: ls, memo: memo.trim() }, { onSuccess: (r) => done(r.contract.id) });
    }
  };

  if (partners.isPending || assets.isPending || items.isPending) return <main className="p-4"><InlineSpinner /></main>;
  const busy = mut.createContract.isPending || mut.addMachines.isPending;

  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 md:p-6">
      <Link to={`/company/${cid}/contracts`} className="flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeftIcon className="size-4" /> 임대 계약
      </Link>
      <h1 className="text-xl font-bold tracking-tight">임대 출고</h1>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <section className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2">
          <Field label="거래처">
            <NativeSelect value={partnerId} onChange={(e) => (setPartnerId(e.target.value), setTarget("new"))} className="h-9">
              <option value="">{partnerList.length ? "고르세요" : "거래처를 먼저 등록하세요"}</option>
              {partnerList.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="출고일">
            <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </Field>
          {partnerId && (contracts.data?.length ?? 0) > 0 && (
            <div className="grid gap-1 text-xs text-muted-foreground sm:col-span-2">
              계약
              <div className="flex flex-wrap gap-1">
                <Chip on={target === "new"} onClick={() => setTarget("new")}>
                  새 계약
                </Chip>
                {contracts.data!.map((c) => (
                  <Chip key={c.id} on={target === c.id} onClick={() => setTarget(c.id)}>
                    {c.no}에 추가
                  </Chip>
                ))}
              </div>
            </div>
          )}
          {!isAdd && (
            <>
              <Field label="청구일 (매월)" hint="31 = 말일">
                <Input inputMode="numeric" value={billingDay} onChange={(e) => setBillingDay(e.target.value.replace(/\D/g, ""))} />
              </Field>
              <Field label="부가세">
                <NativeSelect value={vatMode} onChange={(e) => setVatMode(e.target.value as VatMode)} className="h-9">
                  {(Object.keys(VAT_LABEL) as VatMode[]).map((v) => (
                    <option key={v} value={v}>
                      {VAT_LABEL[v]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="계약 만료 예정 (선택)">
                <Input type="date" value={termEnd} onChange={(e) => setTermEnd(e.target.value)} />
              </Field>
            </>
          )}
        </section>

        <AssetPicker assets={(assets.data ?? []).filter((a) => a.status === "in_stock")} selected={assetIds} onChange={setAssetIds} loading={false} empty="창고에 있는 기기가 없습니다." />

        {assetIds.length > 0 && (
          <section className="grid gap-2">
            <h2 className="text-sm font-medium">기기별 요금</h2>
            {assetIds.map((aid) => {
              const a = assets.data?.find((x) => x.id === aid);
              const d = terms[aid];
              if (!a || !d) return null;
              return <TermsCard key={aid} title={a.code} sub={a.itemName} d={d} onChange={(nd) => setTerms({ ...terms, [aid]: nd })} showAmounts={me.showAmounts} withStart />;
            })}
          </section>
        )}

        {me.showAmounts && (
          <section className="grid gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={withLines} onChange={(e) => setWithLines(e.target.checked)} />
              설치비 등 같이 청구
            </label>
            {withLines && <TxnLinesEditor lines={lines} onChange={setLines} items={[]} defaultVat={vatMode} />}
          </section>
        )}

        <Field label="메모">
          <Input maxLength={500} value={memo} onChange={(e) => setMemo(e.target.value)} />
        </Field>
        <FormError message={error} />
        <ErrorAlert error={mut.createContract.error ?? mut.addMachines.error} />
        <Button type="submit" size="lg" disabled={busy}>
          {isAdd ? "계약에 기기 추가 출고" : "새 계약으로 출고"}
        </Button>
      </form>
    </main>
  );
}

/** 계약 기기 수거 (+ 카운터). 마지막 기기면 계약 종료, 정산은 청구 대기에 */
export function ContractReturnPage() {
  const { cid, detail } = useCompanyOutlet();
  const { kid = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const data = useContract(cid, kid);
  const mut = useRentalMutations(cid);
  const [date, setDate] = useState(todayStr());
  const [assetIds, setAssetIds] = useState<string[]>(params.get("asset") ? [params.get("asset")!] : []);
  const [readings, setReadings] = useState<Record<string, { mono: string; color: string }>>({});
  const [returnLocation, setReturnLocation] = useState("");
  const [withLines, setWithLines] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>(() => [newLine(detail.company.vatDefault)]);
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (data.isPending) return <main className="p-4"><InlineSpinner /></main>;
  if (data.isError) return <main className="p-4"><ErrorAlert error={data.error} /></main>;
  const c = data.data.contract;
  const active = Object.values(c.machines).filter((m) => !m.endedAt);
  const all = assetIds.length === active.length;

  const submit = () => {
    setError(null);
    if (assetIds.length === 0) return setError("수거할 기기를 고르세요.");
    const rs = assetIds.filter((aid) => readings[aid]?.mono).map((aid) => ({ assetId: aid, mono: num(readings[aid]!.mono), color: num(readings[aid]!.color) }));
    const ls = withLines ? lines.map((l) => toLineInput(l, [])).filter((l) => l.name) : [];
    mut.returnMachines.mutate(
      { id: kid, date, assetIds, readings: rs, returnLocation: returnLocation.trim(), lines: ls, memo: memo.trim() },
      { onSuccess: () => void navigate(`/company/${cid}/contracts/${kid}`, { replace: true, state: { notice: all ? "수거하고 계약을 종료했습니다. 마지막 달 정산은 청구 대기에 올라옵니다." : "수거했습니다." } }) },
    );
  };

  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 md:p-6">
      <Link to={`/company/${cid}/contracts/${kid}`} className="flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeftIcon className="size-4" /> {c.no}
      </Link>
      <h1 className="text-xl font-bold tracking-tight">수거 · {c.partnerName}</h1>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="수거일">
          <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </Field>
        <section className="grid gap-2">
          <h2 className="text-sm font-medium">수거할 기기</h2>
          {active.length === 0 && <p className="text-sm text-muted-foreground">임대 중인 기기가 없습니다.</p>}
          {active.map((m) => {
            const on = assetIds.includes(m.assetId);
            return (
              <div key={m.assetId} className={cn("grid gap-2 rounded-xl border bg-card p-3", on && "border-primary ring-1 ring-primary")}>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4 accent-primary" checked={on} onChange={() => setAssetIds(on ? assetIds.filter((x) => x !== m.assetId) : [...assetIds, m.assetId])} />
                  <span className="font-mono font-semibold">{m.code}</span>
                  <span className="min-w-0 truncate text-muted-foreground">{m.itemName}</span>
                </label>
                {on && m.counter && <ReadingInputs m={m} value={readings[m.assetId] ?? { mono: "", color: "" }} onChange={(v) => setReadings({ ...readings, [m.assetId]: v })} />}
              </div>
            );
          })}
        </section>
        {all && active.length > 0 && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-400/10 dark:text-amber-300">모든 기기를 수거하면 계약이 종료됩니다.</p>}
        <Field label="돌려놓을 창고 위치 (선택)">
          <Input maxLength={60} value={returnLocation} onChange={(e) => setReturnLocation(e.target.value)} />
        </Field>
        {detail.me.showAmounts && (
          <section className="grid gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={withLines} onChange={(e) => setWithLines(e.target.checked)} />
              수거비 등 같이 청구
            </label>
            {withLines && <TxnLinesEditor lines={lines} onChange={setLines} items={[]} defaultVat={c.vatMode} />}
          </section>
        )}
        <Field label="메모">
          <Input maxLength={500} value={memo} onChange={(e) => setMemo(e.target.value)} />
        </Field>
        <FormError message={error} />
        <ErrorAlert error={mut.returnMachines.error} />
        <Button type="submit" size="lg" disabled={mut.returnMachines.isPending}>
          수거 저장
        </Button>
      </form>
    </main>
  );
}

function ReadingInputs({ m, value, onChange }: { m: ContractMachine; value: { mono: string; color: string }; onChange: (v: { mono: string; color: string }) => void }) {
  const color = m.freeColor > 0 || (m.overColor ?? 0) > 0 || m.billedColor > 0;
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="수거 카운터 흑백" hint={`지난 청구 ${m.billedMono.toLocaleString()}`}>
        <Input inputMode="numeric" value={value.mono} onChange={(e) => onChange({ ...value, mono: digits(e.target.value) })} className="h-9" />
      </Field>
      {color && (
        <Field label="수거 카운터 컬러" hint={`지난 청구 ${m.billedColor.toLocaleString()}`}>
          <Input inputMode="numeric" value={value.color} onChange={(e) => onChange({ ...value, color: digits(e.target.value) })} className="h-9" />
        </Field>
      )}
    </div>
  );
}

/** 계약 조건 수정: 청구일·부가세·만료일·메모·기기별 요금 (다음 청구부터) */
export function ContractEditPage() {
  const { cid, detail } = useCompanyOutlet();
  const me = detail.me;
  const { kid = "" } = useParams();
  const navigate = useNavigate();
  const data = useContract(cid, kid);
  const mut = useRentalMutations(cid);
  const [form, setForm] = useState<{ billingDay: string; vatMode: VatMode; termEnd: string; memo: string; terms: Record<string, TermsDraft> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!data.data || form) return;
    const c = data.data.contract;
    setForm({ billingDay: String(c.billingDay), vatMode: c.vatMode, termEnd: c.termEnd ?? "", memo: c.memo, terms: Object.fromEntries(Object.values(c.machines).filter((m) => !m.endedAt).map((m) => [m.assetId, draftOf(m)])) });
  }, [data.data, form]);

  if (data.isPending || !form) return <main className="p-4">{data.isError ? <ErrorAlert error={data.error} /> : <InlineSpinner />}</main>;
  const c = data.data!.contract;

  const submit = () => {
    setError(null);
    const day = Number(form.billingDay);
    if (!(day >= 1 && day <= 31)) return setError("청구일은 1~31 (31 = 말일)");
    mut.patchContract.mutate(
      { id: kid, billingDay: day, vatMode: form.vatMode, termEnd: form.termEnd || null, memo: form.memo.trim(), machines: Object.fromEntries(Object.entries(form.terms).map(([aid, d]) => [aid, termsOf(d, me.showAmounts)])) },
      { onSuccess: () => void navigate(`/company/${cid}/contracts/${kid}`, { replace: true, state: { notice: "조건을 바꿨습니다. 다음 청구부터 적용됩니다." } }) },
    );
  };

  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 md:p-6">
      <Link to={`/company/${cid}/contracts/${kid}`} className="flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeftIcon className="size-4" /> {c.no}
      </Link>
      <h1 className="text-xl font-bold tracking-tight">조건 수정 · {c.partnerName}</h1>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <section className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2">
          <Field label="청구일 (매월)" hint={`지금 ${billingDayLabel(c.billingDay)} · 31 = 말일`}>
            <Input inputMode="numeric" value={form.billingDay} onChange={(e) => setForm({ ...form, billingDay: e.target.value.replace(/\D/g, "") })} />
          </Field>
          <Field label="부가세">
            <NativeSelect value={form.vatMode} onChange={(e) => setForm({ ...form, vatMode: e.target.value as VatMode })} className="h-9">
              {(Object.keys(VAT_LABEL) as VatMode[]).map((v) => (
                <option key={v} value={v}>
                  {VAT_LABEL[v]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="계약 만료 예정">
            <Input type="date" value={form.termEnd} onChange={(e) => setForm({ ...form, termEnd: e.target.value })} />
          </Field>
          <Field label="메모">
            <Input maxLength={500} value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} />
          </Field>
        </section>
        <section className="grid gap-2">
          <h2 className="text-sm font-medium">기기별 요금</h2>
          {Object.entries(form.terms).map(([aid, d]) => {
            const m = c.machines[aid]!;
            return <TermsCard key={aid} title={m.code} sub={`${m.itemName} · 지금 ${termsText(m, me.showAmounts)}`} d={d} onChange={(nd) => setForm({ ...form, terms: { ...form.terms, [aid]: nd } })} showAmounts={me.showAmounts} withStart={false} />;
          })}
        </section>
        <FormError message={error} />
        <ErrorAlert error={mut.patchContract.error} />
        <Button type="submit" size="lg" disabled={mut.patchContract.isPending}>
          저장
        </Button>
      </form>
    </main>
  );
}
