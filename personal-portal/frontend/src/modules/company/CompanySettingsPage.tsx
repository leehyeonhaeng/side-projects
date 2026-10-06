import { useState } from "react";
import { type CompanyInfo, VAT_LABEL, type VatMode, useCompanyMutations } from "@/api/company";
import { NativeSelect } from "@/components/NativeSelect";
import { ErrorAlert } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCompanyOutlet } from "./CompanyLayout";

type Form = Required<Omit<CompanyInfo, "id" | "createdAt" | "vatDefault">> & { vatDefault: VatMode };

const FIELDS: { key: keyof Omit<Form, "vatDefault">; label: string; placeholder?: string; wide?: boolean }[] = [
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
];

/** 회사 정보: 영수증·명세서에 찍히는 값 (COMPANY.md 7장). 직인·문서 번호는 C5 */
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
    vatDefault: c.vatDefault,
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
            Object.fromEntries(Object.entries(form).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v])),
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
      <p className="text-xs text-muted-foreground">직인 이미지, 문서 번호 형식은 문서 기능(C5)과 함께 추가됩니다.</p>
    </main>
  );
}
