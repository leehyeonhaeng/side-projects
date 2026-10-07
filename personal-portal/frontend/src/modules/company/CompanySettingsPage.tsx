import { useState } from "react";
import { type CompanyInfo, VAT_LABEL, type VatMode, useCompanyMutations, useDocMutations, useSeal } from "@/api/company";
import { NativeSelect } from "@/components/NativeSelect";
import { ErrorAlert, FormError } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCompanyOutlet } from "./CompanyLayout";

type Form = Required<Omit<CompanyInfo, "id" | "createdAt" | "vatDefault" | "overdueDays">> & { vatDefault: VatMode; overdueDays: string };

const FIELDS: { key: keyof Omit<Form, "vatDefault" | "overdueDays">; label: string; placeholder?: string; wide?: boolean }[] = [
  { key: "name", label: "상호" },
  { key: "bizNo", label: "사업자등록번호", placeholder: "123-45-67890" },
  { key: "ceo", label: "대표자" },
  { key: "bizType", label: "업태", placeholder: "도소매, 서비스" },
  { key: "bizItem", label: "종목", placeholder: "사무기기 임대" },
  { key: "phone", label: "전화" },
  { key: "fax", label: "팩스" },
  { key: "email", label: "이메일" },
  { key: "address", label: "주소", wide: true },
  { key: "bankAccount", label: "입금 계좌 (문서에 표시)", placeholder: "OO은행 123-456-789012 (예금주)", wide: true },
  { key: "assetPrefix", label: "기기 고유번호 앞글자 (영문 대문자·숫자 5자 이내)", placeholder: "A → A-000001" },
];

