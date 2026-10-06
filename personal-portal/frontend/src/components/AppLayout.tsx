import { type ReactNode, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router";
import { HouseIcon, LayoutGridIcon, LogOutIcon, PlusIcon, SettingsIcon, ShieldIcon } from "lucide-react";
import { type Me, useMe } from "@/api/me";
import { type Settings, useSettings } from "@/api/preferences";
import { useSignOut } from "@/auth/session";
import { ModuleIcon } from "@/components/ModuleIcon";
import { Button } from "@/components/ui/button";
import { setTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { MODULES, MODULE_BY_ID, type ModuleId } from "@/modules/meta";
import { QuickAddDialog } from "./QuickAddDialog";

/** 권한 있는 모듈 */
export const allowedModules = (me?: Me) => MODULES.filter((m) => me && me.perms[m.id] !== "none");

/** 폰 하단 탭 가운데 두 칸: 설정의 navTabs 중 권한 있는 것, 모자라면 권한 있는 모듈 순서대로 채움 */
export function bottomTabs(me?: Me, settings?: Settings): ModuleId[] {
  const allowed = allowedModules(me).map((m) => m.id);
  const picked = (settings?.navTabs ?? ["todo", "calendar"]).filter((id) => allowed.includes(id));
  for (const id of allowed) if (picked.length < 2 && !picked.includes(id)) picked.push(id);
  return picked.slice(0, 2);
}

export function useLogout() {
  const signOut = useSignOut();
  const navigate = useNavigate();
  return async () => {
    try {
      await signOut();
    } finally {
      void navigate("/login", { replace: true });
    }
  };
}

/** DESIGN.md 4.4 화면 이동: PC 왼쪽 사이드바(모든 모듈) / 폰 하단 탭(홈·탭 2개·빠른 추가·전체) */
export function AppLayout() {
  const me = useMe();
  const settings = useSettings();
  const logout = useLogout();
  const [quickAdd, setQuickAdd] = useState(false);

  // 서버에 저장된 테마를 이 기기에도 적용한다
  const theme = settings.data?.theme;
  useEffect(() => {
    if (theme) setTheme(theme);
  }, [theme]);

  const tabs = bottomTabs(me.data, settings.data);

  return (
    <div className="min-h-dvh">
      {/* PC 사이드바 */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r bg-sidebar md:flex">
        <Link to="/" className="flex h-14 items-center gap-2 px-5 text-base font-bold tracking-tight">
          <span className="grid size-7 place-items-center rounded-lg bg-primary text-sm text-primary-foreground">P</span>
          Personal Portal
        </Link>
        <nav className="grid flex-1 content-start gap-0.5 overflow-y-auto px-3 py-2">
          <SideLink to="/" end label="홈" icon={<span className="grid size-7 place-items-center rounded-lg bg-primary/10 text-primary [&_svg]:size-4"><HouseIcon /></span>} />
          <p className="px-2 pt-4 pb-1 text-[11px] font-medium text-muted-foreground">모듈</p>
          {allowedModules(me.data).map((m) => (
            <SideLink key={m.id} to={m.path} label={m.label} icon={<ModuleIcon module={m.id} size="sm" />} />
          ))}
        </nav>
        <div className="grid gap-1 border-t p-3">
          <Button className="mb-1 justify-start" onClick={() => setQuickAdd(true)}>
            <PlusIcon /> 빠른 추가
          </Button>
          <SideLink to="/settings" label="설정" icon={<span className="grid size-7 place-items-center [&_svg]:size-4"><SettingsIcon /></span>} />
          {me.data?.isHost && <SideLink to="/admin" label="관리자" icon={<span className="grid size-7 place-items-center [&_svg]:size-4"><ShieldIcon /></span>} />}
          <div className="mt-1 flex items-center gap-2 px-2 text-sm">
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{me.data?.name}</span>
            <Button variant="ghost" size="icon-sm" aria-label="로그아웃" onClick={() => void logout()}>
              <LogOutIcon />
            </Button>
          </div>
        </div>
      </aside>

      <div className="pt-[env(safe-area-inset-top)] pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0 md:pl-60">
        <Outlet />
      </div>

      {/* 폰 하단 탭 */}
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_-8px_oklch(0.4_0.03_60/0.12)] backdrop-blur md:hidden">
        <TabLink to="/" end label="홈" icon={<HouseIcon />} />
        {tabs[0] && <TabLink to={MODULE_BY_ID[tabs[0]].path} label={MODULE_BY_ID[tabs[0]].label} icon={<TabIcon module={tabs[0]} />} />}
        <button type="button" className="flex flex-col items-center justify-center" onClick={() => setQuickAdd(true)} aria-label="빠른 추가">
          <span className="grid size-11 -translate-y-2 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30">
            <PlusIcon className="size-6" />
          </span>
        </button>
        {tabs[1] && <TabLink to={MODULE_BY_ID[tabs[1]].path} label={MODULE_BY_ID[tabs[1]].label} icon={<TabIcon module={tabs[1]} />} />}
        <TabLink to="/menu" label="전체" icon={<LayoutGridIcon />} />
      </nav>

      <QuickAddDialog open={quickAdd} onOpenChange={setQuickAdd} />
    </div>
  );
}

function SideLink({ to, end, label, icon }: { to: string; end?: boolean; label: string; icon: ReactNode }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn("flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-sm transition-colors", isActive ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60")
      }
    >
      {icon}
      {label}
    </NavLink>
  );
}

const TabIcon = ({ module }: { module: ModuleId }) => {
  const Icon = MODULE_BY_ID[module].icon;
  return <Icon />;
};

function TabLink({ to, end, label, icon }: { to: string; end?: boolean; label: string; icon: ReactNode }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => cn("flex flex-col items-center justify-center gap-0.5 pt-2 pb-1.5 text-[10px] [&_svg]:size-5", isActive ? "font-semibold text-primary" : "text-muted-foreground")}
    >
      {icon}
      <span className="max-w-full truncate px-1">{label}</span>
    </NavLink>
  );
}
