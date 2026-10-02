import { type ReactNode, useEffect, useState } from "react";
import { DownloadIcon, RepeatIcon, SearchIcon } from "lucide-react";
import { type Category, type Txn, type TxnType, downloadCsv, useLedgerMutations, useTxnRange, useTxnSearch, useTxnSummary, won } from "@/api/ledger";
import { ConfirmButton } from "@/components/ConfirmButton";
import { NativeSelect } from "@/components/NativeSelect";
import { ErrorAlert, FormError, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDay, todayStr } from "@/lib/dates";
import { cn } from "@/lib/utils";

type Props = { month: string; txns: Txn[]; categories: Category[]; readOnly: boolean };

export function TxnTab({ month, txns, categories, readOnly }: Props) {
  const [editing, setEditing] = useState<Txn | null>(null);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const results = useTxnSearch(search);
  const year = month.slice(0, 4);
  const [exportYear, setExportYear] = useState(false);
  const yearTxns = useTxnRange(`${year}-01-01`, `${year}-12-31`, exportYear);

  const exportCsv = (scope: "month" | "year") => {
    if (scope === "month") return downloadCsv(`가계부_${month}.csv`, txns, categories);
    setExportYear(true);
  };
  // 올해 내역은 받아온 뒤 내려받기
  useEffect(() => {
    if (exportYear && yearTxns.data) {
      downloadCsv(`가계부_${year}.csv`, yearTxns.data, categories);
      setExportYear(false);
    }
  }, [exportYear, yearTxns.data, year, categories]);

  return (
    <div className="grid gap-4">
      {!readOnly && <TxnForm key={editing?.id ?? "new"} month={month} original={editing} categories={categories} onDone={() => setEditing(null)} />}

      <form
        className="flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(q.trim());
        }}
      >
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="메모·결제 수단·카테고리 검색 (전체 기간)" value={q} onChange={(e) => (setQ(e.target.value), !e.target.value && setSearch(""))} className="h-9 pl-8" />
        </div>
        <Button type="submit" variant="outline" className="h-9" disabled={!q.trim()}>
          검색
        </Button>
      </form>

      {search ? (
        <section className="grid gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">"{search}" 검색 결과</h3>
            <Button size="xs" variant="ghost" onClick={() => (setSearch(""), setQ(""))}>
              닫기
            </Button>
          </div>
          {results.isPending ? <InlineSpinner /> : results.isError ? <ErrorAlert error={results.error} /> : <TxnList txns={results.data} categories={categories} readOnly={readOnly} onEdit={setEditing} showYear />}
        </section>
      ) : (
        <section className="grid gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">내역 {txns.length}건</h3>
            <div className="flex gap-1">
              <Button size="xs" variant="ghost" disabled={txns.length === 0} onClick={() => exportCsv("month")}>
                <DownloadIcon /> 이 달 CSV
              </Button>
              <Button size="xs" variant="ghost" disabled={exportYear} onClick={() => exportCsv("year")}>
                <DownloadIcon /> {year}년 CSV
              </Button>
            </div>
          </div>
          <TxnList txns={txns} categories={categories} readOnly={readOnly} onEdit={setEditing} />
        </section>
      )}
      <ErrorAlert error={yearTxns.error} />
    </div>
  );
}

