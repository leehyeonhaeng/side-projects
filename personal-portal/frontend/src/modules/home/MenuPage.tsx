import type { ReactNode } from "react";
import { Link } from "react-router";
import { Building2Icon, ChevronRightIcon, LogOutIcon, SettingsIcon, ShieldIcon } from "lucide-react";
import { useMe } from "@/api/me";
import { CompanyBadge, allowedModules, useLogout } from "@/components/AppLayout";
import { useMyCompanies } from "@/api/company";
import { ModuleIcon } from "@/components/ModuleIcon";
import { Button } from "@/components/ui/button";
import { IS_PROD } from "@/lib/env";

/** 폰 하단 탭 "전체": 모든 모듈 + 설정·관리자·로그아웃 */
export function MenuPage() {
  const me = useMe();
  const logout = useLogout();
  const companies = useMyCompanies();
  return (
    <main className="mx-auto grid max-w-2xl gap-5 p-4 md:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          전체
          {!IS_PROD && <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">DEV</span>}
        </h1>
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
      {(companies.data?.length ?? 0) > 0 && (
        <ul className="grid gap-2">
          {companies.data!.map((c) => (
            <li key={c.id}>
              <Link to={`/company/${c.id}`} className="flex items-center gap-3 rounded-2xl border bg-card p-3 active:bg-muted">
                <CompanyBadge size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{c.name}</span>
                  <span className="block text-[11px] text-muted-foreground">회사 업무</span>
                </span>
                <ChevronRightIcon className="size-4 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <ul className="grid divide-y overflow-hidden rounded-2xl border bg-card">
        <MenuRow to="/settings" icon={<SettingsIcon />} label="설정" />
        {me.data?.isHost && <MenuRow to="/admin" icon={<ShieldIcon />} label="관리자" />}
        {me.data?.isHost && <MenuRow to="/company" icon={<Building2Icon />} label="회사 관리 (개설)" />}
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
