import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

// backend/domains/todos.py 와 같은 구조
export type Priority = "high" | "normal" | "low";
export type TodoRepeat =
  | { freq: "daily" | "weekdays" }
  | { freq: "weekly"; weekdays: number[] }
  | { freq: "monthly"; monthDay?: number };
export type Subtask = { id: string; text: string; done: boolean };

export type Todo = {
  id: string;
  title: string;
  note: string;
  due?: string;
  dueTime?: string;
  priority: Priority;
  listId?: string;
  repeat?: TodoRepeat;
  subtasks: Subtask[];
  order: number;
  done: boolean;
  doneAt?: string;
  createdAt: string;
};

export type TodoList = { id: string; name: string; order: number };

/** 반복 할 일의 앞으로 회차 미리보기 (완료해야 실제로 생긴다, 서버가 계산) */
export type ProjectedTodo = { todoId: string; title: string; due: string; dueTime?: string | null; priority: Priority };

/** 생성·수정 입력. 수정에서 null은 그 필드를 비운다 */
export type TodoInput = Partial<{
  title: string;
  note: string;
  due: string | null;
  dueTime: string | null;
  priority: Priority;
  listId: string | null;
  repeat: TodoRepeat | null;
  subtasks: Subtask[];
  order: number;
  done: boolean;
}>;

const KEY = ["todos"] as const;

export function useTodos(status: "open" | "done") {
  return useQuery({
    queryKey: [...KEY, status],
    queryFn: () => api.get<{ todos: Todo[] }>(`/todos?status=${status}`),
    select: (d) => d.todos,
  });
}

export function useDueTodos(from: string, to: string, enabled: boolean) {
  return useQuery({
    queryKey: [...KEY, "due", from, to],
    queryFn: () => api.get<{ todos: Todo[]; projected: ProjectedTodo[] }>(`/todos/due?from=${from}&to=${to}`),
    enabled,
  });
}

export function useTodoLists() {
  return useQuery({
    queryKey: ["todo-lists"],
    queryFn: () => api.get<{ lists: TodoList[] }>("/todo-lists"),
    select: (d) => d.lists,
  });
}

function useTodoMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export const useCreateTodo = () => useTodoMutation((input: TodoInput & { title: string }) => api.post<Todo>("/todos", input));

export const useUpdateTodo = () =>
  useTodoMutation(({ id, ...input }: TodoInput & { id: string }) => api.patch<{ todo: Todo; next: Todo | null }>(`/todos/${id}`, input));

export const useDeleteTodo = () => useTodoMutation((id: string) => api.del(`/todos/${id}`));

function useListMutation<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["todo-lists"] });
      void qc.invalidateQueries({ queryKey: KEY });
    },
  });
}

export const useCreateList = () => useListMutation((name: string) => api.post<TodoList>("/todo-lists", { name }));
export const useRenameList = () => useListMutation(({ id, name }: { id: string; name: string }) => api.patch(`/todo-lists/${id}`, { name }));
export const useDeleteList = () => useListMutation((id: string) => api.del(`/todo-lists/${id}`));
