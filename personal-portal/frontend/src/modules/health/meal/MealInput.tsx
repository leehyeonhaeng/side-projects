import { useState } from "react";
import { SparklesIcon } from "lucide-react";
import { type Food, type Nutrition, foodPortion, useAiUsage, useEstimateCalories, useFoods, useMealSets } from "@/api/meals";
import { NativeSelect } from "@/components/NativeSelect";
import { ErrorAlert } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type Review = { title: string; description: string; items: Nutrition[]; method: "ai" | "manual" | "food" };

const BLANK: Nutrition = { name: "", grams: 100, kcal: 0, carb: 0, protein: 0, fat: 0 };

/**
 * 식단 입력 (DESIGN.md 6.3 입력 방식): AI 추정 / 직접 입력 / 내 음식 + 끼니 조합.
 * 어떤 방식이든 확인 카드(EstimateReview)에서 고친 뒤 저장한다.
 */
export function MealInput({ initialText, onReview }: { initialText?: string; onReview: (r: Review) => void }) {
  const [text, setText] = useState(initialText ?? "");
  const usage = useAiUsage();
  const estimate = useEstimateCalories();
  const foods = useFoods();
  const sets = useMealSets();

  const q = text.trim().toLowerCase();
  const suggestions = q ? (foods.data ?? []).filter((f) => f.name.toLowerCase().includes(q)).slice(0, 5) : [];
  const limitReached = usage.data ? usage.data.used >= usage.data.limit : false;

  const runAi = () => {
    const value = text.trim();
    if (!value) return;
    estimate.mutate(value, {
      onSuccess: (res) => {
        setText("");
        onReview({
          title: "AI 추정 결과 확인",
          description: "AI 추정치입니다. 양(g)을 바꾸면 비율대로 다시 계산됩니다. 확인 후 저장하세요.",
          items: res.items,
          method: "ai",
        });
      },
    });
  };

  const pickFood = (food: Food) => {
    setText("");
    onReview({
      title: food.name,
      description: food.basis === "100g" ? "100g 기준 음식입니다. 먹은 양(g)을 바꾸면 비율대로 계산됩니다." : "1회 제공량 기준입니다. 양(g)을 바꾸면 비율대로 계산됩니다.",
      items: [foodPortion(food, food.basis === "100g" ? 100 : 1)],
      method: "food",
    });
  };

  return (
    <div className="grid gap-2">
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          runAi();
        }}
      >
        <Input aria-label="먹은 음식" placeholder="예: 현미밥 200g, 닭가슴살 150g, 김치 50g" maxLength={300} value={text} onChange={(e) => setText(e.target.value)} />
        <Button type="submit" disabled={!text.trim() || estimate.isPending || limitReached} className="shrink-0">
          <SparklesIcon data-icon="inline-start" />
          {estimate.isPending ? "계산 중" : "AI 계산"}
        </Button>
      </form>

      {suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <span className="text-muted-foreground">내 음식</span>
          {suggestions.map((f) => (
            <Button key={f.id} size="xs" variant="outline" onClick={() => pickFood(f)}>
              {f.name} · {Math.round(f.kcal)}kcal{f.basis === "100g" ? "/100g" : ""}
            </Button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Button size="xs" variant="ghost" onClick={() => onReview({ title: "직접 입력", description: "포장지 라벨 값을 그대로 넣고(예: 100g당), 양(g)을 실제 먹은 만큼 바꾸면 비율대로 계산됩니다.", items: [BLANK], method: "manual" })}>
          직접 입력
        </Button>
        {(sets.data?.length ?? 0) > 0 && (
          <NativeSelect
            aria-label="끼니 조합 불러오기"
            value=""
            onChange={(e) => {
              const set = sets.data?.find((s) => s.id === e.target.value);
              if (set) onReview({ title: `끼니 조합: ${set.name}`, description: "저장한 조합입니다. 필요하면 고친 뒤 저장하세요.", items: set.items, method: "manual" })
            }}
            className="h-6 text-xs"
          >
            <option value="">끼니 조합 불러오기</option>
            {sets.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        )}
        <span className="ml-auto tabular-nums">{usage.data && `오늘 AI ${usage.data.used}/${usage.data.limit}회`}</span>
      </div>
      {/* 429(하루 상한)도 서버 메시지 그대로 보여준다 */}
      <ErrorAlert error={estimate.error} />
    </div>
  );
}
