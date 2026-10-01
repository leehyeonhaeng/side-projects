import { useState } from "react";
import { MEAL_TYPES, type Meal, type MealType, type Nutrition, useDeleteMeal, useUpdateMeal } from "@/api/meals";
import { ConfirmButton } from "@/components/ConfirmButton";
import { NativeSelect } from "@/components/NativeSelect";
import { ErrorAlert } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NutritionRow } from "./NutritionRow";

/** 저장된 식단 항목 수정·삭제 (끼니·날짜 이동 포함) */
export function MealItemDialog({ meal, readOnly, onClose }: { meal: Meal; readOnly: boolean; onClose: () => void }) {
  const [value, setValue] = useState<Nutrition>(meal);
  const [mealType, setMealType] = useState<MealType>(meal.meal);
  const [date, setDate] = useState(meal.date);
  const update = useUpdateMeal();
  const remove = useDeleteMeal();

  const save = () =>
    update.mutate(
      {
        meal,
        patch: { name: value.name.trim(), grams: value.grams ?? null, kcal: value.kcal, carb: value.carb, protein: value.protein, fat: value.fat, meal: mealType, date },
      },
      { onSuccess: onClose },
    );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{meal.method === "ai" ? "식단 (AI 추정치)" : "식단"}</DialogTitle>
        </DialogHeader>
        <fieldset disabled={readOnly} className="grid gap-3">
          <NutritionRow value={value} onChange={setValue} />
          <div className="grid grid-cols-2 gap-2">
            <NativeSelect aria-label="끼니" value={mealType} onChange={(e) => setMealType(e.target.value as MealType)}>
              {MEAL_TYPES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </NativeSelect>
            <Input type="date" aria-label="날짜" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </div>
        </fieldset>
        <ErrorAlert error={update.error ?? remove.error} />
        {!readOnly && (
          <DialogFooter>
            <ConfirmButton variant="ghost" className="mr-auto" title="이 항목을 삭제할까요?" description={meal.name} confirmLabel="삭제" onConfirm={() => remove.mutateAsync(meal).then(onClose)}>
              삭제
            </ConfirmButton>
            <Button disabled={!value.name.trim() || update.isPending} onClick={save}>
              저장
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
