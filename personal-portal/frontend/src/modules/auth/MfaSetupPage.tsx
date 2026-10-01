import { useNavigate } from "react-router";
import { useMe } from "@/api/me";
import { TotpSetup } from "@/auth/TotpSetup";
import { PageSpinner } from "@/components/states";
import { AuthCard } from "./AuthCard";

/** Host는 첫 로그인 때 TOTP(OTP 앱) 등록을 반드시 거친다 (DESIGN.md 4.1) */
export function MfaSetupPage() {
  const navigate = useNavigate();
  const me = useMe();
  if (!me.data) return <PageSpinner />;

  return (
    <AuthCard title="OTP 등록" description="관리자 계정은 2단계 인증이 필수입니다.">
      <TotpSetup email={me.data.email} onDone={() => navigate("/admin", { replace: true })} />
    </AuthCard>
  );
}
