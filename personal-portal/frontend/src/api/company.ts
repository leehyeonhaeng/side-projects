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
  prepaid?: number;
  createdAt: string;
};
export type PartnerInput = Partial<Omit<Partner, "id" | "createdAt" | "receivable" | "advance" | "payable" | "prepaid">>;

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
  contractId?: string; // 계약에 묶여 임대 중
  lastReading?: Reading;
  createdAt: string;
};
export type Reading = { date: string; mono: number; color: number; note?: string };
export type AssetLog = { at: string; actor: string; action: string; from?: string; to?: string; note?: string; partnerId?: string; partnerName?: string; txnNo?: string; contractNo?: string; serviceNo?: string; mono?: number; color?: number; date?: string };

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

// ── C3 거래 (backend/domains/company_txn.py) ──

export type TxnType = "sale" | "charge" | "purchase" | "rental_out" | "rental_return" | "receipt" | "payment" | "expense" | "adjust" | "service";
export const TXN_LABEL: Record<TxnType, string> = {
  sale: "판매",
  charge: "청구",
  purchase: "매입",
  rental_out: "임대 출고",
  rental_return: "수거",
  receipt: "입금",
  payment: "지급",
  expense: "경비",
  adjust: "재고 조정",
  service: "A/S",
};
export const TXN_TONE: Record<TxnType, string> = {
  sale: "text-sky-700 bg-sky-100 dark:text-sky-300 dark:bg-sky-400/15",
  charge: "text-sky-700 bg-sky-100 dark:text-sky-300 dark:bg-sky-400/15",
  rental_out: "text-violet-700 bg-violet-100 dark:text-violet-300 dark:bg-violet-400/15",
  rental_return: "text-violet-700 bg-violet-100 dark:text-violet-300 dark:bg-violet-400/15",
  purchase: "text-amber-700 bg-amber-100 dark:text-amber-300 dark:bg-amber-400/15",
  receipt: "text-emerald-700 bg-emerald-100 dark:text-emerald-300 dark:bg-emerald-400/15",
  payment: "text-rose-700 bg-rose-100 dark:text-rose-300 dark:bg-rose-400/15",
  expense: "text-rose-700 bg-rose-100 dark:text-rose-300 dark:bg-rose-400/15",
  adjust: "text-zinc-700 bg-zinc-200 dark:text-zinc-300 dark:bg-zinc-500/20",
  service: "text-orange-700 bg-orange-100 dark:text-orange-300 dark:bg-orange-400/15",
};
export const CHARGE_TYPES: TxnType[] = ["sale", "charge", "rental_out", "rental_return", "service"];

export type TxnLine = { itemId?: string; name: string; unit?: string; qty: number; unitPrice?: number; vatMode?: VatMode; supply?: number; vat?: number; total?: number; manual?: boolean; memo: string; assetIds?: string[] };
export type Link = { txnId: string; date: string; amount: number; no?: string };
export type Txn = {
  id: string;
  no: string;
  type: TxnType;
  date: string;
  status: "confirmed" | "canceled";
  partnerId?: string;
  partnerName?: string;
  accountId?: string;
  accountName?: string;
  lines: TxnLine[];
  supply?: number;
  vat?: number;
  total?: number;
  paid?: number;
  paidBy?: Link[];
  amount?: number;
  allocated?: number;
  unallocated?: number;
  allocations?: Link[];
  assetIds?: string[];
  assetCodes?: string[];
  assetNames?: string[];
  category?: string;
  memo: string;
  contractId?: string;
  contractNo?: string;
  contractOp?: "create" | "add" | "return";
  billMonth?: string;
  serviceId?: string;
  serviceNo?: string;
  createdBy: string;
  createdAt: string;
  canceledAt?: string;
  cancelReason?: string;
};
export type LineInput = { itemId?: string; name: string; qty: number; unitPrice: number; vatMode: VatMode; supply?: number; vat?: number; total?: number; memo: string };
export type TxnInput = {
  type: TxnType;
  date: string;
  partnerId?: string;
  accountId?: string;
  lines?: LineInput[] | { itemId: string; name: string; qty: number; memo: string }[];
  assetIds?: string[];
  returnLocation?: string;
  amount?: number;
  allocations?: { txnId: string; date: string; amount: number }[];
  payNow?: { accountId: string };
  category?: string;
  serviceId?: string;
  memo: string;
};
export type OpenCharge = { id: string; no: string; date: string; type: TxnType; total: number; paid: number; open: number; summary: string };
export type BalanceRow = { id: string; name: string; kind: PartnerKind; receivable: number; advance: number; payable: number; prepaid: number };
export type LedgerRow = { date: string; id: string; no: string; type: TxnType; accountId: string; accountName: string; partnerName: string; category: string; memo: string; amount: number; balanceAfter: number };

