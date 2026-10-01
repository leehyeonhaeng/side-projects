import { type FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { confirmSignIn, signIn, type SignInOutput } from "aws-amplify/auth";
import { authErrorMessage, normalizeEmail } from "@/auth/errors";
import { useClearAuthCache } from "@/auth/session";
import { FormError } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthCard, Field } from "./AuthCard";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const clearCache = useClearAuthCache();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [needsOtp, setNeedsOtp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? "/";

  const handleStep = async ({ isSignedIn, nextStep }: SignInOutput) => {
    if (isSignedIn) {
      clearCache();
      navigate(from, { replace: true });
      return;
    }
    const username = normalizeEmail(email);
    switch (nextStep.signInStep) {
      case "CONFIRM_SIGN_IN_WITH_TOTP_CODE":
        setNeedsOtp(true);
        return;
      case "CONFIRM_SIGN_UP":
        navigate(`/signup/confirm?email=${encodeURIComponent(username)}`);
        return;
      case "RESET_PASSWORD":
        // 관리자가 비밀번호를 초기화한 계정: 메일로 받은 코드로 새 비밀번호를 정한다
        navigate(`/forgot-password?email=${encodeURIComponent(username)}&sent=1`);
        return;
      default:
        setError(`지원하지 않는 로그인 단계입니다: ${nextStep.signInStep}`);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (needsOtp) {
        await handleStep(await confirmSignIn({ challengeResponse: otp.trim() }));
      } else {
        await handleStep(await signIn({ username: normalizeEmail(email), password }));
      }
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title="로그인" description={needsOtp ? "OTP 앱에 표시된 6자리 코드를 입력하세요." : undefined}>
      <form className="grid gap-4" onSubmit={(e) => void onSubmit(e)}>
        {needsOtp ? (
          <Field id="otp" label="OTP 코드">
            <Input id="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value)} autoFocus required />
          </Field>
        ) : (
          <>
            <Field id="email" label="이메일">
              <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Field id="password" label="비밀번호">
              <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
          </>
        )}
        <FormError message={error} />
        <Button type="submit" size="lg" disabled={busy}>
          {needsOtp ? "확인" : "로그인"}
        </Button>
      </form>
      <div className="mt-4 flex justify-between text-sm">
        <Link to="/signup" className="underline-offset-4 hover:underline">
          가입 신청
        </Link>
        <Link to="/forgot-password" className="text-muted-foreground underline-offset-4 hover:underline">
          비밀번호 찾기
        </Link>
      </div>
    </AuthCard>
  );
}
