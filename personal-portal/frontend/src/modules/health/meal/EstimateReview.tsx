import { useState } from "react";
import { XIcon } from "lucide-react";
import { MEAL_TYPES, type MealType, type Nutrition, sumTotals, useCreateMeals, useSaveFood } from "@/api/meals";
import { NativeSelect } from "@/components/NativeSelect";
import { ErrorAlert } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NutritionRow } from "./NutritionRow";

type Row = Nutrition & { key: number; saveAsFood: boolean };

type Props = {
  title: string;
  description: string;
  items: Nutrition[];
  date: string;
  meal: MealType;
  method: "ai" | "manual" | "food";
  onClose: () => void;
};

/** 저장 전 확인 카드 (DESIGN.md 6.3 AI 추정 흐름 4~5단계): 수정 → 저장, "내 음식에 추가" 선택 */
export function EstimateReview({ title, description, items, date, meal: initialMeal, method, onClose }: Props) {
  const [rows, setRows] = useState<Row[]>(items.map((i, key) => ({ ...i, key, saveAsFood: false })));
  const [meal, setMeal] = useState<MealType>(initialMeal);
  const createMeals = useCreateMeals();
  const saveFood = useSaveFood();
  const total = sumTotals(rows);

  const save = async () => {
    const clean = rows.filter((r) => r.name.trim()).map(({ key: _key, saveAsFood: _s, ...n }) => ({ ...n, name: n.name.trim() }));
    await createMeals.mutateAsync({ date, meal, method, items: clean });
    // "내 음식"은 먹은 양 그대로 1회 제공량으로 저장 (다음부터 자동완성)
    for (const r of rows.filter((x) => x.saveAsFood && x.name.trim())) {
      await saveFood.mutateAsync({ name: r.name.trim(), basis: "serving", servingGrams: r.grams ?? null, kcal: r.kcal, carb: r.carb, protein: r.protein, fat: r.fat });
    }
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">음식을 찾지 못했습니다. 음식 이름과 양을 적어 다시 시도하세요.</p>
        ) : (
          <div className="grid gap-4">
            {rows.map((r, idx) => (
              <div key={r.key} className="grid gap-1.5 rounded-lg border p-2">
                <div className="flex items-start gap-1">
                  <div className="flex-1">
                    <NutritionRow value={r} onChange={(v) => setRows((all) => all.map((x, i) => (i === idx ? { ...x, ...v } : x)))} />
                  </div>
                  <Button size="icon-xs" variant="ghost" aria-label="이 항목 빼기" onClick={() => setRows((all) => all.filter((_, i) => i !== idx))}>
                    <XIcon />
                  </Button>
                </div>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={r.saveAsFood}
                    onChange={(e) => setRows((all) => all.map((x, i) => (i === idx ? { ...x, saveAsFood: e.target.checked } : x)))}
                  />
                  내 음식에 추가 (다음부터 AI 없이 입력)
                </label>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <NativeSelect aria-label="끼니" value={meal} onChange={(e) => setMeal(e.target.value as MealType)}>
            {MEAL_TYPES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </NativeSelect>
          <span className="tabular-nums text-muted-foreground">
            합계 <b className="text-foreground">{Math.round(total.kcal)}</b> kcal · 탄 {Math.round(total.carb)} / 단 {Math.round(total.protein)} / 지 {Math.round(total.fat)}
          </span>
        </div>
        <ErrorAlert error={createMeals.error ?? saveFood.error} />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button disabled={rows.length === 0 || createMeals.isPending || saveFood.isPending} onClick={() => void save()}>
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