export function useTxns(cid: string, params: { from?: string; to?: string; partnerId?: string; type?: string }, enabled = true) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  return useQuery({ queryKey: sub(cid, "txns", q), queryFn: () => api.get<{ txns: Txn[] }>(`/company/${cid}/txns?${q}`), select: (d) => d.txns, enabled });
}
export function useTxn(cid: string, day: string, tid: string) {
  return useQuery({ queryKey: sub(cid, "txns", day, tid), queryFn: () => api.get<{ txn: Txn }>(`/company/${cid}/txns/${day}/${tid}`), select: (d) => d.txn });
}
export function useOpenCharges(cid: string, partnerId: string | undefined, side: "receivable" | "payable", enabled = true) {
  return useQuery({
    queryKey: sub(cid, "open", partnerId ?? "", side),
    queryFn: () => api.get<{ charges: OpenCharge[] }>(`/company/${cid}/open-charges?partnerId=${partnerId}&side=${side}`),
    select: (d) => d.charges,
    enabled: !!partnerId && enabled,
  });
}
export function useReceivables(cid: string, enabled = true) {
  return useQuery({ queryKey: sub(cid, "receivables"), queryFn: () => api.get<{ partners: BalanceRow[] }>(`/company/${cid}/receivables`), select: (d) => d.partners, enabled });
}
export function useLedger(cid: string, from: string, to: string, accountId?: string) {
  const q = `from=${from}&to=${to}${accountId ? `&accountId=${accountId}` : ""}`;
  return useQuery({ queryKey: sub(cid, "ledger", q), queryFn: () => api.get<{ rows: LedgerRow[]; accounts: { id: string; name: string; balance: number }[] }>(`/company/${cid}/ledger?${q}`) });
}
export function useCloses(cid: string) {
  return useQuery({ queryKey: sub(cid, "closes"), queryFn: () => api.get<{ closes: { month: string; closedAt: string }[] }>(`/company/${cid}/closes`), select: (d) => d.closes.map((c) => c.month).sort() });
}

export function useTxnMutations(cid: string) {
  const qc = useQueryClient();
  const settled = () => void qc.invalidateQueries({ queryKey: ["company", cid] });
  return {
    create: useMutation({ mutationFn: (body: TxnInput) => api.post<{ txn: Txn; related: Txn[]; createdAssets: Asset[] }>(`/company/${cid}/txns`, body), onSettled: settled }),
    cancel: useMutation({ mutationFn: ({ date, id, reason }: { date: string; id: string; reason: string }) => api.post<{ txn: Txn }>(`/company/${cid}/txns/${date}/${id}/cancel`, { reason }), onSettled: settled }),
    close: useMutation({ mutationFn: (month: string) => api.post(`/company/${cid}/closes`, { month }), onSettled: settled }),
    reopen: useMutation({ mutationFn: (month: string) => api.del(`/company/${cid}/closes/${month}`), onSettled: settled }),
  };
}

/** 금액 줄 제안값 (백엔드 price_line과 같은 규칙, COMPANY.md 6장) */
export function priceLine(qty: number, unitPrice: number, mode: VatMode): { supply: number; vat: number; total: number } {
  const base = Math.round(qty * unitPrice);
  if (mode === "included") {
    const supply = Math.round(base / 1.1);
    return { supply, vat: base - supply, total: base };
  }
  if (mode === "excluded") {
    const vat = Math.round(base * 0.1);
    return { supply: base, vat, total: base + vat };
  }
  return { supply: base, vat: 0, total: base };
}

