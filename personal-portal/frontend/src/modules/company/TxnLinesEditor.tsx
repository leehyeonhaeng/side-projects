import { useEffect, useState } from "react";
import { PencilIcon, PlusIcon, XIcon } from "lucide-react";
import { type Item, type LineInput, VAT_LABEL, type VatMode, priceLine } from "@/api/company";
import { NativeSelect } from "@/components/NativeSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { money } from "./ui";

/** 편집 중인 금액 줄. override: 공급가액·세액을 직접 고친 값 (COMPANY.md 6장) */
export type DraftLine = { key: string; itemId: string; name: string; qty: string; unitPrice: string; vatMode: VatMode; override: { supply: string; vat: string } | null; memo: string };

export const newLine = (vatMode: VatMode, item?: Item, priceField: "price" | "cost" | "rentPrice" = "price"): DraftLine => ({
  key: crypto.randomUUID(),
  itemId: item?.id ?? "",
  name: item ? "" : "",
  qty: "1",
  unitPrice: item?.[priceField]?.toString() ?? "",
  vatMode,
  override: null,
  memo: "",
});

const n = (v: string) => Number(v.replace(/,/g, "")) || 0;

export function lineAmounts(l: DraftLine) {
  if (l.override) {
    const supply = n(l.override.supply);
    const vat = n(l.override.vat);
    return { supply, vat, total: supply + vat, manual: true };
  }
  return { ...priceLine(n(l.qty), n(l.unitPrice), l.vatMode), manual: false };
}

export function toLineInput(l: DraftLine, items: Item[]): LineInput {
  const a = lineAmounts(l);
  return {
    itemId: l.itemId || undefined,
    name: l.name.trim() || items.find((i) => i.id === l.itemId)?.name || "",
    qty: n(l.qty),
    unitPrice: n(l.unitPrice),
    vatMode: l.vatMode,
    ...(a.manual ? { supply: a.supply, vat: a.vat } : {}),
    memo: l.memo.trim(),
  };
}

type Props = {
  lines: DraftLine[];
  onChange: (lines: DraftLine[]) => void;
  items: Item[]; // 고를 수 있는 품목 (비면 이름만 입력)
  defaultVat: VatMode;
  priceField?: "price" | "cost" | "rentPrice";
  allowFree?: boolean; // 품목 없이 이름만 쓰는 줄 (청구·설치비 등)
};

