import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

// backend/domains/boards.py 와 같은 구조
export type BoardRole = "owner" | "editor" | "viewer";
export type LabelColor = "gray" | "red" | "orange" | "yellow" | "green" | "teal" | "blue" | "purple" | "pink";
export type Label = { id: string; name: string; color: LabelColor };
export type Progress = { done: number; total: number };

export type Board = { id: string; name: string; ownerSub: string; labels: Label[]; createdAt: string };
export type BoardSummary = Board & { role: BoardRole; progress: Progress; memberCount: number };
export type Column = { id: string; name: string; order: number; done: boolean };
export type Priority = "high" | "normal" | "low";
export type CheckItem = { id: string; text: string; done: boolean };
export type CardLink = { title: string; url: string };
export type Card = {
  id: string;
  columnId: string;
  order: number;
  title: string;
  description: string;
  assignee?: string;
  due?: string;
  priority: Priority;
  labels: string[];
  checklist: CheckItem[];
  links: CardLink[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};
export type Person = { sub: string; name: string; email: string };
export type Member = Person & { role: BoardRole };
export type BoardDetail = { board: Board; role: BoardRole; columns: Column[]; cards: Card[]; members: Member[]; progress: Progress };

/** 수정: 보낸 필드만 바뀌고 null은 비운다 */
export type CardPatch = Partial<Omit<Card, "id" | "createdBy" | "createdAt" | "updatedAt" | "assignee" | "due">> & { assignee?: string | null; due?: string | null };

export const LABEL_COLORS: { value: LabelColor; className: string }[] = [
  { value: "gray", className: "bg-zinc-500" },
  { value: "red", className: "bg-red-500" },
  { value: "orange", className: "bg-orange-500" },
  { value: "yellow", className: "bg-yellow-500" },
  { value: "green", className: "bg-green-600" },
  { value: "teal", className: "bg-teal-500" },
  { value: "blue", className: "bg-blue-500" },
  { value: "purple", className: "bg-purple-500" },
  { value: "pink", className: "bg-pink-500" },
];
export const labelClass = (color: LabelColor) => LABEL_COLORS.find((c) => c.value === color)?.className ?? "bg-zinc-500";

const LIST_KEY = ["boards"];
const boardKey = (id: string) => ["boards", id];

export function useBoards() {
  return useQuery({ queryKey: LIST_KEY, queryFn: () => api.get<{ boards: BoardSummary[] }>("/boards"), select: (d) => d.boards });
}

/** 다른 멤버의 변경은 창 복귀 시 + 보드가 열려 있는 동안 30초마다 반영 (DESIGN.md 6.6 구현 결정) */
export function useBoard(id: string) {
  return useQuery({
    queryKey: boardKey(id),
    queryFn: () => api.get<BoardDetail>(`/boards/${id}`),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: (count, err) => !(err instanceof Error && "status" in err && (err.status === 404 || err.status === 403)) && count < 2,
  });
}

export function useCandidates(boardId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["boards", boardId, "candidates"],
    queryFn: () => api.get<{ candidates: Person[] }>(`/boards/${boardId}/candidates`),
    select: (d) => d.candidates,
    enabled,
  });
}

export function useCreateBoard() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (name: string) => api.post<Board>("/boards", { name }), onSettled: () => qc.invalidateQueries({ queryKey: LIST_KEY }) });
}

function useRefreshing<V>(refresh: () => void, fn: (v: V) => Promise<unknown>) {
  return useMutation({ mutationFn: fn, onSettled: refresh });
}

/** 보드 화면의 모든 변경. 카드 이동·수정은 화면에 먼저 반영하고(낙관적 업데이트) 끝나면 다시 불러온다 */
export function useBoardMutations(boardId: string) {
  const qc = useQueryClient();
  const key = boardKey(boardId);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: LIST_KEY, exact: true });
  };
  const base = `/boards/${boardId}`;

  const patchCard = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: CardPatch }) => api.patch<Card>(`${base}/cards/${id}`, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<BoardDetail>(key);
      if (prev) {
        const cards = prev.cards
          .map((c) => {
            if (c.id !== id) return c;
            const next: Card = { ...c, ...(patch as Partial<Card>) };
            if (patch.assignee === null) delete next.assignee;
            if (patch.due === null) delete next.due;
            return next;
          })
          .sort((a, b) => a.order - b.order);
        qc.setQueryData<BoardDetail>(key, { ...prev, cards });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(key, ctx.prev),
    onSettled: refresh,
  });

  return {
    patchBoard: useRefreshing(refresh, (body: { name?: string; labels?: Label[] }) => api.patch<Board>(base, body)),
    deleteBoard: useMutation({ mutationFn: () => api.del(base), onSuccess: () => qc.removeQueries({ queryKey: key }), onSettled: () => qc.invalidateQueries({ queryKey: LIST_KEY }) }),
    addMember: useRefreshing(refresh, (body: { sub: string; role: "editor" | "viewer" }) => api.post<Member>(`${base}/members`, body)),
    patchMember: useRefreshing(refresh, ({ sub, role }: { sub: string; role: "editor" | "viewer" }) => api.patch(`${base}/members/${sub}`, { role })),
    removeMember: useRefreshing(refresh, (sub: string) => api.del(`${base}/members/${sub}`)),
    createColumn: useRefreshing(refresh, (body: { name: string; done?: boolean }) => api.post<Column>(`${base}/columns`, body)),
    patchColumn: useRefreshing(refresh, ({ id, ...body }: { id: string; name?: string; order?: number; done?: boolean }) => api.patch<Column>(`${base}/columns/${id}`, body)),
    deleteColumn: useRefreshing(refresh, (id: string) => api.del(`${base}/columns/${id}`)),
    createCard: useRefreshing(refresh, (body: CardPatch & { title: string; columnId: string }) => api.post<Card>(`${base}/cards`, body)),
    patchCard,
    deleteCard: useRefreshing(refresh, (id: string) => api.del(`${base}/cards/${id}`)),
  };
}

/** 정렬된 목록에서 index 위치에 넣을 순서 값 (앞뒤 값의 중간) */
export function orderAt(sorted: { order: number }[], index: number): number {
  const before = sorted[index - 1]?.order;
  const after = sorted[index]?.order;
  if (before === undefined && after === undefined) return 1;
  if (before === undefined) return after! - 1;
  if (after === undefined) return before + 1;
  return (before + after) / 2;
}
