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
  const [needsNewPassword, setNeedsNewPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [newPassword2, setNewPassword2] = useState("");
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
        setNeedsNewPassword(false);
        setNeedsOtp(true);
        return;
      case "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED":
        // 회사 관리자가 만들어 준 계정의 첫 로그인(임시 비밀번호)
        setNeedsNewPassword(true);
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
      } else if (needsNewPassword) {
        if (newPassword !== newPassword2) {
          setError("두 비밀번호가 다릅니다.");
          return;
        }
        await handleStep(await confirmSignIn({ challengeResponse: newPassword }));
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
    <AuthCard
      title={needsNewPassword ? "새 비밀번호 정하기" : "로그인"}
      description={needsOtp ? "OTP 앱에 표시된 6자리 코드를 입력하세요." : needsNewPassword ? "임시 비밀번호로 로그인했습니다. 앞으로 쓸 비밀번호를 정하세요 (8자 이상, 소문자·숫자·특수문자 포함)." : undefined}
    >
      <form className="grid gap-4" onSubmit={(e) => void onSubmit(e)}>
        {needsNewPassword ? (
          <>
            <Field id="new-password" label="새 비밀번호">
              <Input id="new-password" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoFocus required minLength={8} />
            </Field>
            <Field id="new-password2" label="새 비밀번호 확인">
              <Input id="new-password2" type="password" autoComplete="new-password" value={newPassword2} onChange={(e) => setNewPassword2(e.target.value)} required minLength={8} />
            </Field>
          </>
        ) : needsOtp ? (
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
          {needsOtp ? "확인" : needsNewPassword ? "비밀번호 정하고 로그인" : "로그인"}
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
