import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

// backend/domains/boards.py 와 같은 구조
export type BoardRole = "owner" | "editor" | "viewer";
export type LabelColor = "gray" | "red" | "orange" | "yellow" | "green" | "teal" | "blue" | "purple" | "pink";
export type Label = { id: string; name: string; color: LabelColor };
export type Progress = { done: number; total: number };

export type Board = { id: string; name: string; ownerSub: string; labels: Label[]; createdAt: string };
export type BoardSummary = Board & { role: BoardRole; favorite: boolean; progress: Progress; memberCount: number; activeCount: number };
/** 내 담당 카드 (완료 컬럼·보관 제외, 마감일순) */
export type MyCard = { id: string; title: string; due?: string; priority: Priority; boardId: string; boardName: string; columnName: string };
export type Template = { id: string; name: string; columns: { name: string; done: boolean }[]; labels: Label[]; createdAt: string };
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
  archived?: boolean;
  archivedAt?: string;
};
export type Person = { sub: string; name: string; email: string };
export type Member = Person & { role: BoardRole };
export type BoardDetail = { board: Board; role: BoardRole; favorite: boolean; columns: Column[]; cards: Card[]; archivedCount: number; members: Member[]; progress: Progress };
export type Activity = { actor: string; cardId: string; cardTitle: string; action: string; at: string; from?: string; to?: string };
export type Comment = { id: string; author: string; text: string; createdAt: string };

/** 수정: 보낸 필드만 바뀌고 null은 비운다 */
export type CardPatch = Partial<Omit<Card, "id" | "createdBy" | "createdAt" | "updatedAt" | "assignee" | "due" | "archivedAt">> & { assignee?: string | null; due?: string | null };

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

const TEMPLATE_KEY = ["boardTemplates"];

export function useBoards(enabled = true) {
  return useQuery({ queryKey: LIST_KEY, queryFn: () => api.get<{ boards: BoardSummary[]; myCards: MyCard[] }>("/boards"), enabled });
}

export function useSetFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, favorite }: { id: string; favorite: boolean }) => api.put(`/boards/${id}/favorite`, { favorite }),
    onSettled: (_d, _e, { id }) => {
      void qc.invalidateQueries({ queryKey: LIST_KEY, exact: true });
      void qc.invalidateQueries({ queryKey: boardKey(id), exact: true });
    },
  });
}

export function useTemplates() {
  return useQuery({ queryKey: TEMPLATE_KEY, queryFn: () => api.get<{ templates: Template[] }>("/boards/templates"), select: (d) => d.templates });
}
export function useSaveTemplate() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: { name: string; boardId: string }) => api.post<Template>("/boards/templates", body), onSettled: () => qc.invalidateQueries({ queryKey: TEMPLATE_KEY }) });
}
export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api.del(`/boards/templates/${id}`), onSettled: () => qc.invalidateQueries({ queryKey: TEMPLATE_KEY }) });
}

export function useArchived(boardId: string) {
  return useQuery({ queryKey: [...boardKey(boardId), "archived"], queryFn: () => api.get<{ cards: Card[] }>(`/boards/${boardId}/archived`), select: (d) => d.cards });
}
export function useActivity(boardId: string, cardId?: string) {
  return useQuery({
    queryKey: [...boardKey(boardId), "activity", cardId ?? "all"],
    queryFn: () => api.get<{ activity: Activity[] }>(`/boards/${boardId}/activity${cardId ? `?cardId=${cardId}` : ""}`),
    select: (d) => d.activity,
  });
}

export function useComments(boardId: string, cardId: string) {
  const qc = useQueryClient();
  const key = [...boardKey(boardId), "comments", cardId];
  const base = `/boards/${boardId}/cards/${cardId}/comments`;
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  return {
    list: useQuery({ queryKey: key, queryFn: () => api.get<{ comments: Comment[] }>(base), select: (d) => d.comments, refetchInterval: 30_000 }),
    add: useMutation({ mutationFn: (text: string) => api.post<Comment>(base, { text }), onSettled: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api.del(`${base}/${id}`), onSettled: refresh }),
  };
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
  return useMutation({ mutationFn: (body: { name: string; templateId?: string }) => api.post<Board>("/boards", body), onSettled: () => qc.invalidateQueries({ queryKey: LIST_KEY }) });
}

function useRefreshing<V>(refresh: () => void, fn: (v: V) => Promise<unknown>) {
  return useMutation({ mutationFn: fn, onSettled: refresh });
}

/** 보드 화면의 모든 변경. 카드 이동·수정은 화면에 먼저 반영하고(낙관적 업데이트) 끝나면 다시 불러온다 */
export function useBoardMutations(boardId: string) {
  const qc = useQueryClient();
  const key = boardKey(boardId);
  // 보드 상세·보관함·활동 기록을 함께 다시 불러온다
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
          .filter((c) => !(c.id === id && patch.archived))
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
    archiveDone: useRefreshing(refresh, () => api.post<{ archived: number }>(`${base}/archive-done`)),
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

const PRIORITY_LABEL: Record<string, string> = { high: "높음", normal: "보통", low: "낮음" };

/** 활동 기록 한 줄 (backend boards._changes 의 action) */
export function describeActivity(a: Activity, name: (sub?: string) => string): string {
  switch (a.action) {
    case "created":
      return `카드 생성${a.to ? ` (${a.to})` : ""}`;
    case "moved":
      return `${a.from} → ${a.to} 이동`;
    case "renamed":
      return `제목 변경 (이전: ${a.from})`;
    case "assigned":
      return a.to ? `담당자 ${name(a.to)}` : "담당자 해제";
    case "due":
      return a.to ? `마감일 ${a.to}` : "마감일 해제";
    case "priority":
      return `우선순위 ${PRIORITY_LABEL[a.to ?? "normal"]}`;
    case "labels":
      return "라벨 변경";
    case "description":
      return "설명 수정";
    case "links":
      return "링크 변경";
    case "checklist":
      return `체크리스트 ${a.to}`;
    case "archived":
      return "보관";
    case "restored":
      return "복구";
    case "deleted":
      return "삭제";
    default:
      return a.action;
  }
}

const KST_TIME = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
/** ISO 시각 → "10. 2. 14:05" (KST) */
export const formatTime = (iso: string) => KST_TIME.format(new Date(iso));
