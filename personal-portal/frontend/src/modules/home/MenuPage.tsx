import type { ReactNode } from "react";
import { Link } from "react-router";
import { ChevronRightIcon, LogOutIcon, SettingsIcon, ShieldIcon } from "lucide-react";
import { useMe } from "@/api/me";
import { allowedModules, useLogout } from "@/components/AppLayout";
import { ModuleIcon } from "@/components/ModuleIcon";
import { Button } from "@/components/ui/button";

/** 폰 하단 탭 "전체": 모든 모듈 + 설정·관리자·로그아웃 */
export function MenuPage() {
  const me = useMe();
  const logout = useLogout();
  return (
    <main className="mx-auto grid max-w-2xl gap-5 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">전체</h1>
        <p className="text-sm text-muted-foreground">{me.data?.name}님</p>
      </div>
      <ul className="grid grid-cols-2 gap-2">
        {allowedModules(me.data).map((m) => (
          <li key={m.id}>
            <Link to={m.path} className="flex h-full items-center gap-3 rounded-2xl border bg-card p-3 transition-colors active:bg-muted">
              <ModuleIcon module={m.id} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{m.label}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{m.description}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <ul className="grid divide-y overflow-hidden rounded-2xl border bg-card">
        <MenuRow to="/settings" icon={<SettingsIcon />} label="설정" />
        {me.data?.isHost && <MenuRow to="/admin" icon={<ShieldIcon />} label="관리자" />}
      </ul>
      <Button variant="ghost" className="justify-self-start text-muted-foreground" onClick={() => void logout()}>
        <LogOutIcon /> 로그아웃
      </Button>
    </main>
  );
}

function MenuRow({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <li>
      <Link to={to} className="flex items-center gap-3 px-4 py-3 text-sm active:bg-muted [&>svg:first-child]:size-5 [&>svg:first-child]:text-muted-foreground">
        {icon}
        <span className="flex-1">{label}</span>
        <ChevronRightIcon className="size-4 text-muted-foreground" />
      </Link>
    </li>
  );
}
