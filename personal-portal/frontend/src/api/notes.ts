import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

// backend/domains/notes.py 와 같은 구조
export type Note = { id: string; title: string; body: string; tags: string[]; pinned: boolean; createdAt: string; updatedAt: string; deletedAt?: string };
export type NoteInput = Partial<Pick<Note, "title" | "body" | "tags" | "pinned">>;

const KEY = ["notes"];
export const TRASH_DAYS = 30;

export function useNotes(trash = false) {
  return useQuery({ queryKey: [...KEY, trash ? "trash" : "list"], queryFn: () => api.get<{ notes: Note[] }>(`/notes${trash ? "?trash=true" : ""}`), select: (d) => d.notes });
}

/** 편집할 메모: 열 때마다 새로 받고(gcTime 0), 편집 중에는 다시 불러오지 않는다 */
export function useNote(id: string | undefined) {
  return useQuery({ queryKey: [...KEY, "one", id], queryFn: () => api.get<Note>(`/notes/${id}`), enabled: !!id, staleTime: Infinity, gcTime: 0 });
}

export function useNoteMutations() {
  const qc = useQueryClient();
  // 편집 중인 메모(one)는 다시 불러오지 않는다 (입력 중인 내용을 덮어쓰지 않게)
  const refresh = () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "notes" && q.queryKey[1] !== "one" });
  return {
    create: useMutation({ mutationFn: (input: NoteInput) => api.post<Note>("/notes", input), onSettled: refresh }),
    patch: useMutation({ mutationFn: ({ id, ...input }: NoteInput & { id: string }) => api.patch<Note>(`/notes/${id}`, input), onSettled: refresh }),
    trash: useMutation({ mutationFn: (id: string) => api.del(`/notes/${id}`), onSettled: refresh }),
    restore: useMutation({ mutationFn: (id: string) => api.post<Note>(`/notes/${id}/restore`), onSettled: refresh }),
    destroy: useMutation({ mutationFn: (id: string) => api.del(`/notes/${id}?permanent=true`), onSettled: refresh }),
  };
}

/** 제목이 없으면 본문 첫 줄 (마크다운 기호 제거) */
export function noteTitle(n: Pick<Note, "title" | "body">): string {
  if (n.title.trim()) return n.title.trim();
  const line = n.body.split("\n").find((l) => l.trim()) ?? "";
  return line.replace(/^[#>\-*\s]+/, "").slice(0, 80) || "(빈 메모)";
}

/** 목록 미리보기: 제목으로 쓴 첫 줄을 빼고 나머지 본문 앞부분 */
export function notePreview(n: Pick<Note, "title" | "body">): string {
  const lines = n.body.split("\n").filter((l) => l.trim());
  return (n.title.trim() ? lines : lines.slice(1)).join(" ").replace(/[#*`>]/g, "").slice(0, 120);
}
