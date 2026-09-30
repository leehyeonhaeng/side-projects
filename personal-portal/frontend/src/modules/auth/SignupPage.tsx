import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router";
import { signUp } from "aws-amplify/auth";
import { authErrorMessage, normalizeEmail, PASSWORD_RULE } from "@/auth/errors";
import { FormError } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AuthCard, Field } from "./AuthCard";

export function SignupPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "", note: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (form.password !== form.confirm) {
      setError("비밀번호가 서로 다릅니다.");
      return;
    }
    const email = normalizeEmail(form.email);
    setBusy(true);
    try {
      await signUp({
        username: email,
        password: form.password,
        options: {
          userAttributes: { email, name: form.name.trim(), "custom:signup_note": form.note.trim() },
        },
      });
      navigate(`/signup/confirm?email=${encodeURIComponent(email)}`);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title="가입 신청" description="이메일 인증 후 관리자가 승인하면 로그인할 수 있습니다.">
      <form className="grid gap-4" onSubmit={(e) => void onSubmit(e)}>
        <Field id="name" label="이름">
          <Input id="name" autoComplete="name" maxLength={50} value={form.name} onChange={set("name")} required />
        </Field>
        <Field id="email" label="이메일">
          <Input id="email" type="email" autoComplete="email" value={form.email} onChange={set("email")} required />
        </Field>
        <Field id="password" label="비밀번호" hint={PASSWORD_RULE}>
          <Input id="password" type="password" autoComplete="new-password" minLength={8} value={form.password} onChange={set("password")} required />
        </Field>
        <Field id="confirm" label="비밀번호 확인">
          <Input id="confirm" type="password" autoComplete="new-password" value={form.confirm} onChange={set("confirm")} required />
        </Field>
        <Field id="note" label="가입 메모 (선택)" hint="관리자에게 전할 한 줄 (예: 누구인지)">
          <Textarea id="note" rows={2} maxLength={200} value={form.note} onChange={set("note")} />
        </Field>
        <FormError message={error} />
        <Button type="submit" size="lg" disabled={busy}>
          가입 신청
        </Button>
      </form>
      <p className="mt-4 text-sm">
        이미 계정이 있나요?{" "}
        <Link to="/login" className="underline underline-offset-4">
          로그인
        </Link>
      </p>
    </AuthCard>
  );
}
