import { Link, NavLink, Outlet, useNavigate } from "react-router";
import { LogOutIcon, ShieldIcon } from "lucide-react";
import { useMe } from "@/api/me";
import { useSignOut } from "@/auth/session";
import { Button } from "@/components/ui/button";

export function AppLayout() {
  const me = useMe();
  const signOut = useSignOut();
  const navigate = useNavigate();

  const logout = async () => {
    await signOut();
    navigate("/login", { replace: true });
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
            {me.data?.isHost && (
              <Button
                variant="ghost"
                size="sm"
                nativeButton={false}
                render={<NavLink to="/admin" />}
              >
                <ShieldIcon data-icon="inline-start" />
                관리자
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => void logout()}>
              <LogOutIcon data-icon="inline-start" />
              로그아웃
            </Button>
          </nav>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
