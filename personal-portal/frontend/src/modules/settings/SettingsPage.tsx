import { type FormEvent, type ReactNode, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { updateMFAPreference, updatePassword } from "aws-amplify/auth";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useMe } from "@/api/me";
import { type ThemePref, usePatchSettings, useSettings, useUpdateName } from "@/api/preferences";
import { PASSWORD_RULE, authErrorMessage } from "@/auth/errors";
import { useTotpEnabled } from "@/auth/session";
import { TotpSetup } from "@/auth/TotpSetup";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ErrorAlert, FormError, InlineSpinner } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { setTheme } from "@/lib/theme";

/** DESIGN.md 5장 /settings: 프로필, 테마, 비밀번호, MFA (목표치는 Phase 5) */
export function SettingsPage() {
  const me = useMe();
  if (!me.data) return <InlineSpinner />;
  return (
    <main className="mx-auto grid max-w-2xl gap-4 p-4 pb-24 sm:pb-8">
      <h1 className="text-xl font-semibold">설정</h1>
      <ThemeCard />
      {me.data.perms.health !== "none" && <GoalsCard />}
      <ProfileCard name={me.data.name} email={me.data.email} />
      <PasswordCard />
      <MfaCard email={me.data.email} isHost={me.data.isHost} />
    </main>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

const THEMES: { value: ThemePref; label: string; icon: ReactNode }[] = [
  { value: "system", label: "시스템", icon: <MonitorIcon data-icon="inline-start" /> },
  { value: "light", label: "라이트", icon: <SunIcon data-icon="inline-start" /> },
  { value: "dark", label: "다크", icon: <MoonIcon data-icon="inline-start" /> },
];

function ThemeCard() {
  const settings = useSettings();
  const patch = usePatchSettings();
  const current = settings.data?.theme ?? "system";

  return (
    <Section title="테마" description="모든 기기에 같이 적용됩니다.">
      <div className="flex flex-wrap gap-1">
        {THEMES.map((t) => (
          <Button
            key={t.value}
            size="sm"
            variant={current === t.value ? "default" : "outline"}
            disabled={patch.isPending}
            onClick={() => {
              setTheme(t.value);
              patch.mutate({ theme: t.value });
            }}
          >
            {t.icon}
            {t.label}
          </Button>
        ))}
      </div>
      <ErrorAlert error={patch.error} />
    </Section>
  );
}

function ProfileCard({ name, email }: { name: string; email: string }) {
  const [value, setValue] = useState(name);
  const update = useUpdateName();
  const trimmed = value.trim();

  return (
    <Section title="프로필" description={email}>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate(trimmed);
        }}
      >
        <Input aria-label="이름" value={value} maxLength={50} onChange={(e) => setValue(e.target.value)} className="max-w-xs" />
        <Button type="submit" disabled={!trimmed || trimmed === name || update.isPending}>
          이름 변경
        </Button>
      </form>
      <ErrorAlert error={update.error} />
    </Section>
  );
}

function PasswordCard() {
  const [form, setForm] = useState({ old: "", next: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (form.next !== form.confirm) {
      setError("새 비밀번호가 서로 다릅니다.");
      return;
    }
    setBusy(true);
    try {
      await updatePassword({ oldPassword: form.old, newPassword: form.next });
      setForm({ old: "", next: "", confirm: "" });
      setDone(true);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const field = (key: keyof typeof form, label: string, auto: string) => (
    <Input
      aria-label={label}
      placeholder={label}
      type="password"
      autoComplete={auto}
      value={form[key]}
      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
      required
    />
  );

  return (
    <Section title="비밀번호 변경" description={PASSWORD_RULE}>
      <form className="grid max-w-xs gap-2" onSubmit={(e) => void onSubmit(e)}>
        {field("old", "현재 비밀번호", "current-password")}
        {field("next", "새 비밀번호", "new-password")}
        {field("confirm", "새 비밀번호 확인", "new-password")}
        <FormError message={error} />
        {done && <p className="text-sm text-muted-foreground">비밀번호를 바꿨습니다.</p>}
        <Button type="submit" disabled={busy}>
          변경
        </Button>
      </form>
    </Section>
  );
}

function MfaCard({ email, isHost }: { email: string; isHost: boolean }) {
  const qc = useQueryClient();
  const enabled = useTotpEnabled(true);
  const [setting, setSetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disable = async () => {
    setError(null);
    try {
      await updateMFAPreference({ totp: "DISABLED" });
      qc.setQueryData(["mfa"], false);
    } catch (err) {
      setError(authErrorMessage(err));
    }
  };

  return (
    <Section title="2단계 인증 (OTP)" description="로그인할 때 OTP 앱의 6자리 코드를 한 번 더 확인합니다.">
      {enabled.isPending ? (
        <InlineSpinner />
      ) : enabled.data ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">사용 중</Badge>
          {isHost ? (
            <span className="text-xs text-muted-foreground">관리자 계정은 해제할 수 없습니다.</span>
          ) : (
            <ConfirmButton
              size="sm"
              variant="outline"
              title="2단계 인증을 해제할까요?"
              description="다음 로그인부터 OTP 코드를 묻지 않습니다."
              confirmLabel="해제"
              onConfirm={disable}
            >
              해제
            </ConfirmButton>
          )}
        </div>
      ) : setting ? (
        <TotpSetup email={email} onDone={() => setSetting(false)} />
      ) : (
        <Button size="sm" onClick={() => setSetting(true)}>
          OTP 등록
        </Button>
      )}
      <FormError message={error} />
    </Section>
  );
}

const GOALS = [
  { key: "goalKcal", label: "칼로리", unit: "kcal" },
  { key: "goalCarb", label: "탄수화물", unit: "g" },
  { key: "goalProtein", label: "단백질", unit: "g" },
  { key: "goalFat", label: "지방", unit: "g" },
] as const;

/** 식단 목표 (DESIGN.md 6.3). 비워두면 목표 없음 */
function GoalsCard() {
  const settings = useSettings();
  const patch = usePatchSettings();
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  if (!settings.data) return null;
  const values = draft ?? Object.fromEntries(GOALS.map((g) => [g.key, settings.data[g.key]?.toString() ?? ""]));

  return (
    <Section title="식단 목표" description="식단 화면의 게이지와 남은 칼로리 계산에 쓰입니다. 비워두면 목표 없음.">
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const body = Object.fromEntries(GOALS.map((g) => [g.key, values[g.key] === "" ? null : Math.round(Number(values[g.key]))]));
          patch.mutate(body, { onSuccess: () => setDraft(null) });
        }}
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {GOALS.map((g) => (
            <label key={g.key} className="grid gap-1 text-xs text-muted-foreground">
              {g.label} ({g.unit})
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={20000}
                value={values[g.key]}
                onChange={(e) => setDraft({ ...values, [g.key]: e.target.value })}
              />
            </label>
          ))}
        </div>
        <Button type="submit" size="sm" className="justify-self-start" disabled={!draft || patch.isPending}>
          저장
        </Button>
      </form>
      <ErrorAlert error={patch.error} />
    </Section>
  );
}
