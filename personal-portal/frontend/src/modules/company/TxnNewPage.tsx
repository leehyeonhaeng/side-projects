import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ArrowLeftIcon, CheckIcon } from "lucide-react";
import {
  EXPENSE_CATEGORIES,
  TXN_LABEL,
  type TxnInput,
  type TxnType,
  useAccounts,
  useAssets,
  useItems,
  useOpenCharges,
  usePartners,
  useTxnMutations,
} from "@/api/company";
import { NativeSelect } from "@/components/NativeSelect";
import { ErrorAlert, FormError, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { todayStr } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { useCompanyOutlet } from "./CompanyLayout";
import { type DraftLine, TxnLinesEditor, newLine, toLineInput } from "./TxnLinesEditor";
import { Field, Search, StatusBadge, matches, money } from "./ui";

type Choice = { type: TxnType; hint: string; money: boolean; area: "txns" | "money" };
const CHOICES: Choice[] = [
  { type: "rental_out", hint: "기기를 거래처에 설치", money: false, area: "txns" },
  { type: "rental_return", hint: "임대한 기기를 거둬옴", money: false, area: "txns" },
  { type: "sale", hint: "토너·용지 등 판매", money: true, area: "txns" },
  { type: "charge", hint: "임대료·수리비 등 청구", money: true, area: "txns" },
  { type: "receipt", hint: "거래처에게서 돈 받음", money: true, area: "money" },
  { type: "purchase", hint: "물건·기기를 사들임", money: true, area: "txns" },
  { type: "payment", hint: "매입처에 돈 지급", money: true, area: "money" },
  { type: "expense", hint: "임차료·유류비 등", money: true, area: "money" },
  { type: "adjust", hint: "재고 수량 맞추기", money: false, area: "txns" },
];

/** 거래 입력 (COMPANY.md 5장): 종류 → 거래 하나 저장 → 재고·기기·잔액·계좌가 함께 바뀜 */
export function TxnNewPage() {
  const { cid, detail } = useCompanyOutlet();
  const [params, setParams] = useSearchParams();
  const type = params.get("type") as TxnType | null;
  const me = detail.me;
  const allowed = CHOICES.filter((c) => me.perms[c.area] === "edit" && (!c.money || me.showAmounts));

  if (!type || !allowed.some((c) => c.type === type)) {
    return (
      <main className="mx-auto grid max-w-3xl gap-4 p-4 md:p-6">
        <Link to={`/company/${cid}/txns`} className="flex items-center gap-1 text-sm text-muted-foreground">
          <ArrowLeftIcon className="size-4" /> 거래
        </Link>
        <h1 className="text-xl font-bold tracking-tight">새 거래</h1>
        {allowed.length === 0 && <p className="text-sm text-muted-foreground">거래를 입력할 권한이 없습니다.</p>}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {allowed.map((c) => (
            <button key={c.type} type="button" onClick={() => setParams({ ...Object.fromEntries(params), type: c.type })} className="grid gap-0.5 rounded-2xl border bg-card p-4 text-left hover:bg-muted/50 active:bg-muted">
              <span className="font-semibold">{TXN_LABEL[c.type]}</span>
              <span className="text-xs text-muted-foreground">{c.hint}</span>
            </button>
          ))}
        </div>
      </main>
    );
  }
  return <TxnForm key={type} cid={cid} type={type} defaultVat={detail.company.vatDefault} showAmounts={me.showAmounts} presetPartner={params.get("partner") ?? ""} presetAsset={params.get("asset") ?? ""} />;
}

function TxnForm({ cid, type, defaultVat, showAmounts, presetPartner, presetAsset }: { cid: string; type: TxnType; defaultVat: "included" | "excluded" | "exempt"; showAmounts: boolean; presetPartner: string; presetAsset: string }) {
  const navigate = useNavigate();
  const partners = usePartners(cid);
  const items = useItems(cid);
  const assets = useAssets(cid, type === "rental_out" || type === "rental_return");
  const accounts = useAccounts(cid, showAmounts && ["receipt", "payment", "expense", "sale", "charge", "purchase"].includes(type));
  const mut = useTxnMutations(cid);

  const [date, setDate] = useState(todayStr());
  const [partnerId, setPartnerId] = useState(presetPartner);
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<DraftLine[]>(() => [newLine(defaultVat)]);
  const [withCharge, setWithCharge] = useState(false); // 임대 출고·수거에 금액 줄 붙이기
  const [assetIds, setAssetIds] = useState<string[]>(presetAsset ? [presetAsset] : []);
  const [returnLocation, setReturnLocation] = useState("");
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [payNow, setPayNow] = useState(false);
  const [manualAlloc, setManualAlloc] = useState<Record<string, string> | null>(null);
  const [adjust, setAdjust] = useState<{ itemId: string; qty: string; memo: string }[]>([{ itemId: "", qty: "", memo: "" }]);
  const [error, setError] = useState<string | null>(null);

  const isPay = type === "receipt" || type === "payment";
  const side = type === "payment" ? "payable" : "receivable";
  const open = useOpenCharges(cid, partnerId || undefined, side, isPay);
  const needsPartner = type !== "expense" && type !== "adjust";
  const partnerKinds = type === "purchase" || type === "payment" ? ["supplier", "both"] : type === "expense" ? ["customer", "supplier", "both"] : ["customer", "both"];
  const partnerList = (partners.data ?? []).filter((p) => p.active && partnerKinds.includes(p.kind));
  const accountList = (accounts.data ?? []).filter((a) => a.active);
  const allItems = (items.data ?? []).filter((i) => i.active);
  const lineItems = type === "sale" ? allItems.filter((i) => i.tracking === "stock") : type === "purchase" ? allItems : type === "charge" ? allItems.filter((i) => i.tracking === "stock") : [];
  const amt = Number(amount.replace(/,/g, "")) || 0;

  // 입금·지급 자동 배분 미리보기 (오래된 청구부터)
  const autoPlan = useMemo(() => {
    let left = amt;
    return (open.data ?? []).map((c) => {
      const x = Math.min(left, c.open);
      left -= x;
      return { ...c, alloc: x };
    });
  }, [open.data, amt]);
  const plan = manualAlloc ? (open.data ?? []).map((c) => ({ ...c, alloc: Number((manualAlloc[c.id] ?? "").replace(/,/g, "")) || 0 })) : autoPlan;
  const allocated = plan.reduce((s, c) => s + c.alloc, 0);

  const submit = () => {
    setError(null);
    const body: TxnInput = { type, date, memo: memo.trim() };
    if (needsPartner || (type === "expense" && partnerId)) {
      if (!partnerId) return setError("거래처를 고르세요.");
      body.partnerId = partnerId;
    }
    if (["sale", "charge", "purchase"].includes(type) || ((type === "rental_out" || type === "rental_return") && withCharge)) {
      const ls = lines.map((l) => toLineInput(l, allItems)).filter((l) => l.itemId || l.name);
      if (ls.length === 0) return setError("내용을 한 줄 이상 입력하세요.");
      body.lines = ls;
    }
    if (type === "rental_out" || type === "rental_return") {
      if (assetIds.length === 0) return setError("기기를 고르세요.");
      body.assetIds = assetIds;
      if (type === "rental_return") body.returnLocation = returnLocation.trim();
    }
    if (isPay || type === "expense") {
      if (!accountId) return setError("계좌를 고르세요.");
      if (amt <= 0) return setError("금액을 입력하세요.");
      body.accountId = accountId;
      body.amount = amt;
      if (type === "expense") body.category = category.trim();
      if (isPay && manualAlloc) {
        if (allocated > amt) return setError("배분 합계가 금액보다 큽니다.");
        body.allocations = plan.filter((c) => c.alloc > 0).map((c) => ({ txnId: c.id, date: c.date, amount: c.alloc }));
      }
    }
    if (payNow && ["sale", "charge", "purchase"].includes(type)) {
      if (!accountId) return setError("바로 결제할 계좌를 고르세요.");
      body.payNow = { accountId };
    }
    if (type === "adjust") {
      const ls = adjust.filter((a) => a.itemId && Number(a.qty)).map((a) => ({ itemId: a.itemId, name: "", qty: Number(a.qty), memo: a.memo.trim() }));
      if (ls.length === 0) return setError("조정할 품목과 수량(+/-)을 입력하세요.");
      body.lines = ls;
    }
    mut.create.mutate(body, { onSuccess: (r) => void navigate(`/company/${cid}/txns/${r.txn.date}/${r.txn.id}`, { replace: true, state: { created: true } }) });
  };

  if (partners.isPending || items.isPending) return <main className="p-4"><InlineSpinner /></main>;

  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 md:p-6">
      <Link to={`/company/${cid}/txns/new`} className="flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeftIcon className="size-4" /> 종류 다시 고르기
      </Link>
      <h1 className="text-xl font-bold tracking-tight">{TXN_LABEL[type]}</h1>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <section className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2">
          <Field label="날짜">
            <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </Field>
          {(needsPartner || type === "expense") && (
            <Field label={type === "expense" ? "거래처 (선택)" : type === "purchase" || type === "payment" ? "매입처" : "거래처"}>
              <NativeSelect value={partnerId} onChange={(e) => (setPartnerId(e.target.value), setManualAlloc(null), type === "rental_return" && setAssetIds([]))} className="h-9">
                <option value="">{partnerList.length ? "고르세요" : "거래처를 먼저 등록하세요"}</option>
                {partnerList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
        </section>

        {(type === "rental_out" || type === "rental_return") && (
          <AssetPicker
            assets={(assets.data ?? []).filter((a) => (type === "rental_out" ? a.status === "in_stock" : a.status === "rented" && a.partnerId === partnerId))}
            selected={assetIds}
            onChange={setAssetIds}
            loading={assets.isPending}
            empty={type === "rental_out" ? "창고에 있는 기기가 없습니다." : partnerId ? "이 거래처에 임대 중인 기기가 없습니다." : "거래처를 먼저 고르세요."}
          />
        )}
        {type === "rental_return" && (
          <Field label="돌려놓을 창고 위치 (선택)">
            <Input maxLength={60} value={returnLocation} onChange={(e) => setReturnLocation(e.target.value)} />
          </Field>
        )}
        {(type === "rental_out" || type === "rental_return") && showAmounts && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={withCharge} onChange={(e) => setWithCharge(e.target.checked)} />
            금액 청구 같이 하기 (설치비·정산 등)
          </label>
        )}

        {(["sale", "charge", "purchase"].includes(type) || ((type === "rental_out" || type === "rental_return") && withCharge)) && (
          <section className="grid gap-2">
            <h2 className="text-sm font-medium">{type === "purchase" ? "매입 내역" : type === "sale" ? "판매 내역" : "청구 내역"}</h2>
            <TxnLinesEditor lines={lines} onChange={setLines} items={lineItems} defaultVat={defaultVat} priceField={type === "purchase" ? "cost" : "price"} allowFree={type !== "sale"} />
            {type === "purchase" && <p className="text-xs text-muted-foreground">기기 모델을 매입하면 대수만큼 기기가 자동 등록됩니다(고유번호 부여).</p>}
          </section>
        )}

        {["sale", "charge", "purchase"].includes(type) && showAmounts && (
          <section className="grid gap-2 rounded-2xl border bg-card p-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={payNow} onChange={(e) => setPayNow(e.target.checked)} />
              {type === "purchase" ? "바로 지급" : "바로 결제 받음"} (현금·카드·이체 즉시)
            </label>
            {payNow && <AccountSelect accounts={accountList} value={accountId} onChange={setAccountId} />}
          </section>
        )}

        {(isPay || type === "expense") && (
          <section className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2">
            <Field label="계좌">
              <AccountSelect accounts={accountList} value={accountId} onChange={setAccountId} />
            </Field>
            <Field label="금액 (원)">
              <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d,]/g, ""))} />
            </Field>
            {type === "expense" && (
              <Field label="항목">
                <Input list="expense-cats" maxLength={30} value={category} onChange={(e) => setCategory(e.target.value)} />
                <datalist id="expense-cats">
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </Field>
            )}
          </section>
        )}

        {isPay && partnerId && (
          <section className="grid gap-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">{type === "receipt" ? "남은 청구에 배분" : "남은 매입에 배분"}</h2>
              <Button type="button" size="xs" variant="ghost" onClick={() => setManualAlloc(manualAlloc ? null : Object.fromEntries(autoPlan.map((c) => [c.id, c.alloc ? String(c.alloc) : ""])))}>
                {manualAlloc ? "자동 배분으로" : "직접 배분"}
              </Button>
            </div>
            {open.isPending ? (
              <InlineSpinner />
            ) : plan.length === 0 ? (
              <p className="text-sm text-muted-foreground">남은 {type === "receipt" ? "청구" : "매입"}가 없습니다. 전액 {type === "receipt" ? "선수금" : "선급금"}으로 남습니다.</p>
            ) : (
              <ul className="grid gap-1.5">
                {plan.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">
                        {c.summary} <span className="text-xs text-muted-foreground">{c.no}</span>
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {c.date} · 남은 {money(c.open)}
                      </span>
                    </span>
                    {manualAlloc ? (
                      <Input inputMode="numeric" value={manualAlloc[c.id] ?? ""} onChange={(e) => setManualAlloc({ ...manualAlloc, [c.id]: e.target.value })} className="h-8 w-28" aria-label={`${c.no} 배분`} />
                    ) : (
                      <span className={cn("shrink-0 tabular-nums", c.alloc ? "font-medium" : "text-muted-foreground")}>{c.alloc ? money(c.alloc) : "—"}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {amt > 0 && (
              <p className="text-xs text-muted-foreground">
                배분 {money(allocated)} · {type === "receipt" ? "선수금" : "선급금"}으로 남음 {money(Math.max(0, amt - allocated))}
              </p>
            )}
          </section>
        )}

        {type === "adjust" && (
          <section className="grid gap-2">
            <h2 className="text-sm font-medium">조정할 품목 (늘리면 +, 줄이면 −)</h2>
            {adjust.map((a, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_5rem] gap-2">
                <NativeSelect value={a.itemId} onChange={(e) => setAdjust(adjust.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)))} className="h-9 w-full min-w-0" aria-label="품목">
                  <option value="">품목</option>
                  {allItems
                    .filter((it) => it.tracking === "stock")
                    .map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.name} (현재 {it.qty ?? 0})
                      </option>
                    ))}
                </NativeSelect>
                <Input inputMode="decimal" placeholder="-2" value={a.qty} onChange={(e) => setAdjust(adjust.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} className="h-9" aria-label="수량 변화" />
                <Input placeholder="사유 (분실, 파손, 실사 차이)" maxLength={200} value={a.memo} onChange={(e) => setAdjust(adjust.map((x, j) => (j === i ? { ...x, memo: e.target.value } : x)))} className="col-span-2 h-9" />
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" className="justify-self-start" onClick={() => setAdjust([...adjust, { itemId: "", qty: "", memo: "" }])}>
              품목 추가
            </Button>
          </section>
        )}

        <Field label="메모">
          <Input maxLength={500} value={memo} onChange={(e) => setMemo(e.target.value)} />
        </Field>
        <FormError message={error} />
        <ErrorAlert error={mut.create.error} />
        <Button type="submit" size="lg" disabled={mut.create.isPending}>
          {TXN_LABEL[type]} 저장
        </Button>
      </form>
    </main>
  );
}

function AccountSelect({ accounts, value, onChange }: { accounts: { id: string; name: string; balance?: number }[]; value: string; onChange: (v: string) => void }) {
  return (
    <NativeSelect value={value} onChange={(e) => onChange(e.target.value)} className="h-9" aria-label="계좌">
      <option value="">{accounts.length ? "계좌 고르기" : "계좌를 먼저 등록하세요"}</option>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </NativeSelect>
  );
}

function AssetPicker({ assets, selected, onChange, loading, empty }: { assets: { id: string; code: string; itemName: string; serial: string; status: "in_stock" | "rented" | "repair" | "retired"; location: string }[]; selected: string[]; onChange: (ids: string[]) => void; loading: boolean; empty: string }) {
  const [q, setQ] = useState("");
  const shown = assets.filter((a) => matches([a.code, a.itemName, a.serial, a.location].join(" "), q));
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <section className="grid gap-2">
      <h2 className="text-sm font-medium">기기 {selected.length > 0 && <span className="text-primary">{selected.length}대 선택</span>}</h2>
      {assets.length > 6 && <Search value={q} onChange={setQ} placeholder="고유번호·모델·제조번호" />}
      {loading ? (
        <InlineSpinner />
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="grid max-h-80 gap-1.5 overflow-y-auto">
          {shown.map((a) => {
            const on = selected.includes(a.id);
            return (
              <li key={a.id}>
                <button type="button" aria-pressed={on} onClick={() => toggle(a.id)} className={cn("flex w-full items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left", on && "border-primary bg-primary/5 ring-1 ring-primary")}>
                  <span className={cn("grid size-5 shrink-0 place-items-center rounded-md border-2", on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40")}>{on && <CheckIcon className="size-3.5" />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{a.code}</span>
                      <span className="truncate text-sm">{a.itemName}</span>
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{[a.serial && `S/N ${a.serial}`, a.location].filter(Boolean).join(" · ") || "—"}</span>
                  </span>
                  <StatusBadge status={a.status} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
