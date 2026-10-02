import { useState } from "react";
import { useNavigate } from "react-router";
import { useMe } from "@/api/me";
import { parseQuickExpense, useCategories, useLedgerMutations, won } from "@/api/ledger";
import { useNoteMutations } from "@/api/notes";
import { NativeSelect } from "@/components/NativeSelect";
import { useCreateTodo } from "@/api/todos";
import { ErrorAlert } from "@/components/states";
import { todayStr } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ModuleId } from "@/modules/meta";

type Kind = { id: string; label: string; module: ModuleId; placeholder: string };

// DESIGN.md 5장: 어느 화면에서든 할 일·식단·지출·메모를 바로 입력
const KINDS: Kind[] = [
  { id: "todo", label: "할 일", module: "todo", placeholder: "할 일 제목 (엔터로 오늘 추가)" },
  { id: "meal", label: "식단", module: "health", placeholder: "예: 현미밥 200g, 닭가슴살 150g" },
  { id: "expense", label: "지출", module: "ledger", placeholder: "예: 점심 12000" },
  { id: "note", label: "메모", module: "notes", placeholder: "빠른 메모" },
];

/** 빠른 추가: 할 일(오늘), 식단(AI 계산 화면으로), 지출(오늘), 메모 */
export function QuickAddDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const me = useMe();
  const kinds = KINDS.filter((k) => me.data?.perms[k.module] === "edit");
  const [kindId, setKindId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const createTodo = useCreateTodo();
  const createNote = useNoteMutations().create;
  const saveTxn = useLedgerMutations().saveTxn;
  const canLedger = me.data?.perms.ledger === "edit";
  const categories = useCategories(open && canLedger);
  const expenseCats = categories.data?.filter((c) => c.type === "expense") ?? [];
  const [categoryId, setCategoryId] = useState("");
  const expense = parseQuickExpense(text);
  const navigate = useNavigate();
  const kind = kinds.find((k) => k.id === kindId) ?? kinds[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>빠른 추가</DialogTitle>
          <DialogDescription>{kind ? "입력할 종류를 고르세요." : "편집 권한이 있는 모듈이 없습니다."}</DialogDescription>
        </DialogHeader>
        {kind && (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const value = text.trim();
              if (!value) return;
              if (kind.id === "meal") {
                // 식단은 AI 추정 → 확인 카드에서 고친 뒤 저장 (DESIGN.md 6.3) → 식단 화면으로 넘긴다
                onOpenChange(false);
                setText("");
                navigate(`/health?draft=${encodeURIComponent(value)}`);
                return;
              }
              if (kind.id === "expense") {
                const cat = categoryId || expenseCats[0]?.id;
                if (!expense || !cat) return;
                saveTxn.mutate(
                  { input: { date: todayStr(), type: "expense", amount: expense.amount, categoryId: cat, method: "", memo: expense.memo } },
                  { onSuccess: () => (setText(""), setSaved(`가계부에 저장했습니다: ${expense.memo || "지출"} ${won(expense.amount)}`)) },
                );
                return;
              }
              if (kind.id === "note") {
                createNote.mutate({ body: value }, { onSuccess: () => (setText(""), setSaved("메모에 저장했습니다.")) });
                return;
              }
              if (kind.id !== "todo") return;
              createTodo.mutate(
                { title: value, due: todayStr() },
                {
                  onSuccess: () => {
                    setText("");
                    setSaved(`할 일에 추가했습니다: ${value}`);
                  },
                },
              );
            }}
          >
            <div className="flex flex-wrap gap-1">
              {kinds.map((k) => (
                <Button key={k.id} type="button" size="sm" variant={k.id === kind.id ? "default" : "outline"} onClick={() => (setKindId(k.id), setSaved(null))}>
                  {k.label}
                </Button>
              ))}
            </div>
            <Input aria-label={`${kind.label} 입력`} placeholder={kind.placeholder} value={text} onChange={(e) => setText(e.target.value)} />
            {kind.id === "todo" ? (
              <Button type="submit" disabled={!text.trim() || createTodo.isPending}>
                오늘 할 일로 추가
              </Button>
            ) : kind.id === "meal" ? (
              <Button type="submit" disabled={!text.trim()}>
                식단 화면에서 AI 계산
              </Button>
            ) : kind.id === "expense" ? (
              <div className="flex gap-1">
                <NativeSelect aria-label="카테고리" value={categoryId || expenseCats[0]?.id || ""} onChange={(e) => setCategoryId(e.target.value)} className="h-9">
                  {expenseCats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
                <Button type="submit" className="h-9 flex-1" disabled={!expense || !expenseCats.length || saveTxn.isPending}>
                  {expense ? `오늘 지출 ${won(expense.amount)} 저장` : "금액을 입력하세요"}
                </Button>
              </div>
            ) : (
              <Button type="submit" disabled={!text.trim() || createNote.isPending}>
                메모 저장
              </Button>
            )}
            {saved && <p className="text-xs text-muted-foreground">{saved}</p>}
            <ErrorAlert error={createTodo.error ?? createNote.error ?? saveTxn.error ?? categories.error} />
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
