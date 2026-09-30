import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Level, ModuleId } from "@/modules/meta";
import { api } from "./client";

export type UserStatus = "pending" | "active" | "suspended";

export type AdminUser = {
  sub: string;
  email: string;
  name: string;
  signupNote: string;
  status: UserStatus;
  role: "host" | "member";
  createdAt: string;
};

export type Perms = Record<ModuleId, Level>;
export type Preset = { id: string; name: string; perms: Perms };
export type MatrixRow = AdminUser & { perms: Perms };
export type AuditLog = {
  at: string;
  action: string;
  actor: string;
  actorEmail: string;
  target: string;
  detail: Record<string, unknown>;
};

const KEY = ["admin"] as const;

export function useAdminUsers(status?: UserStatus) {
  return useQuery({
    queryKey: [...KEY, "users", status ?? "all"],
    queryFn: () => api.get<{ users: AdminUser[] }>(`/admin/users${status ? `?status=${status}` : ""}`),
    select: (d) => d.users,
  });
}

export function usePresets() {
  return useQuery({
    queryKey: [...KEY, "presets"],
    queryFn: () => api.get<{ presets: Preset[] }>("/admin/presets"),
    select: (d) => d.presets,
  });
}

export function usePermissionMatrix() {
  return useQuery({
    queryKey: [...KEY, "permissions"],
    queryFn: () => api.get<{ users: MatrixRow[] }>("/admin/permissions"),
    select: (d) => d.users,
  });
}

export function useAudit(month: string) {
  return useQuery({
    queryKey: [...KEY, "audit", month],
    queryFn: () => api.get<{ logs: AuditLog[] }>(`/admin/audit?month=${month}`),
    select: (d) => d.logs,
  });
}

/** 관리자 변경 작업. 성공하면 관리자 화면 데이터를 모두 새로 받는다. */
function useAdminMutation<V>(fn: (vars: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export const useApprove = () =>
  useAdminMutation(({ sub, presetId }: { sub: string; presetId: string }) => api.post(`/admin/users/${sub}/approve`, { presetId }));
export const useReject = () => useAdminMutation((sub: string) => api.post(`/admin/users/${sub}/reject`));
export const useSuspend = () => useAdminMutation((sub: string) => api.post(`/admin/users/${sub}/suspend`));
export const useReactivate = () => useAdminMutation((sub: string) => api.post(`/admin/users/${sub}/reactivate`));
export const useDeleteUser = () => useAdminMutation((sub: string) => api.del(`/admin/users/${sub}`));
export const useResetPassword = () => useAdminMutation((sub: string) => api.post(`/admin/users/${sub}/reset-password`));
export const useUpdatePerms = () =>
  useAdminMutation(({ sub, perms }: { sub: string; perms: Partial<Perms> }) => api.put(`/admin/users/${sub}/permissions`, { perms }));
export const useSavePreset = () =>
  useAdminMutation(({ id, name, perms }: { id?: string; name: string; perms: Perms }) =>
    id ? api.put(`/admin/presets/${id}`, { name, perms }) : api.post("/admin/presets", { name, perms }),
  );
export const useDeletePreset = () => useAdminMutation((id: string) => api.del(`/admin/presets/${id}`));
