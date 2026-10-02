import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Member, Person } from "./boards";
import { api } from "./client";

// backend/domains/checklists.py 와 같은 구조
export type ListRole = "owner" | "editor" | "viewer";
export type Checklist = { id: string; name: string; icon: string; ownerSub: string; createdAt: string };
export type ChecklistSummary = Checklist & { role: ListRole; favorite: boolean; remaining: number; total: number; memberCount: number };
export type ListItem = { id: string; text: string; done: boolean; doneBy?: string; doneAt?: string; order: number; createdAt: string };
export type ChecklistDetail = { list: Checklist; role: ListRole; favorite: boolean; items: ListItem[]; members: Member[] };
export type ListTemplate = { id: string; name: string; icon: string; items: string[]; createdAt: string };

// 리스트 아이콘 (DESIGN.md 6.10 구현 결정: 정해진 이모지 중 선택)
export const LIST_ICONS = ["📝", "🛒", "🏠", "✈️", "🧳", "🎁", "💊", "🍳", "🥦", "🧺", "🧹", "📦", "🐶", "👶", "🎉", "📚", "💼", "🔧", "🏕️", "✅"];

const LIST_KEY = ["checklists"];
const listKey = (id: string) => ["checklists", id];
const TEMPLATE_KEY = ["checklistTemplates"];

export function useChecklists(enabled = true) {
  return useQuery({ queryKey: LIST_KEY, queryFn: () => api.get<{ lists: ChecklistSummary[] }>("/checklists"), select: (d) => d.lists, enabled });
}

/** 다른 사람이 체크한 것: 창 복귀 시 + 화면이 열려 있는 동안 30초마다 + 새로고침 버튼 (DESIGN.md 6.10 구현 결정) */
export function useChecklist(id: string | undefined) {
  return useQuery({
    queryKey: listKey(id ?? ""),
    queryFn: () => api.get<ChecklistDetail>(`/checklists/${id}`),
    enabled: !!id,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: (count, err) => !(err instanceof Error && "status" in err && (err.status === 404 || err.status === 403)) && count < 2,
  });
}

export function useListCandidates(id: string, enabled: boolean) {
  return useQuery({ queryKey: [...listKey(id), "candidates"], queryFn: () => api.get<{ candidates: Person[] }>(`/checklists/${id}/candidates`), select: (d) => d.candidates, enabled });
}

export function useListTemplates() {
  return useQuery({ queryKey: TEMPLATE_KEY, queryFn: () => api.get<{ templates: ListTemplate[] }>("/checklists/templates"), select: (d) => d.templates });
}

export function useChecklistActions() {
  const qc = useQueryClient();
  return {
    create: useMutation({
      mutationFn: (body: { name: string; icon: string; templateId?: string }) => api.post<Checklist>("/checklists", body),
      onSettled: () => qc.invalidateQueries({ queryKey: LIST_KEY, exact: true }),
    }),
    saveTemplate: useMutation({ mutationFn: (body: { name: string; listId: string }) => api.post<ListTemplate>("/checklists/templates", body), onSettled: () => qc.invalidateQueries({ queryKey: TEMPLATE_KEY }) }),
    deleteTemplate: useMutation({ mutationFn: (id: string) => api.del(`/checklists/templates/${id}`), onSettled: () => qc.invalidateQueries({ queryKey: TEMPLATE_KEY }) }),
    setFavorite: useMutation({
      mutationFn: ({ id, favorite }: { id: string; favorite: boolean }) => api.put(`/checklists/${id}/favorite`, { favorite }),
      onSettled: (_d, _e, { id }) => {
        void qc.invalidateQueries({ queryKey: LIST_KEY, exact: true });
        void qc.invalidateQueries({ queryKey: listKey(id), exact: true });
      },
    }),
  };
}

/** 리스트 화면의 변경. 체크는 화면에 먼저 반영(낙관적 업데이트) */
export function useListMutations(id: string) {
  const qc = useQueryClient();
  const key = listKey(id);
  const base = `/checklists/${id}`;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: LIST_KEY, exact: true });
  };
  const m = <V,>(fn: (v: V) => Promise<unknown>) => ({ mutationFn: fn, onSettled: refresh });

  return {
    patchList: useMutation(m((body: { name?: string; icon?: string }) => api.patch<Checklist>(base, body))),
    deleteList: useMutation({ mutationFn: () => api.del(base), onSuccess: () => qc.removeQueries({ queryKey: key }), onSettled: () => qc.invalidateQueries({ queryKey: LIST_KEY, exact: true }) }),
    addItems: useMutation(m((texts: string[]) => api.post<{ items: ListItem[] }>(`${base}/items`, { texts }))),
    patchItem: useMutation({
      mutationFn: ({ iid, ...body }: { iid: string; text?: string; done?: boolean }) => api.patch<ListItem>(`${base}/items/${iid}`, body),
      onMutate: async ({ iid, ...body }) => {
        await qc.cancelQueries({ queryKey: key });
        const prev = qc.getQueryData<ChecklistDetail>(key);
        if (prev) qc.setQueryData<ChecklistDetail>(key, { ...prev, items: prev.items.map((i) => (i.id === iid ? { ...i, ...body } : i)) });
        return { prev };
      },
      onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(key, ctx.prev),
      onSettled: refresh,
    }),
    deleteItem: useMutation(m((iid: string) => api.del(`${base}/items/${iid}`))),
    clearDone: useMutation(m(() => api.post<{ deleted: number }>(`${base}/clear-done`))),
    uncheckAll: useMutation(m(() => api.post<{ unchecked: number }>(`${base}/uncheck-all`))),
    addMember: useMutation(m((body: { sub: string; role: "editor" | "viewer" }) => api.post<Member>(`${base}/members`, body))),
    patchMember: useMutation(m(({ sub, role }: { sub: string; role: "editor" | "viewer" }) => api.patch(`${base}/members/${sub}`, { role }))),
    removeMember: useMutation(m((sub: string) => api.del(`${base}/members/${sub}`))),
  };
}

/** 체크 안 한 항목(추가순) 다음에 체크한 항목 */
export const sortItems = (items: ListItem[]) => [...items.filter((i) => !i.done), ...items.filter((i) => i.done)];