export const EXPENSE_CATEGORIES = ["임차료", "인건비", "유류비", "차량유지비", "통신비", "소모품비", "수리비", "운반비", "식대", "세금과공과", "기타"];

// ── C4 임대 계약·정기 청구·검침·A/S (backend/domains/company_rental.py, company_service.py) ──

export type Terms = { monthly?: number; counter: boolean; freeMono: number; freeColor: number; overMono?: number; overColor?: number };
export type ContractMachine = Terms & {
  assetId: string;
  code: string;
  itemName: string;
  startedAt: string;
  endedAt?: string;
  startMono: number;
  startColor: number;
  billedMono: number;
  billedColor: number;
  billedReadAt: string;
  endMono?: number;
  endColor?: number;
};
export type ContractStatus = "active" | "ended" | "canceled";
export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = { active: "진행 중", ended: "종료", canceled: "취소" };
export type Contract = {
  id: string;
  no: string;
  partnerId: string;
  partnerName: string;
  status: ContractStatus;
  startDate: string;
  endedAt?: string;
  termEnd?: string;
  billingDay: number;
  vatMode: VatMode;
  memo: string;
  machines: Record<string, ContractMachine>;
  billedThrough: string;
  createdAt: string;
};
export type PendingLine = { name: string; qty: number; unitPrice: number; vatMode: VatMode; memo: string };
export type PendingBill = {
  contractId: string;
  contractNo: string;
  partnerId: string;
  partnerName: string;
  month: string;
  dueOn: string;
  final: boolean;
  behind: number;
  lines: PendingLine[];
  counters: { assetId: string; code: string; fromMono: number; toMono: number; fromColor: number; toColor: number; readAt: string }[];
  warnings: string[];
};
export type ReadingRow = {
  contractId: string;
  contractNo: string;
  partnerId: string;
  partnerName: string;
  billingDay: number;
  assetId: string;
  code: string;
  itemName: string;
  color: boolean;
  lastReading?: Reading;
  billedMono: number;
  billedColor: number;
  billedReadAt: string;
};
export type MachineInput = Terms & { assetId: string; startMono?: number; startColor?: number };
export type ServiceStatus = "open" | "done" | "canceled";
export const SERVICE_STATUS_LABEL: Record<ServiceStatus, string> = { open: "접수", done: "완료", canceled: "취소" };
export type Service = {
  id: string;
  no: string;
  status: ServiceStatus;
  date: string;
  partnerId: string;
  partnerName: string;
  assetId?: string;
  assetCode?: string;
  itemName?: string;
  symptom: string;
  contact: string;
  assignee?: string;
  assigneeName?: string;
  done?: { date: string; action: string; by: string; at: string };
  txn?: { id: string; date: string; no: string };
  chargeTxn?: { id: string; date: string; no: string };
  needsBilling?: boolean;
  cancelReason?: string;
  createdAt: string;
};

export const monthLabel = (ym: string) => `${Number(ym.slice(5, 7))}월`;
export const billingDayLabel = (d: number) => (d >= 31 ? "말일" : `${d}일`);

