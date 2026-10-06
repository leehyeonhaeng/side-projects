import { useState } from "react";
import { Link } from "react-router";
import { AlertTriangleIcon, PlusIcon } from "lucide-react";
import { ITEM_CATEGORIES, type Item, type Tracking, useItems, useMasterMutations } from "@/api/company";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useCompanyOutlet } from "./CompanyLayout";
import { Chip, Field, PageHead, Search, matches, money } from "./ui";

type Filter = "all" | Tracking | "low";
const isLow = (i: Item) => i.tracking === "stock" && i.minStock !== undefined && i.minStock > 0 && (i.qty ?? 0) < i.minStock;

/** 품목·재고 (COMPANY.md 4장): 개체 관리(기기 모델) / 수량 관리(소모품·부품) */
export function ItemsPage() {
  const { cid, detail } = useCompanyOutlet();
  const canEdit = detail.me.perms.items === "edit";
  const items = useItems(cid);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Item | "new" | null>(null);

  const all = items.data ?? [];
  const shown = all
    .filter((i) => showInactive || i.active)
    .filter((i) => (filter === "all" ? true : filter === "low" ? isLow(i) : i.tracking === filter))
    .filter((i) => matches([i.name, i.category, i.maker, i.modelNo, i.spec].join(" "), q));
  const groups = [...new Set(shown.map((i) => i.category || "기타"))];
  const lowCount = all.filter((i) => i.active && isLow(i)).length;

  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 md:p-6">
      <PageHead
        title="품목·재고"
        sub={`기기 모델 ${all.filter((i) => i.tracking === "asset" && i.active).length} · 소모품·부품 ${all.filter((i) => i.tracking === "stock" && i.active).length}`}
        action={
          canEdit && (
            <Button onClick={() => setEditing("new")}>
              <PlusIcon /> 품목 추가
            </Button>
          )
        }
      />
      <Search value={q} onChange={setQ} placeholder="품목명·분류·제조사·모델 검색" />
      <div className="flex flex-wrap gap-1">
        <Chip on={filter === "all"} onClick={() => setFilter("all")}>
          전체
        </Chip>
        <Chip on={filter === "asset"} onClick={() => setFilter("asset")}>
          기기 모델
        </Chip>
        <Chip on={filter === "stock"} onClick={() => setFilter("stock")}>
          소모품·부품
        </Chip>
        <Chip on={filter === "low"} onClick={() => setFilter("low")}>
          재고 부족 {lowCount > 0 && lowCount}
        </Chip>
        <Chip on={showInactive} onClick={() => setShowInactive(!showInactive)}>
          사용 안 함 포함
        </Chip>
      </div>

      {items.isPending ? (
        <InlineSpinner />
      ) : items.isError ? (
        <ErrorAlert error={items.error} />
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{all.length ? "조건에 맞는 품목이 없습니다." : "품목을 추가하세요. 복합기·프린터처럼 한 대씩 관리할 것은 '기기 모델', 토너·용지처럼 개수로 관리할 것은 '소모품·부품'으로."}</p>
      ) : (
        groups.map((g) => (
          <section key={g} className="grid gap-1.5">
            <h2 className="text-xs font-medium text-muted-foreground">{g}</h2>
            <ul className="grid gap-1.5">
              {shown
                .filter((i) => (i.category || "기타") === g)
                .map((i) => (
                  <li key={i.id} className={cn("flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5", !i.active && "opacity-60")}>
                    <button type="button" disabled={!canEdit} onClick={() => setEditing(i)} className="min-w-0 flex-1 text-left">
                        <span className="block truncate text-sm font-medium">{i.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[i.maker, i.modelNo, i.tracking === "asset" ? i.rentPrice !== undefined && `월 ${money(i.rentPrice)}` : i.price !== undefined && money(i.price)].filter(Boolean).join(" · ")}
                        </span>
                    </button>
                      {i.tracking === "asset" ? (
                        <Link to={`/company/${cid}/assets?item=${i.id}`} className="shrink-0 rounded-lg px-1 text-right text-xs tabular-nums hover:bg-muted">
                          <span className="block font-medium">{(i.assetCounts?.in_stock ?? 0) + (i.assetCounts?.rented ?? 0) + (i.assetCounts?.repair ?? 0)}대</span>
                          <span className="block text-muted-foreground">임대 {i.assetCounts?.rented ?? 0} · 창고 {i.assetCounts?.in_stock ?? 0}</span>
                        </Link>
                      ) : (
                        <span className={cn("shrink-0 text-right text-sm font-medium tabular-nums", isLow(i) && "text-red-600 dark:text-red-400")}>
                          {isLow(i) && <AlertTriangleIcon className="mr-1 inline size-3.5" />}
                          {i.qty ?? 0}
                          {i.unit}
                          {i.minStock ? <span className="block text-[11px] font-normal text-muted-foreground">최소 {i.minStock}</span> : null}
                        </span>
                      )}
                  </li>
                ))}
            </ul>
          </section>
        ))
      )}
      {editing && <ItemDialog key={editing === "new" ? "new" : editing.id} cid={cid} item={editing === "new" ? null : editing} models={all.filter((i) => i.tracking === "asset")} showAmounts={detail.me.showAmounts} onClose={() => setEditing(null)} />}
    </main>
  );
}

