import { type ReactNode, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router";
import { HouseIcon, LogOutIcon, PlusIcon, SettingsIcon, ShieldIcon } from "lucide-react";
import { useMe } from "@/api/me";
import { useSettings } from "@/api/preferences";
import { useSignOut } from "@/auth/session";
import { Button } from "@/components/ui/button";
import { setTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { QuickAddDialog } from "./QuickAddDialog";

export function AppLayout() {
  const me = useMe();
  const settings = useSettings();
  const signOut = useSignOut();
  const navigate = useNavigate();
  const [quickAdd, setQuickAdd] = useState(false);

  // 서버에 저장된 테마를 이 기기에도 적용한다
  const theme = settings.data?.theme;
  useEffect(() => {
    if (theme) setTheme(theme);
  }, [theme]);

  const logout = async () => {
    try {
      await signOut();
    } finally {
      navigate("/login", { replace: true });
    }
  };

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-5xl items-center justify-between gap-2 px-4">
          <Link to="/" className="font-semibold">
            Personal Portal
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <span className="hidden text-muted-foreground sm:inline">{me.data?.name}</span>
            <Button variant="ghost" size="sm" className="hidden sm:inline-flex" onClick={() => setQuickAdd(true)}>
              <PlusIcon data-icon="inline-start" />
              빠른 추가
            </Button>
            {me.data?.isHost && (
              <Button variant="ghost" size="sm" nativeButton={false} render={<NavLink to="/admin" />}>
                <ShieldIcon data-icon="inline-start" />
                관리자
              </Button>
            )}
            <Button variant="ghost" size="sm" className="hidden sm:inline-flex" nativeButton={false} render={<NavLink to="/settings" />}>
              <SettingsIcon data-icon="inline-start" />
              설정
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void logout()}>
              <LogOutIcon data-icon="inline-start" />
              <span className="hidden sm:inline">로그아웃</span>
            </Button>
          </nav>
        </div>
      </header>

      <Outlet />

      {/* DESIGN.md 5장 모바일 하단 바: 홈 / 빠른 추가 / 설정 */}
      <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-3 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
        <BottomLink to="/" icon={<HouseIcon className="size-5" />} label="홈" />
        <button type="button" className="flex flex-col items-center gap-0.5 py-2 text-xs" onClick={() => setQuickAdd(true)}>
          <span className="grid size-8 place-items-center rounded-full bg-primary text-primary-foreground">
            <PlusIcon className="size-5" />
          </span>
          <span className="sr-only">빠른 추가</span>
        </button>
        <BottomLink to="/settings" icon={<SettingsIcon className="size-5" />} label="설정" />
      </nav>

      <QuickAddDialog open={quickAdd} onOpenChange={setQuickAdd} />
    </div>
  );
}

function BottomLink({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) => cn("flex flex-col items-center justify-center gap-0.5 py-2 text-xs", isActive ? "text-foreground" : "text-muted-foreground")}
    >
      {icon}
      {label}
    </NavLink>
  );
}
