import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { useMe } from "@/api/me";
import { InlineSpinner } from "@/components/states";
import type { ModuleId } from "@/modules/meta";

/** 권한 없는 모듈 화면은 홈으로 보낸다 (DESIGN.md 4.2: 권한 없는 모듈은 숨김). 실제 차단은 서버 미들웨어. */
export function RequireModule({ module, children }: { module: ModuleId; children: ReactNode }) {
  const me = useMe();
  if (!me.data) return <InlineSpinner />;
  if (me.data.perms[module] === "none") return <Navigate to="/" replace />;
  return <>{children}</>;
}