/** 금액 줄 편집: 품목·수량·단가·부가세 방식 → 공급가액·세액·합계 제안, 필요하면 직접 수정 */
export function TxnLinesEditor({ lines, onChange, items, defaultVat, priceField = "price", allowFree = true }: Props) {
  const set = (key: string, patch: Partial<DraftLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  // 품목을 꼭 골라야 하는 거래(판매)는 빈 줄에 첫 품목과 그 단가를 채운다
  const first = items[0];
  const needsFill = !allowFree && first !== undefined && lines.some((l) => !l.itemId);
  useEffect(() => {
    if (needsFill && first) onChange(lines.map((l) => (l.itemId ? l : { ...l, itemId: first.id, unitPrice: first[priceField]?.toString() ?? "" })));
  }, [needsFill, first, lines, onChange, priceField]);
  const sum = lines.map(lineAmounts).reduce((s, a) => ({ supply: s.supply + a.supply, vat: s.vat + a.vat, total: s.total + a.total }), { supply: 0, vat: 0, total: 0 });

  return (
    <div className="grid gap-2">
      {lines.map((l, idx) => {
        const a = lineAmounts(l);
        const item = items.find((i) => i.id === l.itemId);
        return (
          <div key={l.key} className="grid gap-2 rounded-xl border bg-muted/20 p-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{idx + 1}</span>
              {items.length > 0 ? (
                <NativeSelect
                  value={l.itemId}
                  onChange={(e) => {
                    const it = items.find((i) => i.id === e.target.value);
                    set(l.key, { itemId: e.target.value, unitPrice: it?.[priceField]?.toString() ?? l.unitPrice });
                  }}
                  className="h-9 min-w-0 flex-1"
                  aria-label="품목"
                >
                  {allowFree && <option value="">직접 입력</option>}
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                      {i.tracking === "stock" ? ` (재고 ${i.qty ?? 0})` : ""}
                    </option>
                  ))}
                </NativeSelect>
              ) : null}
              {(!l.itemId || items.length === 0) && <Input placeholder="내용 (예: 설치비, 3월 임대료)" maxLength={100} value={l.name} onChange={(e) => set(l.key, { name: e.target.value })} className="h-9 min-w-0 flex-1" />}
              {lines.length > 1 && (
                <Button type="button" size="icon-sm" variant="ghost" aria-label="줄 삭제" onClick={() => onChange(lines.filter((x) => x.key !== l.key))}>
                  <XIcon />
                </Button>
              )}
            </div>
            <div className="grid grid-cols-[4.5rem_1fr_7.5rem] gap-2">
              <Input inputMode="decimal" aria-label="수량" value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value, override: null })} className="h-9" />
              <Input inputMode="numeric" aria-label="단가" placeholder="단가" value={l.unitPrice} onChange={(e) => set(l.key, { unitPrice: e.target.value, override: null })} className="h-9" />
              <NativeSelect value={l.vatMode} onChange={(e) => set(l.key, { vatMode: e.target.value as VatMode, override: null })} className="h-9" aria-label="부가세">
                {(Object.keys(VAT_LABEL) as VatMode[]).map((v) => (
                  <option key={v} value={v}>
                    {VAT_LABEL[v].replace("부가세 ", "")}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {item?.unit && <p className="-mt-1 text-[11px] text-muted-foreground">단위 {item.unit}</p>}
            {l.override ? (
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-[11px] text-muted-foreground">
                  공급가액
                  <Input inputMode="numeric" value={l.override.supply} onChange={(e) => set(l.key, { override: { ...l.override!, supply: e.target.value } })} className="h-9" />
                </label>
                <label className="grid gap-1 text-[11px] text-muted-foreground">
                  세액
                  <Input inputMode="numeric" value={l.override.vat} onChange={(e) => set(l.key, { override: { ...l.override!, vat: e.target.value } })} className="h-9" />
                </label>
                <p className="col-span-2 flex items-center justify-between text-xs">
                  <span className="text-amber-600 dark:text-amber-400">직접 수정한 금액</span>
                  <button type="button" className="text-muted-foreground underline" onClick={() => set(l.key, { override: null })}>
                    자동 계산으로
                  </button>
                </p>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 text-xs tabular-nums text-muted-foreground">
                <span>
                  공급 {money(a.supply)} · 세액 {money(a.vat)}
                </span>
                <button type="button" className="flex items-center gap-1 underline" onClick={() => set(l.key, { override: { supply: String(a.supply), vat: String(a.vat) } })}>
                  <PencilIcon className="size-3" /> 직접 수정
                </button>
              </div>
            )}
            <p className="text-right text-sm font-semibold tabular-nums">{money(a.total)}</p>
          </div>
        );
      })}
      <Button type="button" variant="outline" size="sm" className="justify-self-start" disabled={lines.length >= 30} onClick={() => onChange([...lines, newLine(defaultVat)])}>
        <PlusIcon /> 줄 추가
      </Button>
      <div className={cn("grid grid-cols-3 gap-2 rounded-xl bg-muted/50 p-3 text-sm tabular-nums")}>
        <span>
          <span className="block text-[11px] text-muted-foreground">공급가액</span>
          {money(sum.supply)}
        </span>
        <span>
          <span className="block text-[11px] text-muted-foreground">세액</span>
          {money(sum.vat)}
        </span>
        <span className="text-right">
          <span className="block text-[11px] text-muted-foreground">합계</span>
          <b>{money(sum.total)}</b>
        </span>
      </div>
    </div>
  );
}

export function useDraftLines(defaultVat: VatMode) {
  return useState<DraftLine[]>(() => [newLine(defaultVat)]);
}
