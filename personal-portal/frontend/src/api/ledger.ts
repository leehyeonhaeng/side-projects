import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

// backend/domains/ledger.py 와 같은 구조
export type TxnType = "income" | "expense";
export type Txn = { id: string; date: string; type: TxnType; amount: number; categoryId: string; method: string; memo: string; recurId?: string };
export type TxnInput = Omit<Txn, "id" | "recurId">;
export type Category = { id: string; type: TxnType; name: string; order: number };
export type Recurring = { id: string; type: TxnType; amount: number; categoryId: string; method: string; memo: string; day: number; startMonth: string; endMonth?: string; lastMonth?: string };
export type RecurringInput = Omit<Recurring, "id" | "lastMonth" | "endMonth"> & { endMonth?: string | null };
export type Budget = { month: string; from: string | null; amounts: Record<string, number> };
export type MonthTotal = { month: string; income: number; expense: number };

const invalidateAll = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ queryKey: ["ledger"] });

export function useTxns(month: string) {
  return useQuery({ queryKey: ["ledger", "txns", month], queryFn: () => api.get<{ txns: Txn[] }>(`/txns?month=${month}`), select: (d) => d.txns });
}
export function useTxnRange(from: string, to: string, enabled: boolean) {
  return useQuery({ queryKey: ["ledger", "range", from, to], queryFn: () => api.get<{ txns: Txn[] }>(`/txns?from=${from}&to=${to}`), select: (d) => d.txns, enabled });
}
export function useTxnSummary(months = 6) {
  return useQuery({ queryKey: ["ledger", "summary", months], queryFn: () => api.get<{ months: MonthTotal[]; methods: string[] }>(`/txns/summary?months=${months}`) });
}
export function useTxnSearch(q: string) {
  return useQuery({ queryKey: ["ledger", "search", q], queryFn: () => api.get<{ txns: Txn[] }>(`/txns/search?q=${encodeURIComponent(q)}`), select: (d) => d.txns, enabled: q.length > 0 });
}
export function useCategories(enabled = true) {
  return useQuery({ queryKey: ["ledger", "categories"], queryFn: () => api.get<{ categories: Category[] }>("/categories"), select: (d) => d.categories, enabled, staleTime: 60_000 });
}
export function useBudget(month: string, enabled = true) {
  return useQuery({ queryKey: ["ledger", "budget", month], queryFn: () => api.get<Budget>(`/budgets/${month}`), enabled });
}
export function useRecurring() {
  return useQuery({ queryKey: ["ledger", "recurring"], queryFn: () => api.get<{ recurring: Recurring[] }>("/recurring"), select: (d) => d.recurring });
}

export function useLedgerMutations() {
  const qc = useQueryClient();
  const settled = () => void invalidateAll(qc);
  return {
    saveTxn: useMutation({
      mutationFn: ({ original, input }: { original?: Txn; input: TxnInput }) =>
        original ? api.put<Txn>(`/txns/${original.id}?date=${original.date}`, input) : api.post<Txn>("/txns", input),
      onSettled: settled,
    }),
    deleteTxn: useMutation({ mutationFn: (t: Txn) => api.del(`/txns/${t.id}?date=${t.date}`), onSettled: settled }),
    createCategory: useMutation({ mutationFn: (body: { type: TxnType; name: string }) => api.post<Category>("/categories", body), onSettled: settled }),
    patchCategory: useMutation({ mutationFn: ({ id, ...body }: { id: string; name?: string; order?: number }) => api.patch<Category>(`/categories/${id}`, body), onSettled: settled }),
    deleteCategory: useMutation({ mutationFn: (id: string) => api.del(`/categories/${id}`), onSettled: settled }),
    saveRecurring: useMutation({
      mutationFn: ({ id, input }: { id?: string; input: RecurringInput }) => (id ? api.put<Recurring>(`/recurring/${id}`, input) : api.post<Recurring>("/recurring", input)),
      onSettled: settled,
    }),
    deleteRecurring: useMutation({ mutationFn: (id: string) => api.del(`/recurring/${id}`), onSettled: settled }),
    putBudget: useMutation({ mutationFn: ({ month, amounts }: { month: string; amounts: Record<string, number> }) => api.put<Budget>(`/budgets/${month}`, { amounts }), onSettled: settled }),
  };
}

/** 가계부를 열 때 빠진 고정 지출 회차를 만든다 (DESIGN.md 6.8 구현 결정) */
export function useApplyRecurring() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ created: Txn[] }>("/recurring/apply"),
    onSuccess: (d) => d.created.length > 0 && void invalidateAll(qc),
  });
}

// ── 계산·표시 ────────────────────────────────────────

export const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

export const monthOf = (day: string) => day.slice(0, 7);
export function addMonths(month: string, n: number): string {
  const total = Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1 + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}
export const monthLabel = (month: string) => `${month.slice(0, 4)}년 ${Number(month.slice(5))}월`;

export function totals(txns: Txn[]) {
  const income = txns.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const expense = txns.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  return { income, expense, balance: income - expense };
}

/** 카테고리별 지출 합 (큰 순) */
export function expenseByCategory(txns: Txn[]): { categoryId: string; amount: number }[] {
  const map = new Map<string, number>();
  for (const t of txns) if (t.type === "expense") map.set(t.categoryId, (map.get(t.categoryId) ?? 0) + t.amount);
  return [...map].map(([categoryId, amount]) => ({ categoryId, amount })).sort((a, b) => b.amount - a.amount);
}

// 차트 색 (카테고리 순서대로 돌려 쓴다)
export const CHART_COLORS = ["#f97316", "#3b82f6", "#22c55e", "#eab308", "#a855f7", "#ec4899", "#14b8a6", "#ef4444", "#6366f1", "#84cc16", "#64748b"];
export function categoryColor(categories: Category[], id: string): string {
  const i = categories.filter((c) => c.type === "expense").findIndex((c) => c.id === id);
  return i < 0 ? "#94a3b8" : (CHART_COLORS[i % CHART_COLORS.length] ?? "#94a3b8");
}

/** 엑셀에서 한글이 깨지지 않게 UTF-8 BOM을 붙인 CSV 다운로드 */
export function downloadCsv(filename: string, txns: Txn[], categories: Category[]) {
  const name = (id: string) => categories.find((c) => c.id === id)?.name ?? "(삭제된 카테고리)";
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const rows = [
    ["날짜", "구분", "카테고리", "금액", "결제 수단", "메모"],
    ...[...txns].sort((a, b) => a.date.localeCompare(b.date)).map((t) => [t.date, t.type === "income" ? "수입" : "지출", name(t.categoryId), t.amount, t.method, t.memo]),
  ];
  const blob = new Blob(["﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** 빠른 추가 "점심 12000", "12,000 커피" → 메모 + 금액 */
export function parseQuickExpense(text: string): { memo: string; amount: number } | null {
  const m = text.match(/(\d[\d,]*)\s*(원)?/);
  if (!m) return null;
  const amount = Number((m[1] ?? "").replaceAll(",", ""));
  if (!amount) return null;
  const memo = text.replace(m[0], " ").replace(/\s+/g, " ").trim();
  return { memo, amount };
}