export function useContracts(cid: string, params: { partnerId?: string; status?: string } = {}, enabled = true) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  return useQuery({ queryKey: sub(cid, "contracts", q), queryFn: () => api.get<{ contracts: Contract[] }>(`/company/${cid}/contracts?${q}`), select: (d) => d.contracts, enabled });
}
export function useContract(cid: string, kid: string) {
  return useQuery({ queryKey: sub(cid, "contracts", kid), queryFn: () => api.get<{ contract: Contract; txns: Txn[]; pending: PendingBill | null }>(`/company/${cid}/contracts/${kid}`) });
}
export function useBilling(cid: string, enabled = true) {
  return useQuery({ queryKey: sub(cid, "billing"), queryFn: () => api.get<{ pending: PendingBill[] }>(`/company/${cid}/billing`), select: (d) => d.pending, enabled });
}
export function useReadings(cid: string, enabled = true) {
  return useQuery({ queryKey: sub(cid, "readings"), queryFn: () => api.get<{ rows: ReadingRow[] }>(`/company/${cid}/readings`), select: (d) => d.rows, enabled });
}
export function useServices(cid: string, params: { status?: string; assetId?: string; partnerId?: string } = {}, enabled = true) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  return useQuery({ queryKey: sub(cid, "services", q), queryFn: () => api.get<{ services: Service[] }>(`/company/${cid}/services?${q}`), select: (d) => d.services, enabled });
}
export function useService(cid: string, sid: string) {
  return useQuery({ queryKey: sub(cid, "services", sid), queryFn: () => api.get<{ service: Service; txn: Txn | null }>(`/company/${cid}/services/${sid}`) });
}
export function useStaff(cid: string) {
  return useQuery({ queryKey: sub(cid, "staff"), queryFn: () => api.get<{ staff: { sub: string; name: string }[] }>(`/company/${cid}/staff`), select: (d) => d.staff, staleTime: 60_000 });
}

type TxnResult = { txn: Txn; related: Txn[]; createdAssets: Asset[] };
type ContractBody = { partnerId: string; date: string; billingDay: number; vatMode: VatMode; termEnd?: string; machines: MachineInput[]; lines: LineInput[]; memo: string };
type ReturnInput = { id: string; date: string; assetIds: string[]; readings: { assetId: string; mono: number; color?: number }[]; returnLocation: string; lines: LineInput[]; memo: string };
type ContractPatch = { id: string; billingDay?: number; vatMode?: VatMode; termEnd?: string | null; memo?: string; machines?: Record<string, Partial<Terms>> };
type BillResult = { contractId: string; month: string; ok: boolean; error?: string; txn?: { id: string; no: string; date: string; total?: number } };
type ServiceDoneInput = { id: string; date: string; action: string; parts: LineInput[]; fees: LineInput[]; billable: boolean };

export function useRentalMutations(cid: string) {
  const qc = useQueryClient();
  const settled = () => void qc.invalidateQueries({ queryKey: ["company", cid] });
  const m = <V, R>(fn: (v: V) => Promise<R>) => ({ mutationFn: fn, onSettled: settled });
  const base = `/company/${cid}`;
  return {
    createContract: useMutation(m((body: ContractBody) => api.post<TxnResult & { contract: Contract }>(`${base}/contracts`, body))),
    addMachines: useMutation(m(({ id, ...body }: { id: string; date: string; machines: MachineInput[]; lines: LineInput[]; memo: string }) => api.post<TxnResult>(`${base}/contracts/${id}/machines`, body))),
    returnMachines: useMutation(m(({ id, ...body }: ReturnInput) => api.post<TxnResult>(`${base}/contracts/${id}/return`, body))),
    patchContract: useMutation(m(({ id, ...body }: ContractPatch) => api.patch<{ contract: Contract }>(`${base}/contracts/${id}`, body))),
    issueBills: useMutation(m((items: { contractId: string; month: string; date: string; lines: LineInput[] }[]) => api.post<{ results: BillResult[] }>(`${base}/billing`, { items }))),
    addReading: useMutation(m(({ assetId, ...body }: { assetId: string; date: string; mono: number; color?: number; fix?: boolean; memo?: string }) => api.post<{ lastReading: Reading }>(`${base}/assets/${assetId}/readings`, body))),
    createService: useMutation(m((body: { partnerId: string; assetId?: string; date: string; symptom: string; contact: string; assignee?: string }) => api.post<{ service: Service }>(`${base}/services`, body))),
    patchService: useMutation(m(({ id, ...body }: { id: string; symptom?: string; contact?: string; assignee?: string }) => api.patch<{ service: Service }>(`${base}/services/${id}`, body))),
    completeService: useMutation(m(({ id, ...body }: ServiceDoneInput) => api.post<Partial<TxnResult> & { service: Service }>(`${base}/services/${id}/complete`, body))),
    cancelService: useMutation(m(({ id, reason }: { id: string; reason: string }) => api.post<{ service: Service }>(`${base}/services/${id}/cancel`, { reason }))),
  };
}

