import { type FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { OTP_ISSUER } from "@/lib/env";
import { setUpTOTP, updateMFAPreference, verifyTOTPSetup } from "aws-amplify/auth";
import { authErrorMessage } from "@/auth/errors";
import { ErrorAlert, FormError, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** OTP 앱 등록 (QR → 코드 확인 → MFA 기본값으로 설정). Host 강제 등록과 설정 화면에서 같이 쓴다. */
export function TotpSetup({ email, onDone }: { email: string; onDone: () => void }) {
  const qc = useQueryClient();
  // useQuery로 한 번만 발급받는다 (StrictMode에서 두 번 호출되면 앞의 비밀키가 무효가 됨)
  const setup = useQuery({ queryKey: ["totp-setup"], queryFn: setUpTOTP, staleTime: Number.POSITIVE_INFINITY, gcTime: 0, retry: false });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (setup.isPending) return <InlineSpinner />;
  if (setup.isError) return <ErrorAlert error={setup.error} />;

  const uri = setup.data.getSetupUri(OTP_ISSUER, email).toString();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await verifyTOTPSetup({ code: code.trim() });
      await updateMFAPreference({ totp: "PREFERRED" });
      qc.setQueryData(["mfa"], true);
      qc.removeQueries({ queryKey: ["totp-setup"] });
      onDone();
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">OTP 앱(Google Authenticator 등)으로 QR 코드를 스캔하세요.</p>
      <div className="mx-auto rounded-lg bg-white p-3">
        <QRCodeSVG value={uri} size={176} />
      </div>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">QR 스캔이 안 되면 키 직접 입력</summary>
        <code className="mt-2 block break-all rounded bg-muted p-2">{setup.data.sharedSecret}</code>
      </details>
      <form className="grid gap-3" onSubmit={(e) => void onSubmit(e)}>
        <label htmlFor="totp-code" className="text-sm font-medium">
          앱에 표시된 6자리 코드
        </label>
        <Input id="totp-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required />
        <FormError message={error} />
        <Button type="submit" disabled={busy}>
          등록
        </Button>
      </form>
    </div>
  );
}
