import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { setUpTOTP, updateMFAPreference, verifyTOTPSetup } from "aws-amplify/auth";
import { useMe } from "@/api/me";
import { authErrorMessage } from "@/auth/errors";
import { ErrorAlert, FormError, PageSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthCard, Field } from "./AuthCard";

/** Host는 첫 로그인 때 TOTP(OTP 앱) 등록을 반드시 거친다 (DESIGN.md 4.1) */
export function MfaSetupPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  // useQuery로 한 번만 발급받는다 (StrictMode에서 두 번 호출되면 앞의 비밀키가 무효가 됨)
  const setup = useQuery({ queryKey: ["totp-setup"], queryFn: setUpTOTP, staleTime: Number.POSITIVE_INFINITY, gcTime: 0, retry: false });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (setup.isPending || me.isPending) return <PageSpinner />;
  if (setup.isError) {
    return (
      <AuthCard title="OTP 등록">
        <ErrorAlert error={setup.error} />
      </AuthCard>
    );
  }

  const uri = setup.data.getSetupUri("Personal Portal", me.data?.email).toString();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await verifyTOTPSetup({ code: code.trim() });
      await updateMFAPreference({ totp: "PREFERRED" });
      qc.setQueryData(["mfa"], true);
      navigate("/admin", { replace: true });
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title="OTP 등록" description="관리자 계정은 2단계 인증이 필수입니다. OTP 앱(Google Authenticator 등)으로 QR 코드를 스캔하세요.">
      <div className="grid gap-4">
        <div className="mx-auto rounded-lg bg-white p-3">
          <QRCodeSVG value={uri} size={176} />
        </div>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">QR 스캔이 안 되면 키 직접 입력</summary>
          <code className="mt-2 block break-all rounded bg-muted p-2">{setup.data.sharedSecret}</code>
        </details>
        <form className="grid gap-4" onSubmit={(e) => void onSubmit(e)}>
          <Field id="code" label="앱에 표시된 6자리 코드">
            <Input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required />
          </Field>
          <FormError message={error} />
          <Button type="submit" size="lg" disabled={busy}>
            등록
          </Button>
        </form>
      </div>
    </AuthCard>
  );
}
