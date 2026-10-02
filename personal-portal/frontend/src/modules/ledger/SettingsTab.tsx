import { useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon } from "lucide-react";
import { type Category, type Recurring, type TxnType, monthLabel, monthOf, useLedgerMutations, useRecurring, won } from "@/api/ledger";
import { ConfirmButton } from "@/components/ConfirmButton";
import { NativeSelect } from "@/components/NativeSelect";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { todayStr } from "@/lib/dates";
import { Field } from "./TxnTab";

/** 고정 지출 + 카테고리 관리 */
export function SettingsTab({ categories, readOnly }: { categories: Category[]; readOnly: boolean }) {
  return (
    <div className="grid gap-6">
      <RecurringSection categories={categories} readOnly={readOnly} />
      <CategorySection categories={categories} readOnly={readOnly} />
    </div>
  );
}

function RecurringSection({ categories, readOnly }: { categories: Category[]; readOnly: boolean }) {
  const recurring = useRecurring();
  const [editing, setEditing] = useState<Recurring | "new" | null>(null);
  const name = (id: string) => categories.find((c) => c.id === id)?.name ?? "(삭제된 카테고리)";

  return (
    <section className="grid gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">고정 지출</h3>
        {!readOnly && editing === null && (
          <Button size="xs" variant="outline" onClick={() => setEditing("new")}>
            <PlusIcon /> 추가
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">가계부를 열 때 오늘까지 빠진 회차가 내역에 자동으로 생깁니다. 짧은 달은 말일로.</p>
      {editing !== null && <RecurringForm key={editing === "new" ? "new" : editing.id} original={editing === "new" ? null : editing} categories={categories} onDone={() => setEditing(null)} />}
      {recurring.isPending ? (
        <InlineSpinner />
      ) : recurring.isError ? (
        <ErrorAlert error={recurring.error} />
      ) : recurring.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">등록한 고정 지출이 없습니다.</p>
      ) : (
        <ul className="grid gap-1">
          {recurring.data.map((r) => (
            <li key={r.id}>
              <button type="button" disabled={readOnly} onClick={() => setEditing(r)} className="flex w-full items-center gap-2 rounded-lg border bg-card px-3 py-2 text-left text-sm enabled:hover:bg-muted/50">
                <span className="w-14 shrink-0 text-xs text-muted-foreground">매월 {r.day}일</span>
                <span className="min-w-0 flex-1 truncate">
                  {r.memo || name(r.categoryId)}
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    {name(r.categoryId)} · {monthLabel(r.startMonth)}~{r.endMonth ? monthLabel(r.endMonth) : ""}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums">{r.type === "income" ? "+" : "-"}{won(r.amount)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RecurringForm({ original, categories, onDone }: { original: Recurring | null; categories: Category[]; onDone: () => void }) {
  const [type, setType] = useState<TxnType>(original?.type ?? "expense");
  const ofType = categories.filter((c) => c.type === type);
  const [categoryId, setCategoryId] = useState(original?.categoryId ?? categories.find((c) => c.type === "expense")?.id ?? "");
  const [amount, setAmount] = useState(original ? String(original.amount) : "");
  const [day, setDay] = useState(String(original?.day ?? 1));
  const [memo, setMemo] = useState(original?.memo ?? "");
  const [method, setMethod] = useState(original?.method ?? "");
  const [startMonth, setStartMonth] = useState(original?.startMonth ?? monthOf(todayStr()));
  const [endMonth, setEndMonth] = useState(original?.endMonth ?? "");
  const mut = useLedgerMutations();

  return (
    <form
      className="grid gap-2 rounded-2xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        mut.saveRecurring.mutate(
          { id: original?.id, input: { type, categoryId, amount: Number(amount), day: Number(day), memo: memo.trim(), method: method.trim(), startMonth, endMonth: endMonth || null } },
          { onSuccess: onDone },
        );
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex gap-1">
          {(["expense", "income"] as const).map((t) => (
            <Button
              key={t}
              type="button"
              size="sm"
              variant={type === t ? "default" : "outline"}
              onClick={() => {
                setType(t);
                setCategoryId(categories.find((c) => c.type === t)?.id ?? "");
              }}
            >
              {t === "expense" ? "지출" : "수입"}
            </Button>
          ))}
        </div>
        <Field label="매월">
          <NativeSelect value={day} onChange={(e) => setDay(e.target.value)}>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}일
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="금액 (원)">
          <Input inputMode="numeric" required value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} className="h-8 w-28" />
        </Field>
        <Field label="카테고리">
          <NativeSelect value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {ofType.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="메모" grow>
          <Input placeholder="월세, 통신비…" maxLength={200} value={memo} onChange={(e) => setMemo(e.target.value)} className="h-8" />
        </Field>
        <Field label="결제 수단">
          <Input maxLength={30} value={method} onChange={(e) => setMethod(e.target.value)} className="h-8 w-28" />
        </Field>
        <Field label="시작 달">
          <Input type="month" required value={startMonth} onChange={(e) => e.target.value && setStartMonth(e.target.value)} className="h-8 w-36" />
        </Field>
        <Field label="끝 달 (선택)">
          <Input type="month" value={endMonth} onChange={(e) => setEndMonth(e.target.value)} className="h-8 w-36" />
        </Field>
      </div>
      {original && <p className="text-xs text-muted-foreground">고치면 다음 회차부터 반영됩니다. 이미 만든 내역은 그대로입니다.</p>}
      <ErrorAlert error={mut.saveRecurring.error ?? mut.deleteRecurring.error} />
      <div className="flex gap-1">
        <Button type="submit" size="sm" disabled={!amount || !categoryId || mut.saveRecurring.isPending}>
          저장
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          취소
        </Button>
        {original && (
          <ConfirmButton type="button" size="sm" variant="ghost" title="고정 지출을 삭제할까요?" description="이미 만든 내역은 남습니다." confirmLabel="삭제" onConfirm={() => mut.deleteRecurring.mutateAsync(original.id).then(onDone)}>
            삭제
          </ConfirmButton>
        )}
      </div>
    </form>
  );
}

function CategorySection({ categories, readOnly }: { categories: Category[]; readOnly: boolean }) {
  const mut = useLedgerMutations();
  return (
    <section className="grid gap-3">
      <h3 className="text-sm font-medium">카테고리</h3>
      {(["expense", "income"] as const).map((type) => (
        <CategoryList key={type} type={type} list={categories.filter((c) => c.type === type)} readOnly={readOnly} mut={mut} />
      ))}
      <p className="text-xs text-muted-foreground">카테고리를 지워도 내역은 남고 "삭제된 카테고리"로 보입니다.</p>
      <ErrorAlert error={mut.createCategory.error ?? mut.patchCategory.error ?? mut.deleteCategory.error} />
    </section>
  );
}

function CategoryList({ type, list, readOnly, mut }: { type: TxnType; list: Category[]; readOnly: boolean; mut: ReturnType<typeof useLedgerMutations> }) {
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  // 위·아래 이동: 이웃과 order를 맞바꾸지 않고 이웃 너머의 중간값으로 (한 항목만 저장)
  const move = (i: number, dir: -1 | 1) => {
    const others = list.filter((_, j) => j !== i);
    const at = i + dir;
    const before = others[at - 1]?.order;
    const after = others[at]?.order;
    const order = before === undefined ? after! - 1 : after === undefined ? before + 1 : (before + after) / 2;
    const item = list[i];
    if (item) mut.patchCategory.mutate({ id: item.id, order });
  };

  return (
    <div className="grid gap-1">
      <p className="text-xs text-muted-foreground">{type === "expense" ? "지출" : "수입"}</p>
      <ul className="grid gap-1">
        {list.map((c, i) => (
          <li key={c.id} className="flex items-center gap-1 rounded-lg border px-2 py-1">
            {renaming?.id === c.id ? (
              <form
                className="flex flex-1 gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (renaming.name.trim()) mut.patchCategory.mutate({ id: c.id, name: renaming.name.trim() }, { onSuccess: () => setRenaming(null) });
                }}
              >
                <Input autoFocus maxLength={20} value={renaming.name} onChange={(e) => setRenaming({ id: c.id, name: e.target.value })} className="h-7" />
                <Button type="submit" size="xs">
                  저장
                </Button>
              </form>
            ) : (
              <button type="button" disabled={readOnly} className="flex-1 text-left text-sm" onClick={() => setRenaming({ id: c.id, name: c.name })}>
                {c.name}
              </button>
            )}
            {!readOnly && (
              <>
                <Button size="icon-xs" variant="ghost" aria-label="위로" disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUpIcon />
                </Button>
                <Button size="icon-xs" variant="ghost" aria-label="아래로" disabled={i === list.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDownIcon />
                </Button>
                <ConfirmButton size="xs" variant="ghost" disabled={list.length === 1} title="카테고리를 삭제할까요?" description={`"${c.name}" — 이 카테고리의 내역은 남습니다.`} confirmLabel="삭제" onConfirm={() => mut.deleteCategory.mutateAsync(c.id)}>
                  삭제
                </ConfirmButton>
              </>
            )}
          </li>
        ))}
      </ul>
      {!readOnly && (
        <form
          className="flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) mut.createCategory.mutate({ type, name: name.trim() }, { onSuccess: () => setName("") });
          }}
        >
          <Input placeholder="새 카테고리" maxLength={20} value={name} onChange={(e) => setName(e.target.value)} className="h-8" />
          <Button type="submit" size="sm" variant="outline" className="h-8" disabled={!name.trim()}>
            추가
          </Button>
        </form>
      )}
    </div>
  );
}
