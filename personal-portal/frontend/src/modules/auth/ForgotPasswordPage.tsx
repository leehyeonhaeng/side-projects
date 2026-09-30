import { type FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { confirmResetPassword, resetPassword } from "aws-amplify/auth";
import { authErrorMessage, normalizeEmail, PASSWORD_RULE } from "@/auth/errors";
import { FormError } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthCard, Field } from "./AuthCard";

type Step = "request" | "confirm" | "done";

export function ForgotPasswordPage() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [step, setStep] = useState<Step>(params.get("sent") ? "confirm" : "request");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const request = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await resetPassword({ username: normalizeEmail(email) });
      setStep("confirm");
    });
  };

  const confirm = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await confirmResetPassword({ username: normalizeEmail(email), confirmationCode: code.trim(), newPassword: password });
      setStep("done");
    });
  };

  if (step === "done") {
    return (
      <AuthCard title="비밀번호 변경 완료">
        <Button render={<Link to="/login" />} nativeButton={false} size="lg" className="w-full">
          로그인 화면으로
        </Button>
      </AuthCard>
    );
  }

  if (step === "confirm") {
    return (
      <AuthCard title="새 비밀번호 설정" description="메일로 받은 인증 코드와 새 비밀번호를 입력하세요.">
        <form className="grid gap-4" onSubmit={confirm}>
          <Field id="email" label="이메일">
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field id="code" label="인증 코드">
            <Input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required />
          </Field>
          <Field id="password" label="새 비밀번호" hint={PASSWORD_RULE}>
            <Input id="password" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <FormError message={error} />
          <Button type="submit" size="lg" disabled={busy}>
            변경
          </Button>
          <Button type="button" variant="ghost" onClick={() => setStep("request")}>
            코드 다시 받기
          </Button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="비밀번호 찾기" description="가입한 이메일로 인증 코드를 보냅니다.">
      <form className="grid gap-4" onSubmit={request}>
        <Field id="email" label="이메일">
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <FormError message={error} />
        <Button type="submit" size="lg" disabled={busy}>
          코드 받기
        </Button>
      </form>
      <p className="mt-4 text-sm">
        <Link to="/login" className="underline underline-offset-4">
          로그인으로 돌아가기
        </Link>
      </p>
    </AuthCard>
  );
}
