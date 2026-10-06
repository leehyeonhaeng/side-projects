import type { ReactNode } from "react";
import { SearchIcon } from "lucide-react";
import { type AssetStatus, ASSET_STATUS_LABEL, ASSET_STATUS_TONE } from "@/api/company";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** 회사 화면 공통 조각 (행컴퍼니) */

export function PageHead({ title, sub, action }: { title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-bold tracking-tight">{title}</h1>
        {sub && <p className="text-sm text-muted-foreground">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function Search({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative min-w-0 flex-1">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-9 pl-8" />
    </div>
  );
}

export function Field({ label, children, wide, hint }: { label: string; children: ReactNode; wide?: boolean; hint?: string }) {
  return (
    <label className={cn("grid content-start gap-1 text-xs text-muted-foreground", wide && "sm:col-span-2")}>
      {label}
      {children}
      {hint && <span className="text-[11px]">{hint}</span>}
    </label>
  );
}

export function StatusBadge({ status }: { status: AssetStatus }) {
  return <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", ASSET_STATUS_TONE[status])}>{ASSET_STATUS_LABEL[status]}</span>;
}

export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn("h-7 shrink-0 rounded-full border px-2.5 text-xs", on ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
    >
      {children}
    </button>
  );
}

/** 금액 (금액 보기가 꺼져 있으면 값이 undefined라 "—") */
export const money = (n?: number) => (n === undefined ? "—" : `${Math.round(n).toLocaleString("ko-KR")}원`);

/** 여러 단어 모두 포함 검색 */
export function matches(text: string, q: string) {
  const t = text.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => t.includes(w));
}