function TxnList({ txns, categories, readOnly, onEdit, showYear }: { txns: Txn[]; categories: Category[]; readOnly: boolean; onEdit: (t: Txn) => void; showYear?: boolean }) {
  if (txns.length === 0) return <p className="text-sm text-muted-foreground">내역이 없습니다.</p>;
  const name = (id: string) => categories.find((c) => c.id === id)?.name ?? "(삭제된 카테고리)";
  const days = [...new Set(txns.map((t) => t.date))].sort().reverse();
  return (
    <div className="grid gap-3">
      {days.map((day) => {
        const list = txns.filter((t) => t.date === day);
        const out = list.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
        return (
          <div key={day} className="grid gap-1">
            <div className="flex justify-between px-1 text-xs text-muted-foreground">
              <span>{showYear ? day : formatDay(day)}</span>
              {out > 0 && <span className="tabular-nums">지출 {won(out)}</span>}
            </div>
            <ul className="grid gap-1">
              {list.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    disabled={readOnly}
                    onClick={() => onEdit(t)}
                    className="flex w-full items-center gap-2 rounded-lg border bg-card px-3 py-2 text-left text-sm enabled:hover:bg-muted/50"
                  >
                    <span className="w-20 shrink-0 truncate text-xs text-muted-foreground">{name(t.categoryId)}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {t.memo || <span className="text-muted-foreground">-</span>}
                      {t.method && <span className="ml-1.5 text-xs text-muted-foreground">{t.method}</span>}
                    </span>
                    {t.recurId && <RepeatIcon className="size-3 shrink-0 text-muted-foreground" aria-label="고정 지출" />}
                    <span className={cn("shrink-0 font-medium tabular-nums", t.type === "income" ? "text-blue-600 dark:text-blue-400" : "")}>
                      {t.type === "income" ? "+" : "-"}
                      {won(t.amount)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function TxnForm({ month, original, categories, onDone }: { month: string; original: Txn | null; categories: Category[]; onDone: () => void }) {
  const today = todayStr();
  const defaultDay = month === today.slice(0, 7) ? today : `${month}-01`;
  const [type, setType] = useState<TxnType>(original?.type ?? "expense");
  const [date, setDate] = useState(original?.date ?? defaultDay);
  const [amount, setAmount] = useState(original ? String(original.amount) : "");
  const ofType = (t: TxnType) => categories.filter((c) => c.type === t);
  const [categoryId, setCategoryId] = useState(original?.categoryId ?? ofType("expense")[0]?.id ?? "");
  const [method, setMethod] = useState(original?.method ?? "");
  const [memo, setMemo] = useState(original?.memo ?? "");
  const [error, setError] = useState<string | null>(null);
  const summary = useTxnSummary(6);
  const mut = useLedgerMutations();

  const switchType = (t: TxnType) => {
    setType(t);
    if (!ofType(t).some((c) => c.id === categoryId)) setCategoryId(ofType(t)[0]?.id ?? "");
  };
  const value = Number(amount.replaceAll(",", ""));

  const submit = () => {
    setError(null);
    if (!Number.isInteger(value) || value < 1) return setError("금액은 1원 이상 정수로 입력하세요.");
    mut.saveTxn.mutate(
      { original: original ?? undefined, input: { type, date, amount: value, categoryId, method: method.trim(), memo: memo.trim() } },
      { onSuccess: () => (setAmount(""), setMemo(""), onDone()) },
    );
  };

  return (
    <form
      className="grid gap-2 rounded-2xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex gap-1">
          {(["expense", "income"] as const).map((t) => (
            <Button key={t} type="button" size="sm" variant={type === t ? "default" : "outline"} onClick={() => switchType(t)}>
              {t === "expense" ? "지출" : "수입"}
            </Button>
          ))}
        </div>
        <Field label="날짜">
          <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-8 w-36" />
        </Field>
        <Field label="금액 (원)">
          <Input inputMode="numeric" required placeholder="12000" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d,]/g, ""))} className="h-8 w-28" />
        </Field>
        <Field label="카테고리">
          <NativeSelect value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {ofType(type).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="결제 수단">
          <Input list="ledger-methods" maxLength={30} placeholder="카드, 현금…" value={method} onChange={(e) => setMethod(e.target.value)} className="h-8 w-32" />
          <datalist id="ledger-methods">
            {summary.data?.methods.map((m) => <option key={m} value={m} />)}
          </datalist>
        </Field>
        <Field label="메모" grow>
          <Input maxLength={200} value={memo} onChange={(e) => setMemo(e.target.value)} className="h-8" />
        </Field>
        {value > 0 && <span className="pb-1.5 text-xs tabular-nums text-muted-foreground">{won(value)}</span>}
      </div>
      <div className="flex gap-1">
        <Button type="submit" size="sm" disabled={!amount || !categoryId || mut.saveTxn.isPending}>
          {original ? "수정" : "기록"}
        </Button>
        {original && (
          <>
            <Button type="button" size="sm" variant="ghost" onClick={onDone}>
              취소
            </Button>
            <ConfirmButton type="button" size="sm" variant="ghost" title="이 내역을 삭제할까요?" description={`${original.date} ${won(original.amount)} ${original.memo}`} confirmLabel="삭제" onConfirm={() => mut.deleteTxn.mutateAsync(original).then(onDone)}>
              삭제
            </ConfirmButton>
          </>
        )}
      </div>
      {original?.recurId && <p className="text-xs text-muted-foreground">고정 지출로 만든 내역입니다. 여기서 고치면 이 회차만 바뀝니다.</p>}
      <FormError message={error} />
      <ErrorAlert error={mut.saveTxn.error ?? mut.deleteTxn.error} />
    </form>
  );
}

export function Field({ label, grow, children }: { label: string; grow?: boolean; children: ReactNode }) {
  return <label className={cn("grid gap-1 text-xs text-muted-foreground", grow && "min-w-40 flex-1")}>{label}{children}</label>;
}