const num = (v: string) => (v.trim() === "" ? undefined : Number(v.replace(/,/g, "")));

function ItemDialog({ cid, item, models, showAmounts, onClose }: { cid: string; item: Item | null; models: Item[]; showAmounts: boolean; onClose: () => void }) {
  const [tracking, setTracking] = useState<Tracking>(item?.tracking ?? "stock");
  const [f, setF] = useState({
    name: item?.name ?? "",
    category: item?.category ?? "",
    maker: item?.maker ?? "",
    modelNo: item?.modelNo ?? "",
    spec: item?.spec ?? "",
    unit: item?.unit ?? "",
    price: item?.price?.toString() ?? "",
    rentPrice: item?.rentPrice?.toString() ?? "",
    cost: item?.cost?.toString() ?? "",
    minStock: item?.minStock?.toString() ?? "",
    openingQty: "",
    memo: item?.memo ?? "",
  });
  const [compat, setCompat] = useState<string[]>(item?.compatibleWith ?? []);
  const mut = useMasterMutations(cid);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const isAsset = tracking === "asset";

  const save = () => {
    const body = {
      name: f.name.trim(),
      category: f.category.trim(),
      maker: f.maker.trim(),
      modelNo: f.modelNo.trim(),
      spec: f.spec.trim(),
      unit: f.unit.trim() || (isAsset ? "대" : "개"),
      memo: f.memo.trim(),
      ...(showAmounts ? { price: num(f.price), cost: num(f.cost), ...(isAsset ? { rentPrice: num(f.rentPrice) } : {}) } : {}),
      ...(!isAsset ? { minStock: num(f.minStock), compatibleWith: compat } : {}),
    };
    if (item) mut.patchItem.mutate({ id: item.id, ...body }, { onSuccess: onClose });
    else mut.createItem.mutate({ ...body, tracking, ...(!isAsset && f.openingQty ? { openingQty: num(f.openingQty) } : {}) }, { onSuccess: onClose });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{item ? "품목 수정" : "품목 추가"}</DialogTitle>
        </DialogHeader>
        {!item && (
          <div className="grid grid-cols-2 gap-2">
            {(["asset", "stock"] as const).map((t) => (
              <button key={t} type="button" aria-pressed={tracking === t} onClick={() => setTracking(t)} className={cn("grid gap-0.5 rounded-xl border p-3 text-left", tracking === t ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50")}>
                <span className="text-sm font-medium">{t === "asset" ? "기기 모델" : "소모품·부품"}</span>
                <span className="text-[11px] text-muted-foreground">{t === "asset" ? "복합기·프린터 — 한 대씩 고유번호로 관리, 임대" : "토너·잉크·용지·부품 — 개수로 관리, 판매"}</span>
              </button>
            ))}
          </div>
        )}
        <form
          id="item-form"
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Field label="품목명 *" wide>
            <Input autoFocus required maxLength={80} placeholder={isAsset ? "예: 신도리코 D420 컬러복합기" : "예: D420 토너 검정"} value={f.name} onChange={set("name")} />
          </Field>
          <Field label="분류">
            <Input list="item-categories" maxLength={30} value={f.category} onChange={set("category")} />
            <datalist id="item-categories">
              {ITEM_CATEGORIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="단위">
            <Input maxLength={10} placeholder={isAsset ? "대" : "개, 박스, 병, 권"} value={f.unit} onChange={set("unit")} />
          </Field>
          <Field label="제조사">
            <Input maxLength={30} value={f.maker} onChange={set("maker")} />
          </Field>
          <Field label="모델 번호">
            <Input maxLength={40} value={f.modelNo} onChange={set("modelNo")} />
          </Field>
          <Field label="규격·설명" wide>
            <Input maxLength={200} placeholder={isAsset ? "A3 컬러, 분당 42매" : "약 12,000매 출력"} value={f.spec} onChange={set("spec")} />
          </Field>
          {showAmounts && (
            <>
              {isAsset && (
                <Field label="기본 월 임대료 (원)" hint="계약마다 다르게 정할 수 있는 기본값">
                  <Input inputMode="numeric" value={f.rentPrice} onChange={set("rentPrice")} />
                </Field>
              )}
              <Field label="판매 정가 (원)">
                <Input inputMode="numeric" value={f.price} onChange={set("price")} />
              </Field>
              <Field label="기준 매입가 (원)">
                <Input inputMode="numeric" value={f.cost} onChange={set("cost")} />
              </Field>
            </>
          )}
          {!isAsset && (
            <>
              {!item && (
                <Field label="기초 재고" hint="지금 가지고 있는 수량. 이후 재고는 거래로만 바뀝니다">
                  <Input inputMode="decimal" value={f.openingQty} onChange={set("openingQty")} />
                </Field>
              )}
              <Field label="최소 재고" hint="이보다 적으면 '재고 부족'">
                <Input inputMode="decimal" value={f.minStock} onChange={set("minStock")} />
              </Field>
              {models.length > 0 && (
                <Field label="호환 기종" wide hint="이 소모품을 쓰는 기기 모델">
                  <div className="flex flex-wrap gap-1">
                    {models.map((m) => (
                      <Chip key={m.id} on={compat.includes(m.id)} onClick={() => setCompat(compat.includes(m.id) ? compat.filter((x) => x !== m.id) : [...compat, m.id])}>
                        {m.name}
                      </Chip>
                    ))}
                  </div>
                </Field>
              )}
            </>
          )}
          <Field label="메모" wide>
            <Textarea rows={2} maxLength={1000} value={f.memo} onChange={set("memo")} />
          </Field>
        </form>
        {item && !isAsset && <p className="text-xs text-muted-foreground">현재 재고 {item.qty ?? 0}{item.unit} — 재고는 판매·매입·조정 거래(C3)로 바뀝니다.</p>}
        <ErrorAlert error={mut.createItem.error ?? mut.patchItem.error ?? mut.deleteItem.error} />
        <DialogFooter className="flex-row flex-wrap items-center">
          {item && (
            <>
              <Button type="button" variant="ghost" onClick={() => mut.patchItem.mutate({ id: item.id, active: !item.active }, { onSuccess: onClose })}>
                {item.active ? "사용 안 함" : "다시 사용"}
              </Button>
              <ConfirmButton type="button" variant="ghost" className="mr-auto" title="품목을 삭제할까요?" description="기기나 거래 이력이 있으면 삭제할 수 없고 '사용 안 함'으로 숨겨야 합니다." confirmLabel="삭제" onConfirm={() => mut.deleteItem.mutateAsync(item.id).then(onClose)}>
                삭제
              </ConfirmButton>
            </>
          )}
          <Button type="button" variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" form="item-form" disabled={!f.name.trim() || mut.createItem.isPending || mut.patchItem.isPending}>
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
