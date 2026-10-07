import type { ReactNode } from "react";
import { Link, NavLink, Outlet, useOutletContext, useParams } from "react-router";
import { ArrowLeftIcon, ArrowRightLeftIcon, Building2Icon, WalletIcon, ContactIcon, FileSignatureIcon, GaugeIcon, HistoryIcon, HouseIcon, LandmarkIcon, LayoutGridIcon, PackageIcon, PrinterIcon, ReceiptTextIcon, SettingsIcon, UsersIcon, WrenchIcon } from "lucide-react";
import { ApiError } from "@/api/client";
import { type CompanyDetail, useCompany } from "@/api/company";
import { ErrorAlert, PageSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type CompanyOutlet = { cid: string; detail: CompanyDetail };
export const useCompanyOutlet = () => useOutletContext<CompanyOutlet>();

type NavItem = { to: string; label: string; icon: ReactNode; show: (d: CompanyDetail) => boolean; end?: boolean; phone?: boolean };
const can = (area: keyof CompanyDetail["me"]["perms"]) => (d: CompanyDetail) => d.me.perms[area] !== "none";

/** 회사 메뉴 (COMPANY.md 4장). 단계마다 메뉴가 늘어난다 — 권한 없는 메뉴는 숨김 */
export const COMPANY_NAV: NavItem[] = [
  { to: "", label: "홈", icon: <HouseIcon />, show: () => true, end: true, phone: true },
  { to: "txns", label: "거래", icon: <ArrowRightLeftIcon />, show: (d) => can("txns")(d) || can("money")(d), phone: true },
  { to: "assets", label: "기기", icon: <PrinterIcon />, show: can("assets"), phone: true },
  { to: "partners", label: "거래처", icon: <ContactIcon />, show: can("partners"), phone: true },
  { to: "contracts", label: "임대 계약", icon: <FileSignatureIcon />, show: can("contracts") },
  { to: "billing", label: "청구 대기", icon: <ReceiptTextIcon />, show: (d) => can("contracts")(d) && d.me.showAmounts },
  { to: "readings", label: "검침", icon: <GaugeIcon />, show: can("assets") },
  { to: "services", label: "A/S", icon: <WrenchIcon />, show: can("assets") },
  { to: "money", label: "돈 (미수·장부)", icon: <WalletIcon />, show: (d) => can("money")(d) && d.me.showAmounts },
  { to: "items", label: "품목·재고", icon: <PackageIcon />, show: can("items") },
  { to: "accounts", label: "계좌", icon: <LandmarkIcon />, show: can("money") },
  { to: "members", label: "직원·권한", icon: <UsersIcon />, show: (d) => d.me.isAdmin },
  { to: "audit", label: "활동 기록", icon: <HistoryIcon />, show: (d) => d.me.isAdmin },
  { to: "settings", label: "회사 설정", icon: <SettingsIcon />, show: (d) => d.me.perms.settings !== "none" },
];

/** 행컴퍼니 화면 틀: PC 왼쪽 회사 메뉴 / 폰 하단 탭. 행포털로 돌아가는 버튼 */
export function CompanyLayout() {
  const { cid = "" } = useParams();
  const company = useCompany(cid);

  if (company.isPending) return <PageSpinner />;
  if (company.isError) {
    const gone = company.error instanceof ApiError && company.error.status === 404;
    return (
      <main className="mx-auto grid max-w-md justify-items-start gap-3 p-6">
        {gone ? <p className="text-sm text-muted-foreground">회사가 없거나 소속되지 않은 회사입니다.</p> : <ErrorAlert error={company.error} />}
        <Button variant="outline" size="sm" nativeButton={false} render={<Link to="/" />}>
          행포털로
        </Button>
      </main>
    );
  }

  const items = COMPANY_NAV.filter((n) => n.show(company.data));
  // 폰 하단 탭: 자주 쓰는 것 최대 4개 + 전체
  const phoneTabs: NavItem[] = [...items.filter((n) => n.phone).slice(0, 4), { to: "more", label: "전체", icon: <LayoutGridIcon />, show: () => true }];
  const base = `/company/${cid}`;
  return (
    <div className="min-h-dvh">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r bg-sidebar md:flex">
        <div className="grid gap-1 px-4 pt-4 pb-3">
          <Link to="/" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeftIcon className="size-3.5" /> 행포털
          </Link>
          <p className="flex items-center gap-2 text-base font-bold tracking-tight">
            <span className="grid size-7 place-items-center rounded-lg bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900 [&_svg]:size-4">
              <Building2Icon />
            </span>
            <span className="truncate">{company.data.company.name}</span>
          </p>
        </div>
        <nav className="grid content-start gap-0.5 px-3">
          {items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to ? `${base}/${n.to}` : base}
              end={n.end}
              className={({ isActive }) =>
                cn("flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm [&_svg]:size-4", isActive ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60")
              }
            >
              {n.icon}
              {n.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="pt-[env(safe-area-inset-top)] pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0 md:pl-60">
        {/* 폰: 위쪽에 회사 이름과 행포털로 가기 */}
        <header className="flex items-center gap-2 border-b bg-card/80 px-4 py-2.5 backdrop-blur md:hidden">
          <Button variant="ghost" size="icon-sm" nativeButton={false} render={<Link to="/" aria-label="행포털로" />}>
            <ArrowLeftIcon />
          </Button>
          <Building2Icon className="size-4 text-muted-foreground" />
          <span className="truncate text-sm font-semibold">{company.data.company.name}</span>
        </header>
        <Outlet context={{ cid, detail: company.data } satisfies CompanyOutlet} />
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {phoneTabs.map((n) => (
          <NavLink
            key={n.to}
            to={n.to ? `${base}/${n.to}` : base}
            end={n.end}
            className={({ isActive }) => cn("flex flex-1 flex-col items-center gap-0.5 pt-2 pb-1.5 text-[10px] [&_svg]:size-5", isActive ? "font-semibold text-primary" : "text-muted-foreground")}
          >
            {n.icon}
            <span className="max-w-full truncate px-1">{n.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
