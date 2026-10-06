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
  assetPrefix?: string;
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

// ── C2 기준 정보 (backend/domains/company_master.py) ──

export type PartnerKind = "customer" | "supplier" | "both";
export const PARTNER_KIND_LABEL: Record<PartnerKind, string> = { customer: "매출처", supplier: "매입처", both: "매출·매입" };
export type Partner = {
  id: string;
  name: string;
  kind: PartnerKind;
  bizNo?: string;
  ceo?: string;
  contactName?: string;
  phone?: string;
  mobile?: string;
  email?: string;
  address?: string;
  memo?: string;
  active: boolean;
  // 금액 보기가 꺼져 있으면 오지 않는다
  receivable?: number;
  advance?: number;
  payable?: number;
  createdAt: string;
};
export type PartnerInput = Partial<Omit<Partner, "id" | "createdAt" | "receivable" | "advance" | "payable">>;

export type Tracking = "asset" | "stock";
export type Item = {
  id: string;
  name: string;
  tracking: Tracking;
  category?: string;
  maker?: string;
  modelNo?: string;
  spec?: string;
  unit: string;
  price?: number;
  rentPrice?: number;
  cost?: number;
  qty?: number; // 수량 품목
  minStock?: number;
  compatibleWith?: string[];
  memo?: string;
  active: boolean;
  assetCounts?: Record<AssetStatus, number>; // 개체 품목
  createdAt: string;
};
export type ItemInput = Partial<Omit<Item, "id" | "createdAt" | "assetCounts" | "qty" | "tracking">> & { tracking?: Tracking; openingQty?: number };

export type AssetStatus = "in_stock" | "rented" | "repair" | "retired";
export const ASSET_STATUS_LABEL: Record<AssetStatus, string> = { in_stock: "창고", rented: "임대 중", repair: "수리", retired: "폐기" };
export const ASSET_STATUS_TONE: Record<AssetStatus, string> = {
  in_stock: "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300",
  rented: "bg-sky-100 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300",
  repair: "bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300",
  retired: "bg-zinc-200 text-zinc-600 dark:bg-zinc-500/20 dark:text-zinc-400",
};
export type Asset = {
  id: string;
  code: string;
  itemId: string;
  itemName: string;
  serial: string;
  status: AssetStatus;
  partnerId?: string;
  partnerName?: string;
  location: string;
  acquiredAt?: string;
  cost?: number;
  memo: string;
  createdAt: string;
};
export type AssetLog = { at: string; actor: string; action: string; from?: string; to?: string; note?: string };

export type AccountKind = "cash" | "bank" | "card";
export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = { cash: "현금", bank: "은행", card: "카드" };
export type Account = { id: string; name: string; kind: AccountKind; bank?: string; number?: string; holder?: string; memo?: string; active: boolean; openingBalance?: number; balance?: number; createdAt: string };

const sub = (cid: string, ...k: string[]) => ["company", cid, ...k];

export function usePartners(cid: string, enabled = true) {
  return useQuery({ queryKey: sub(cid, "partners"), queryFn: () => api.get<{ partners: Partner[] }>(`/company/${cid}/partners`), select: (d) => d.partners, enabled });
}
export function usePartner(cid: string, pid: string) {
  return useQuery({ queryKey: sub(cid, "partners", pid), queryFn: () => api.get<{ partner: Partner; assets: Asset[] }>(`/company/${cid}/partners/${pid}`) });
}
export function useItems(cid: string, enabled = true) {
  return useQuery({ queryKey: sub(cid, "items"), queryFn: () => api.get<{ items: Item[] }>(`/company/${cid}/items`), select: (d) => d.items, enabled });
}
export function useAssets(cid: string, enabled = true) {
  return useQuery({ queryKey: sub(cid, "assets"), queryFn: () => api.get<{ assets: Asset[] }>(`/company/${cid}/assets`), select: (d) => d.assets, enabled });
}
export function useAsset(cid: string, aid: string) {
  return useQuery({ queryKey: sub(cid, "assets", aid), queryFn: () => api.get<{ asset: Asset; logs: AssetLog[] }>(`/company/${cid}/assets/${aid}`) });
}
export function useAccounts(cid: string, enabled = true) {
  return useQuery({ queryKey: sub(cid, "accounts"), queryFn: () => api.get<{ accounts: Account[] }>(`/company/${cid}/accounts`), select: (d) => d.accounts, enabled });
}

export function useMasterMutations(cid: string) {
  const qc = useQueryClient();
  const settled = () => void qc.invalidateQueries({ queryKey: ["company", cid] });
  const m = <V, R>(fn: (v: V) => Promise<R>) => ({ mutationFn: fn, onSettled: settled });
  return {
    createPartner: useMutation(m((body: PartnerInput & { name: string }) => api.post<Partner>(`/company/${cid}/partners`, body))),
    patchPartner: useMutation(m(({ id, ...body }: PartnerInput & { id: string }) => api.patch<Partner>(`/company/${cid}/partners/${id}`, body))),
    deletePartner: useMutation(m((id: string) => api.del(`/company/${cid}/partners/${id}`))),
    createItem: useMutation(m((body: ItemInput & { name: string; tracking: Tracking }) => api.post<Item>(`/company/${cid}/items`, body))),
    patchItem: useMutation(m(({ id, ...body }: ItemInput & { id: string }) => api.patch<Item>(`/company/${cid}/items/${id}`, body))),
    deleteItem: useMutation(m((id: string) => api.del(`/company/${cid}/items/${id}`))),
    registerAssets: useMutation(
      m((body: { itemId: string; count: number; serials: string[]; acquiredAt?: string; cost?: number; location: string; memo: string }) => api.post<{ assets: Asset[] }>(`/company/${cid}/assets`, body)),
    ),
    patchAsset: useMutation(m(({ id, ...body }: { id: string; serial?: string; status?: AssetStatus; location?: string; acquiredAt?: string | null; cost?: number | null; memo?: string }) => api.patch<Asset>(`/company/${cid}/assets/${id}`, body))),
    deleteAsset: useMutation(m((id: string) => api.del(`/company/${cid}/assets/${id}`))),
    createAccount: useMutation(m((body: { name: string; kind: AccountKind; bank?: string; number?: string; holder?: string; memo?: string; openingBalance: number }) => api.post<Account>(`/company/${cid}/accounts`, body))),
    patchAccount: useMutation(m(({ id, ...body }: { id: string; name?: string; kind?: AccountKind; bank?: string; number?: string; holder?: string; memo?: string; active?: boolean }) => api.patch<Account>(`/company/${cid}/accounts/${id}`, body))),
  };
}

/** 품목 분류 예시 (자유 입력, 자동완성용) */
export const ITEM_CATEGORIES = ["복합기", "프린터", "플로터", "토너", "잉크", "드럼", "용지", "부품", "라벨지", "기타"];