/** 회사 정보·직인: 영수증·명세서에 찍히는 값 (COMPANY.md 7장) */
export function CompanySettingsPage() {
  const { cid, detail } = useCompanyOutlet();
  const canEdit = detail.me.perms.settings === "edit";
  const c = detail.company;
  const [form, setForm] = useState<Form>(() => ({
    name: c.name,
    bizNo: c.bizNo ?? "",
    ceo: c.ceo ?? "",
    address: c.address ?? "",
    phone: c.phone ?? "",
    fax: c.fax ?? "",
    email: c.email ?? "",
    bizType: c.bizType ?? "",
    bizItem: c.bizItem ?? "",
    bankAccount: c.bankAccount ?? "",
    assetPrefix: c.assetPrefix ?? "",
    vatDefault: c.vatDefault,
    overdueDays: String(c.overdueDays ?? 30),
  }));
  const [saved, setSaved] = useState(false);
  const mut = useCompanyMutations(cid);

  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 md:p-6">
      <h1 className="text-xl font-bold tracking-tight">회사 설정</h1>
      <form
        className="grid gap-4 rounded-2xl border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          mut.patchCompany.mutate(
            { ...Object.fromEntries(Object.entries(form).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v])), overdueDays: Math.min(365, Math.max(1, Number(form.overdueDays) || 30)) },
            { onSuccess: () => setSaved(true) },
          );
        }}
      >
        <p className="text-sm font-medium">회사 정보 <span className="font-normal text-muted-foreground">— 영수증·거래명세서에 표시됩니다</span></p>
        <div className="grid gap-3 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <label key={f.key} className={`grid gap-1 text-xs text-muted-foreground ${f.wide ? "sm:col-span-2" : ""}`}>
              {f.label}
              <Input value={form[f.key]} placeholder={f.placeholder} readOnly={!canEdit} required={f.key === "name"} maxLength={f.key === "address" ? 200 : 100} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
            </label>
          ))}
          <label className="grid gap-1 text-xs text-muted-foreground">
            금액 입력 기본값
            <NativeSelect value={form.vatDefault} disabled={!canEdit} onChange={(e) => setForm({ ...form, vatDefault: e.target.value as VatMode })} className="h-9">
              {(Object.keys(VAT_LABEL) as VatMode[]).map((v) => (
                <option key={v} value={v}>
                  {VAT_LABEL[v]}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            연체로 보는 날 (청구 후 며칠, 알림·대시보드)
            <Input inputMode="numeric" value={form.overdueDays} readOnly={!canEdit} onChange={(e) => setForm({ ...form, overdueDays: e.target.value.replace(/\D/g, "") })} />
          </label>
        </div>
        <ErrorAlert error={mut.patchCompany.error} />
        {canEdit && (
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={!form.name.trim() || mut.patchCompany.isPending}>
              저장
            </Button>
            {saved && <span className="text-sm text-muted-foreground">저장했습니다.</span>}
          </div>
        )}
      </form>
      <SealSettings cid={cid} canEdit={canEdit} companyName={c.name} />
    </main>
  );
}

/** 예시 직인 (올린 직인이 없을 때 문서에 찍히는 모양과 같게) */
export function ExampleSeal({ name, size = 96 }: { name: string; size?: number }) {
  const chars = [...(name || "회사").slice(0, 12)];
  const weights = chars.map((ch) => (ch === " " ? 0.5 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const step = Math.min(300 / Math.max(total, 1), 38);
  let angle = 90 + (step * (total - (weights[0] ?? 1))) / 2;
  return (
    <svg viewBox="-50 -50 100 100" width={size} height={size} aria-label="예시 직인" className="shrink-0">
      <circle r="46" fill="none" stroke="#d11f1f" strokeWidth="3.2" />
      <circle r="26" fill="none" stroke="#d11f1f" strokeWidth="1.4" />
      {chars.map((ch, i) => {
        const a = angle;
        angle -= step * (weights[i] ?? 1);
        if (ch === " ") return null;
        const rad = (a * Math.PI) / 180;
        const x = Math.cos(rad) * 35.5;
        const y = -Math.sin(rad) * 35.5;
        return (
          <text key={i} x={x} y={y} transform={`rotate(${90 - a} ${x} ${y})`} fontSize="15.5" fontWeight="700" fill="#d11f1f" textAnchor="middle" dominantBaseline="central">
            {ch}
          </text>
        );
      })}
      <text y="-4" fontSize="10.5" fontWeight="700" fill="#d11f1f" textAnchor="middle">대표</text>
      <text y="10" fontSize="10.5" fontWeight="700" fill="#d11f1f" textAnchor="middle">인</text>
    </svg>
  );
}

function SealSettings({ cid, canEdit, companyName }: { cid: string; canEdit: boolean; companyName: string }) {
  const seal = useSeal(cid);
  const mut = useDocMutations(cid);
  const [error, setError] = useState<string | null>(null);
  const pick = (f: File | undefined) => {
    setError(null);
    if (!f) return;
    if (!/^image\/(png|jpeg)$/.test(f.type)) return setError("PNG 또는 JPG 이미지만 올릴 수 있습니다.");
    if (f.size > 1_000_000) return setError("1MB 이하 이미지만 올릴 수 있습니다.");
    const reader = new FileReader();
    reader.onload = () => mut.putSeal.mutate(String(reader.result));
    reader.readAsDataURL(f);
  };
  return (
    <section className="grid gap-3 rounded-2xl border bg-card p-4">
      <p className="text-sm font-medium">
        직인 <span className="font-normal text-muted-foreground">— 영수증·명세서·청구서·작업 확인서에 찍힙니다</span>
      </p>
      <div className="flex flex-wrap items-center gap-4">
        {seal.data?.data ? <img src={`data:image/png;base64,${seal.data.data}`} alt="회사 직인" className="size-24 rounded-lg border object-contain p-1" /> : <ExampleSeal name={companyName} />}
        <div className="grid min-w-0 flex-1 gap-1 text-sm">
          <p>{seal.data?.data ? "올린 직인을 쓰고 있습니다." : "예시 직인을 쓰고 있습니다. 실제 직인을 올리면 바뀝니다."}</p>
          <p className="text-xs text-muted-foreground">배경이 투명한 PNG가 가장 깔끔합니다. 바꿔도 이미 발행한 문서는 그때 직인 그대로입니다.</p>
        </div>
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" nativeButton={false} disabled={mut.putSeal.isPending} render={<label />}>
            직인 이미지 올리기
            <input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={(e) => (pick(e.target.files?.[0]), (e.target.value = ""))} />
          </Button>
          {seal.data?.data && (
            <Button variant="ghost" size="sm" disabled={mut.deleteSeal.isPending} onClick={() => mut.deleteSeal.mutate()}>
              예시 직인으로 되돌리기
            </Button>
          )}
        </div>
      )}
      <FormError message={error} />
      <ErrorAlert error={mut.putSeal.error ?? mut.deleteSeal.error ?? seal.error} />
    </section>
  );
}
