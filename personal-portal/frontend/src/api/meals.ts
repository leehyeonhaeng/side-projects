import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

// backend/domains/meals.py, domains/ai.py 와 같은 구조
export type MealType = "breakfast" | "lunch" | "dinner" | "snack";
export type MealMethod = "ai" | "manual" | "food";

export type Nutrition = { name: string; grams?: number | null; kcal: number; carb: number; protein: number; fat: number };
export type Meal = Nutrition & { id: string; date: string; meal: MealType; method: MealMethod; note: string; createdAt: string };
export type Totals = { kcal: number; carb: number; protein: number; fat: number };
export type Food = { id: string; name: string; basis: "100g" | "serving"; servingGrams?: number | null; kcal: number; carb: number; protein: number; fat: number };
export type MealSet = { id: string; name: string; items: Nutrition[] };
export type AiUsage = { used: number; limit: number };

export const MEAL_TYPES: { value: MealType; label: string }[] = [
  { value: "breakfast", label: "아침" },
  { value: "lunch", label: "점심" },
  { value: "dinner", label: "저녁" },
  { value: "snack", label: "간식" },
];
export const MEAL_LABEL = Object.fromEntries(MEAL_TYPES.map((m) => [m.value, m.label])) as Record<MealType, string>;

const EMPTY: Totals = { kcal: 0, carb: 0, protein: 0, fat: 0 };
export const sumTotals = (items: Nutrition[]): Totals =>
  items.reduce((t, i) => ({ kcal: t.kcal + i.kcal, carb: t.carb + i.carb, protein: t.protein + i.protein, fat: t.fat + i.fat }), EMPTY);

/** 지금 시각으로 고른 기본 끼니 (한국 시간) */
export function currentMealType(): MealType {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", hour: "numeric", hourCycle: "h23" }).format(new Date()));
  if (hour < 10) return "breakfast";
  if (hour < 15) return "lunch";
  if (hour < 21) return "dinner";
  return "snack";
}

const KEY = ["meals"] as const;

export function useMeals(date: string) {
  return useQuery({
    queryKey: [...KEY, date],
    queryFn: () => api.get<{ meals: Meal[]; totals: Record<string, Totals> }>(`/meals?from=${date}&to=${date}`),
    select: (d) => d.meals,
  });
}

export function useMealStats(from: string, to: string) {
  return useQuery({
    queryKey: [...KEY, "stats", from, to],
    queryFn: () => api.get<{ totals: Record<string, Totals> }>(`/meals/stats?from=${from}&to=${to}`),
    select: (d) => d.totals,
  });
}

function useMealMutation<V, R>(fn: (v: V) => Promise<R>, extraKeys: string[][] = []) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      for (const k of extraKeys) void qc.invalidateQueries({ queryKey: k });
    },
  });
}

export const useCreateMeals = () =>
  useMealMutation((body: { date: string; meal: MealType; method: MealMethod; items: Nutrition[] }) => api.post<{ meals: Meal[] }>("/meals/batch", body));
export const useUpdateMeal = () =>
  useMealMutation(({ meal, patch }: { meal: Meal; patch: Partial<Nutrition & { meal: MealType; date: string; note: string }> }) =>
    api.patch<Meal>(`/meals/${meal.id}?date=${meal.date}&meal=${meal.meal}`, patch),
  );
export const useDeleteMeal = () => useMealMutation((meal: Meal) => api.del(`/meals/${meal.id}?date=${meal.date}&meal=${meal.meal}`));
export const useCopyMeals = () =>
  useMealMutation((body: { fromDate: string; toDate: string; meal?: MealType }) => api.post<{ meals: Meal[] }>("/meals/copy", body));

// ── 내 음식·끼니 조합 ──
export function useFoods() {
  return useQuery({ queryKey: ["foods"], queryFn: () => api.get<{ foods: Food[] }>("/foods"), select: (d) => d.foods });
}
export const useSaveFood = () =>
  useMealMutation(({ id, ...body }: Omit<Food, "id"> & { id?: string }) => (id ? api.put<Food>(`/foods/${id}`, body) : api.post<Food>("/foods", body)), [["foods"]]);
export const useDeleteFood = () => useMealMutation((id: string) => api.del(`/foods/${id}`), [["foods"]]);

export function useMealSets() {
  return useQuery({ queryKey: ["meal-sets"], queryFn: () => api.get<{ sets: MealSet[] }>("/meal-sets"), select: (d) => d.sets });
}
export const useCreateMealSet = () => useMealMutation((body: { name: string; items: Nutrition[] }) => api.post<MealSet>("/meal-sets", body), [["meal-sets"]]);
export const useDeleteMealSet = () => useMealMutation((id: string) => api.del(`/meal-sets/${id}`), [["meal-sets"]]);

// ── AI 칼로리 추정 (계정당 하루 50회) ──
export function useAiUsage() {
  return useQuery({ queryKey: ["ai-usage"], queryFn: () => api.get<AiUsage>("/ai/usage") });
}
export function useEstimateCalories() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => api.post<{ items: Nutrition[]; usage: AiUsage }>("/ai/estimate-calories", { text }),
    onSuccess: (res) => qc.setQueryData(["ai-usage"], res.usage),
    onError: () => qc.invalidateQueries({ queryKey: ["ai-usage"] }),
  });
}

/** 내 음식 → 먹은 양 기준 영양정보. 100g 기준이면 g으로, 1회 제공량 기준이면 횟수로 계산 */
export function foodPortion(food: Food, amount: number): Nutrition {
  const factor = food.basis === "100g" ? amount / 100 : amount;
  const grams = food.basis === "100g" ? amount : food.servingGrams ? food.servingGrams * amount : null;
  const r = (n: number) => Math.round(n * factor * 10) / 10;
  return { name: food.name, grams, kcal: r(food.kcal), carb: r(food.carb), protein: r(food.protein), fat: r(food.fat) };
}
