import { useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, CopyIcon } from "lucide-react";
import { useMe } from "@/api/me";
import { MEAL_TYPES, type Meal, type MealType, currentMealType, sumTotals, useCopyMeals, useCreateMealSet, useDeleteFood, useFoods, useMeals } from "@/api/meals";
import { useSettings } from "@/api/preferences";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { addDays, relativeDay, todayStr } from "@/lib/dates";
import { DailySummary } from "./DailySummary";
import { EstimateReview } from "./EstimateReview";
import { MealHistory } from "./MealHistory";
import { MealInput, type Review } from "./MealInput";
import { MealItemDialog } from "./MealItemDialog";

/** DESIGN.md 6.3 식단: 오늘 요약, 입력(AI·직접·내 음식), 끼니별 카드, 기록 그래프 */
export function MealTab({ draft }: { draft?: string }) {
  const me = useMe();
  const settings = useSettings();
  const [date, setDate] = useState(todayStr());
  const meals = useMeals(date);
  const copy = useCopyMeals();
  const [review, setReview] = useState<(Review & { key: number; meal: MealType }) | null>(null);
  const [editing, setEditing] = useState<Meal | null>(null);
  const [foodsOpen, setFoodsOpen] = useState(false);
  const readOnly = me.data?.perms.health !== "edit";
  const today = todayStr();

  const list = meals.data ?? [];
  const yesterday = addDays(date, -1);

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" aria-label="전날" onClick={() => setDate((d) => addDays(d, -1))}>
            <ChevronLeftIcon />
          </Button>
          <button type="button" className="min-w-24 text-sm font-medium" onClick={() => setDate(today)}>
            {relativeDay(date)}
          </button>
          <Button size="icon-sm" variant="ghost" aria-label="다음날" disabled={date >= today} onClick={() => setDate((d) => addDays(d, 1))}>
            <ChevronRightIcon />
          </Button>
        </div>
        {!readOnly && (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setFoodsOpen(true)}>
              내 음식
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={copy.isPending}
              onClick={() => copy.mutate({ fromDate: yesterday, toDate: date })}
              title={`${relativeDay(yesterday)} 식단을 ${relativeDay(date)}로 복사`}
            >
              <CopyIcon data-icon="inline-start" />
              전날 복사
            </Button>
          </div>
        )}
      </div>
      {copy.error && <ErrorAlert error={copy.error.message === "nothing to copy" ? new Error("전날 기록이 없습니다.") : copy.error} />}

      {meals.isPending ? <InlineSpinner /> : <DailySummary totals={sumTotals(list)} settings={settings.data} />}

      {!readOnly && <MealInput initialText={draft} onReview={(r) => setReview({ ...r, key: Date.now(), meal: currentMealType() })} />}

      <ErrorAlert error={meals.error} />
      <div className="grid gap-3 sm:grid-cols-2">
        {MEAL_TYPES.map((m) => (
          <MealSection key={m.value} label={m.label} items={list.filter((x) => x.meal === m.value)} readOnly={readOnly} onOpen={setEditing} onCopyYesterday={() => copy.mutate({ fromDate: yesterday, toDate: date, meal: m.value })} />
        ))}
      </div>

      <MealHistory goal={settings.data?.goalKcal ?? null} />

      {review && (
        <EstimateReview key={review.key} title={review.title} description={review.description} items={review.items} date={date} meal={review.meal} method={review.method} onClose={() => setReview(null)} />
      )}
      {editing && <MealItemDialog meal={editing} readOnly={readOnly} onClose={() => setEditing(null)} />}
      {foodsOpen && <FoodsDialog onClose={() => setFoodsOpen(false)} />}
    </div>
  );
}

function MealSection({ label, items, readOnly, onOpen, onCopyYesterday }: { label: string; items: Meal[]; readOnly: boolean; onOpen: (m: Meal) => void; onCopyYesterday: () => void }) {
  const total = sumTotals(items);
  const createSet = useCreateMealSet();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  return (
    <section className="grid content-start gap-2 rounded-2xl border bg-card p-3" aria-label={label}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">
          {label} <span className="ml-1 text-xs font-normal tabular-nums text-muted-foreground">{Math.round(total.kcal)} kcal</span>
        </h3>
        {!readOnly && (
          <div className="flex gap-0.5">
            {items.length > 0 && (
              <Button size="xs" variant="ghost" onClick={() => setNaming((v) => !v)}>
                조합 저장
              </Button>
            )}
            <Button size="xs" variant="ghost" onClick={onCopyYesterday}>
              전날 {label}
            </Button>
          </div>
        )}
      </div>
      {naming && (
        <form
          className="flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            createSet.mutate(
              { name: name.trim(), items: items.map(({ name: n, grams, kcal, carb, protein, fat }) => ({ name: n, grams, kcal, carb, protein, fat })) },
              { onSuccess: () => (setNaming(false), setName("")) },
            );
          }}
        >
          <Input aria-label="조합 이름" placeholder={`조합 이름 (예: 평일 ${label})`} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} className="h-7 text-xs" autoFocus />
          <Button size="xs" type="submit" disabled={!name.trim() || createSet.isPending}>
            저장
          </Button>
        </form>
      )}
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">기록 없음</p>
      ) : (
        <ul className="grid gap-1">
          {items.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => onOpen(m)} className="flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-sm hover:bg-muted">
                <span className="flex-1 truncate">
                  {m.name}
                  {m.grams ? <span className="ml-1 text-xs text-muted-foreground">{Math.round(m.grams)}g</span> : null}
                </span>
                {m.method === "ai" && <Badge variant="outline">추정</Badge>}
                <span className="tabular-nums text-xs text-muted-foreground">{Math.round(m.kcal)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FoodsDialog({ onClose }: { onClose: () => void }) {
  const foods = useFoods();
  const remove = useDeleteFood();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[80dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>내 음식</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">AI 결과 확인 화면에서 "내 음식에 추가"를 체크하면 여기에 쌓이고, 입력창에 이름을 치면 바로 고를 수 있습니다.</p>
        {foods.isPending ? (
          <InlineSpinner />
        ) : (foods.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">저장한 음식이 없습니다.</p>
        ) : (
          <ul className="grid gap-1">
            {foods.data?.map((f) => (
              <li key={f.id} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate">{f.name}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {Math.round(f.kcal)}kcal / {f.basis === "100g" ? "100g" : f.servingGrams ? `${Math.round(f.servingGrams)}g` : "1회"}
                </span>
                <ConfirmButton size="xs" variant="ghost" title="내 음식에서 삭제할까요?" description={f.name} confirmLabel="삭제" onConfirm={() => remove.mutateAsync(f.id)}>
                  삭제
                </ConfirmButton>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
