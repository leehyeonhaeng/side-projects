import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, api } from "./client";

// backend/domains/company_core.py 와 같은 구조 (docs/COMPANY.md)
export type AreaLevel = "none" | "view" | "edit";
export type Area = "partners" | "assets" | "items" | "contracts" | "txns" | "money" | "docs" | "reports" | "settings";
export type AreaPerms = Record<Area, AreaLevel>;
export type VatMode = "included" | "excluded" | "exempt";

export const AREAS: { id: Area; label: string }[] = [
  { id: "partners", label: "거래처" },
  { id: "assets", label: "기기" },
  { id: "items", label: "품목·재고" },
  { id: "contracts", label: "임대 계약" },
  { id: "txns", label: "거래" },
  { id: "money", label: "돈(수금·지급·장부)" },
  { id: "docs", label: "문서" },
  { id: "reports", label: "보고서" },
  { id: "settings", label: "회사 설정" },
];
export const LEVEL_LABEL: Record<AreaLevel, string> = { none: "없음", view: "보기", edit: "편집" };
export const VAT_LABEL: Record<VatMode, string> = { included: "부가세 포함", excluded: "부가세 별도", exempt: "면세" };

export type CompanySummary = { id: string; name: string; isAdmin: boolean };
export type CompanyInfo = {
  id: string;
  name: string;
  bizNo?: string;
  ceo?: string;
  address?: string;
  phone?: string;
  fax?: string;
  email?: string;
  bizType?: string;
  bizItem?: string;
  bankAccount?: string;
  vatDefault: VatMode;
  createdAt: string;
};
export type MyCompanyAccess = { isAdmin: boolean; perms: AreaPerms; showAmounts: boolean };
export type CompanyDetail = { company: CompanyInfo; me: MyCompanyAccess };
export type CompanyMember = { sub: string; name: string; email: string; roleId: string; isAdmin: boolean; showAmounts: boolean; perms: AreaPerms; joinedAt: string };
export type CompanyRole = { id: string; name: string; isAdmin: boolean; showAmounts: boolean; perms: AreaPerms };
export type Invite = { code: string; cid: string; companyName: string; roleId: string; roleName: string; note: string; createdAt: string; expiresAt: number };
export type InviteInfo = { companyName: string; roleName: string; expiresAt: number };
export type CompanyLog = { at: string; actor: string; actorName: string; action: string; target: string; targetName?: string; detail: Record<string, unknown> };

const key = (cid: string) => ["company", cid];

export function useMyCompanies(enabled = true) {
  return useQuery({ queryKey: ["company", "mine"], queryFn: () => api.get<{ companies: CompanySummary[] }>("/company"), select: (d) => d.companies, enabled, staleTime: 60_000 });
}
export function useCompany(cid: string) {
  return useQuery({ queryKey: key(cid), queryFn: () => api.get<CompanyDetail>(`/company/${cid}`), staleTime: 30_000 });
}
export function useCompanyMembers(cid: string, enabled: boolean) {
  return useQuery({ queryKey: [...key(cid), "members"], queryFn: () => api.get<{ members: CompanyMember[] }>(`/company/${cid}/members`), select: (d) => d.members, enabled });
}
export function useCompanyRoles(cid: string, enabled: boolean) {
  return useQuery({ queryKey: [...key(cid), "roles"], queryFn: () => api.get<{ roles: CompanyRole[] }>(`/company/${cid}/roles`), select: (d) => d.roles, enabled });
}
export function useInvites(cid: string, enabled: boolean) {
  return useQuery({ queryKey: [...key(cid), "invites"], queryFn: () => api.get<{ invites: Invite[] }>(`/company/${cid}/invites`), select: (d) => d.invites, enabled });
}
export function useCompanyAudit(cid: string, enabled: boolean) {
  return useQuery({ queryKey: [...key(cid), "audit"], queryFn: () => api.get<{ logs: CompanyLog[] }>(`/company/${cid}/audit`), select: (d) => d.logs, enabled });
}
/** 로그인 없이 초대 정보 (가입 화면) */
export function useInviteInfo(code: string | null) {
  return useQuery({ queryKey: ["invite", code], queryFn: () => apiFetch<InviteInfo>(`/invite/${code}`, { auth: false }), enabled: !!code, retry: false });
}

export function useCreateCompany() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (name: string) => api.post<CompanyInfo>("/company", { name }), onSettled: () => qc.invalidateQueries({ queryKey: ["company"] }) });
}
export function useAcceptInvite() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (code: string) => api.post<{ cid: string; companyName: string }>(`/company/invites/${code}/accept`), onSettled: () => qc.invalidateQueries({ queryKey: ["company"] }) });
}

export function useCompanyMutations(cid: string) {
  const qc = useQueryClient();
  const settled = () => void qc.invalidateQueries({ queryKey: key(cid) });
  return {
    patchCompany: useMutation({ mutationFn: (body: Partial<Omit<CompanyInfo, "id" | "createdAt">>) => api.patch<CompanyInfo>(`/company/${cid}`, body), onSettled: () => qc.invalidateQueries({ queryKey: ["company"] }) }),
    patchMember: useMutation({
      mutationFn: ({ sub, ...body }: { sub: string; roleId?: string; perms?: AreaPerms; showAmounts?: boolean; isAdmin?: boolean }) => api.patch<CompanyMember>(`/company/${cid}/members/${sub}`, body),
      onSettled: settled,
    }),
    removeMember: useMutation({ mutationFn: (sub: string) => api.del(`/company/${cid}/members/${sub}`), onSettled: settled }),
    putRole: useMutation({ mutationFn: ({ id, ...body }: Omit<CompanyRole, "isAdmin">) => api.put<CompanyRole>(`/company/${cid}/roles/${id}`, body), onSettled: settled }),
    createInvite: useMutation({ mutationFn: (body: { roleId: string; note: string }) => api.post<Invite>(`/company/${cid}/invites`, body), onSettled: settled }),
    deleteInvite: useMutation({ mutationFn: (code: string) => api.del(`/company/${cid}/invites/${code}`), onSettled: settled }),
  };
}

export const inviteUrl = (code: string) => `${location.origin}/invite/${code}`;

// 가입 중인 초대 코드 (가입 → 이메일 인증 화면으로 넘어가는 동안 보관)
const PENDING = "pendingInvite";
export function savePendingInvite(code: string) {
  try {
    localStorage.setItem(PENDING, code);
  } catch {
    /* 저장 못 해도 가입은 진행 (일반 가입으로 처리됨) */
  }
}
export function pendingInvite(): string | null {
  try {
    return localStorage.getItem(PENDING);
  } catch {
    return null;
  }
}
export function clearPendingInvite() {
  try {
    localStorage.removeItem(PENDING);
  } catch {
    /* 무시 */
  }
}

const ACTION_LABEL: Record<string, string> = {
  company_create: "회사 개설",
  settings_change: "회사 설정 변경",
  role_change: "역할 수정",
  member_change: "직원 권한 변경",
  member_remove: "직원 내보내기·나가기",
  invite_create: "초대 만들기",
  invite_delete: "초대 취소",
  invite_accept: "초대로 참여",
};
export const actionLabel = (a: string) => ACTION_LABEL[a] ?? a;
