import { Link, Navigate } from "react-router";
import { useMe } from "@/api/me";
import { Button } from "@/components/ui/button";
import { MODULE_BY_ID, type ModuleId } from "@/modules/meta";

/** 아직 구현 전인 모듈 화면. 권한이 없으면 홈으로 보낸다 (DESIGN.md 4.2: 권한 없는 모듈은 숨김). */
export function ModulePlaceholderPage({ module }: { module: ModuleId }) {
  const me = useMe();
  const meta = MODULE_BY_ID[module];
  if (me.data && me.data.perms[module] === "none") return <Navigate to="/" replace />;
  const Icon = meta.icon;

  return (
    <main className="mx-auto grid max-w-2xl justify-items-start gap-3 p-4">
      <h1 className="flex items-center gap-2 text-xl font-semibold">
        <Icon className="size-5 text-primary" />
        {meta.label}
      </h1>
      <p className="text-sm text-muted-foreground">
        {meta.description} — Phase {meta.phase}에서 구현 예정입니다.
      </p>
      <Button variant="outline" size="sm" nativeButton={false} render={<Link to="/" />}>
        홈으로
      </Button>
    </main>
  );
}
