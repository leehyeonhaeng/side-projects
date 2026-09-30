import { type FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { confirmSignUp, resendSignUpCode } from "aws-amplify/auth";
import { authErrorMessage, normalizeEmail } from "@/auth/errors";
import { FormError } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthCard, Field } from "./AuthCard";

export function ConfirmSignupPage() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [code, setCode] = useState("");
  const [done, setDone] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await confirmSignUp({ username: normalizeEmail(email), confirmationCode: code.trim() });
      setDone(true);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError(null);
    try {
      await resendSignUpCode({ username: normalizeEmail(email) });
      setNotice("인증 코드를 다시 보냈습니다.");
    } catch (err) {
      setError(authErrorMessage(err));
    }
  };

  if (done) {
    return (
      <AuthCard title="가입 신청 완료" description="이메일 인증이 끝났습니다.">
        <div className="grid gap-4 text-sm">
          <p>관리자가 승인하면 로그인할 수 있습니다. 승인 전에는 로그인 시 "승인 대기 중" 안내가 표시됩니다.</p>
          <Button render={<Link to="/login" />} nativeButton={false} size="lg">
            로그인 화면으로
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="이메일 인증" description="메일로 받은 6자리 인증 코드를 입력하세요.">
      <form className="grid gap-4" onSubmit={(e) => void onSubmit(e)}>
        <Field id="email" label="이메일">
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field id="code" label="인증 코드">
          <Input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required />
        </Field>
        {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
        <FormError message={error} />
        <Button type="submit" size="lg" disabled={busy}>
          인증
        </Button>
        <Button type="button" variant="ghost" disabled={!email} onClick={() => void resend()}>
          코드 다시 받기
        </Button>
      </form>
    </AuthCard>
  );
}
