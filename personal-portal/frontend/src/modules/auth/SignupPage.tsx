import { type FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { signUp } from "aws-amplify/auth";
import { authErrorMessage, normalizeEmail, PASSWORD_RULE } from "@/auth/errors";
import { clearPendingInvite, savePendingInvite, useInviteInfo } from "@/api/company";
import { FormError } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AuthCard, Field } from "./AuthCard";

export function SignupPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const inviteCode = params.get("invite");
  const invite = useInviteInfo(inviteCode);
  const invited = Boolean(invite.data);
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
      // 초대 가입: 이메일 인증 화면에서 코드를 같이 보내야 승인 없이 회사 직원이 된다
      if (invited && inviteCode) savePendingInvite(inviteCode);
      else clearPendingInvite();
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
    <AuthCard
      title={invited ? `${invite.data!.companyName} 직원 가입` : "가입 신청"}
      description={invited ? `${invite.data!.roleName}(으)로 초대받았습니다. 이메일 인증만 하면 바로 로그인할 수 있습니다.` : "이메일 인증 후 관리자가 승인하면 로그인할 수 있습니다."}
    >
      {inviteCode && invite.isError && <p className="mb-3 rounded-lg bg-destructive/10 p-2 text-sm text-destructive">초대 링크가 만료되었거나 이미 사용되었습니다. 이대로 가입하면 관리자 승인을 기다려야 합니다.</p>}
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
