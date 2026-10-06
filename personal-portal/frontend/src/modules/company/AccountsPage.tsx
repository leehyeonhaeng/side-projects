import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { ACCOUNT_KIND_LABEL, type Account, type AccountKind, useAccounts, useMasterMutations } from "@/api/company";
import { NativeSelect } from "@/components/NativeSelect";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useCompanyOutlet } from "./CompanyLayout";
import { Field, PageHead, money } from "./ui";

/** 계좌 (현금·통장·카드): 입금·지급·경비가 어느 돈에서 나가고 들어오는지. 잔액은 거래(C3)로 바뀐다 */
export function AccountsPage() {
  const { cid, detail } = useCompanyOutlet();
  const canEdit = detail.me.perms.money === "edit" && detail.me.showAmounts;
  const accounts = useAccounts(cid);
  const [editing, setEditing] = useState<Account | "new" | null>(null);
  const total = (accounts.data ?? []).filter((a) => a.active && a.kind !== "card").reduce((s, a) => s + (a.balance ?? 0), 0);

  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 md:p-6">
      <PageHead
        title="계좌"
        sub={accounts.data && detail.me.showAmounts ? `현금·은행 합계 ${money(total)}` : undefined}
        action={
          canEdit && (
            <Button onClick={() => setEditing("new")}>
              <PlusIcon /> 계좌 추가
            </Button>
          )
        }
      />
      {accounts.isPending ? (
        <InlineSpinner />
      ) : accounts.isError ? (
        <ErrorAlert error={accounts.error} />
      ) : accounts.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">입금을 받거나 돈을 내보내는 통장·현금을 등록하세요. 지금 잔액을 '기초 잔액'으로 넣으면 이후 거래로 자동 계산됩니다.</p>
      ) : (
        <ul className="grid gap-2">
          {accounts.data.map((a) => (
            <li key={a.id}>
              <button type="button" disabled={!canEdit} onClick={() => setEditing(a)} className={cn("flex w-full items-center gap-3 rounded-2xl border bg-card p-4 text-left enabled:hover:bg-muted/50", !a.active && "opacity-60")}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{a.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{[ACCOUNT_KIND_LABEL[a.kind], a.bank, a.number, a.holder].filter(Boolean).join(" · ")}{!a.active && " · 사용 안 함"}</span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">{money(a.balance)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && <AccountDialog key={editing === "new" ? "new" : editing.id} cid={cid} account={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </main>
  );
}

function AccountDialog({ cid, account, onClose }: { cid: string; account: Account | null; onClose: () => void }) {
  const [f, setF] = useState({ name: account?.name ?? "", kind: account?.kind ?? ("bank" as AccountKind), bank: account?.bank ?? "", number: account?.number ?? "", holder: account?.holder ?? "", memo: account?.memo ?? "", opening: "" });
  const mut = useMasterMutations(cid);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const body = { name: f.name.trim(), kind: f.kind, bank: f.bank.trim(), number: f.number.trim(), holder: f.holder.trim(), memo: f.memo.trim() };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{account ? "계좌 수정" : "계좌 추가"}</DialogTitle>
        </DialogHeader>
        <form
          id="account-form"
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (account) mut.patchAccount.mutate({ id: account.id, ...body }, { onSuccess: onClose });
            else mut.createAccount.mutate({ ...body, openingBalance: Number(f.opening.replace(/,/g, "")) || 0 }, { onSuccess: onClose });
          }}
        >
          <Field label="이름 *" wide>
            <Input autoFocus required maxLength={40} placeholder="국민 주거래, 현금 시재" value={f.name} onChange={set("name")} />
          </Field>
          <Field label="종류">
            <NativeSelect value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as AccountKind })} className="h-9">
              {(Object.keys(ACCOUNT_KIND_LABEL) as AccountKind[]).map((k) => (
                <option key={k} value={k}>
                  {ACCOUNT_KIND_LABEL[k]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="은행·카드사">
            <Input maxLength={30} value={f.bank} onChange={set("bank")} />
          </Field>
          <Field label="번호">
            <Input maxLength={40} value={f.number} onChange={set("number")} />
          </Field>
          <Field label="예금주">
            <Input maxLength={30} value={f.holder} onChange={set("holder")} />
          </Field>
          {!account && (
            <Field label="기초 잔액 (원)" hint="지금 잔액. 이후 입금·지급으로 자동 계산">
              <Input inputMode="numeric" value={f.opening} onChange={set("opening")} />
            </Field>
          )}
          <Field label="메모" wide>
            <Input maxLength={300} value={f.memo} onChange={set("memo")} />
          </Field>
        </form>
        <ErrorAlert error={mut.createAccount.error ?? mut.patchAccount.error} />
        <DialogFooter className="flex-row items-center">
          {account && (
            <Button type="button" variant="ghost" className="mr-auto" onClick={() => mut.patchAccount.mutate({ id: account.id, active: !account.active }, { onSuccess: onClose })}>
              {account.active ? "사용 안 함" : "다시 사용"}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" form="account-form" disabled={!f.name.trim() || mut.createAccount.isPending || mut.patchAccount.isPending}>
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
