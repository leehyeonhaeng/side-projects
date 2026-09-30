import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { ApiError } from "@/api/client";
import { useMe } from "@/api/me";
import { Button } from "@/components/ui/button";
import { CenteredMessage, PageSpinner } from "@/components/states";
import { useSession, useSignOut, useTotpEnabled } from "./session";

/** 로그인 + 활성 계정 + (Host면) TOTP 등록까지 확인한 뒤 화면을 보여준다 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const session = useSession();
  const me = useMe(Boolean(session.data));
  const totp = useTotpEnabled(me.data?.isHost === true);
  const signOut = useSignOut();

  if (session.isPending) return <PageSpinner />;
  if (!session.data) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (me.isPending) return <PageSpinner />;
  if (me.isError) {
    const blocked = me.error instanceof ApiError && me.error.status === 403;
    return (
      <CenteredMessage title={blocked ? "사용할 수 없는 계정입니다" : "정보를 불러오지 못했습니다"}>
        <p>{blocked ? "승인 대기 중이거나 정지된 계정입니다." : me.error.message}</p>
        <Button variant="outline" onClick={() => void signOut()}>
          로그아웃
        </Button>
      </CenteredMessage>
    );
  }
  if (me.data.isHost) {
    if (totp.isPending) return <PageSpinner />;
    if (!totp.data && location.pathname !== "/mfa-setup") return <Navigate to="/mfa-setup" replace />;
  }
  return <>{children}</>;
}

export function RequireHost({ children }: { children: ReactNode }) {
  const me = useMe();
  if (!me.data) return <PageSpinner />;
  if (!me.data.isHost) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** 로그인·가입 화면: 이미 로그인했으면 홈으로 */
export function GuestOnly({ children }: { children: ReactNode }) {
  const session = useSession();
  if (session.isPending) return <PageSpinner />;
  if (session.data) return <Navigate to="/" replace />;
  return <>{children}</>;
}