// ── C5 문서·라벨·직인 (backend/domains/company_docs.py) ──

export type DocType = "receipt" | "statement" | "invoice" | "work";
export const DOC_LABEL: Record<DocType, string> = { receipt: "영수증", statement: "거래명세서", invoice: "청구서", work: "작업 확인서" };
export type DocSource = { kind: "txn" | "service"; id: string; date?: string; no: string };
export type Doc = { id: string; no: string; type: DocType; title: string; date: string; partnerId: string; partnerName: string; sources: DocSource[]; total?: number; canceled: boolean; sealVersion: string; issuedBy: string; issuedAt: string };
export type PdfFile = { filename: string; contentType: string; data: string; url?: string; canceled?: boolean; no?: string };
export type LabelKind = "a4-21" | "a4-24" | "a4-14" | "roll-50x30" | "roll-60x40" | "roll-40x30";
export const LABEL_KINDS: { id: LabelKind; label: string; per?: number; cols?: number }[] = [
  { id: "a4-21", label: "A4 21칸 (3×7, 63.5×38.1mm)", per: 21, cols: 3 },
  { id: "a4-24", label: "A4 24칸 (3×8, 63.5×33.9mm)", per: 24, cols: 3 },
  { id: "a4-14", label: "A4 14칸 (2×7, 99.1×38.1mm)", per: 14, cols: 2 },
  { id: "roll-50x30", label: "라벨 프린터 50×30mm" },
  { id: "roll-60x40", label: "라벨 프린터 60×40mm" },
  { id: "roll-40x30", label: "라벨 프린터 40×30mm" },
];

export function useDocs(cid: string, params: { type?: string; partnerId?: string; source?: string } = {}, enabled = true) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  return useQuery({ queryKey: sub(cid, "docs", q), queryFn: () => api.get<{ docs: Doc[] }>(`/company/${cid}/docs?${q}`), select: (d) => d.docs, enabled });
}
export function useSeal(cid: string) {
  return useQuery({ queryKey: sub(cid, "seal"), queryFn: () => api.get<{ data: string | null; updatedAt?: string }>(`/company/${cid}/seal`) });
}

type InvoiceInput = { partnerId: string; date: string; txns: { date: string; id: string }[]; previous: boolean; counters: boolean; bank: boolean; memo: string };
type LabelsInput = { assetIds: string[]; kind: LabelKind; start: number; nudgeX: number; nudgeY: number; outline: boolean; baseUrl: string };

export function useDocMutations(cid: string) {
  const qc = useQueryClient();
  const settled = () => void qc.invalidateQueries({ queryKey: ["company", cid, "docs"] });
  const base = `/company/${cid}`;
  return {
    issue: useMutation({ mutationFn: (body: { type: "receipt" | "statement" | "work"; txnDate?: string; txnId?: string; serviceId?: string }) => api.post<{ doc: Doc; created: boolean }>(`${base}/docs`, body), onSettled: settled }),
    invoice: useMutation({ mutationFn: (body: InvoiceInput) => api.post<{ doc: Doc; created: boolean }>(`${base}/docs/invoice`, body), onSettled: settled }),
    pdf: useMutation({ mutationFn: (id: string) => api.get<PdfFile>(`${base}/docs/${id}/pdf`) }),
    ledger: useMutation({ mutationFn: (body: { partnerId: string; from: string; to: string }) => api.post<PdfFile>(`${base}/print/ledger`, body) }),
    labels: useMutation({ mutationFn: (body: LabelsInput) => api.post<PdfFile>(`${base}/print/labels`, body) }),
    putSeal: useMutation({ mutationFn: (data: string) => api.put<{ data: string; updatedAt: string }>(`${base}/seal`, { data }), onSettled: () => void qc.invalidateQueries({ queryKey: ["company", cid, "seal"] }) }),
    deleteSeal: useMutation({ mutationFn: () => api.del(`${base}/seal`), onSettled: () => void qc.invalidateQueries({ queryKey: ["company", cid, "seal"] }) }),
  };
}
