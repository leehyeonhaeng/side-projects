import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays } from "@/lib/dates";
import { api } from "./client";

// backend/domains/weights.py 와 같은 구조. 하루 한 기록
export type WeightEntry = { date: string; weight: number; bodyFat?: number; muscle?: number; memo: string };
export type WeightInput = { weight: number; bodyFat?: number | null; muscle?: number | null; memo?: string };

const KEY = ["weights"] as const;

/** from·to 없으면 전체 */
export function useWeights(range?: { from: string; to: string }) {
  return useQuery({
    queryKey: [...KEY, range?.from ?? "all", range?.to ?? "all"],
    queryFn: () => api.get<{ weights: WeightEntry[] }>(range ? `/weights?from=${range.from}&to=${range.to}` : "/weights"),
    select: (d) => d.weights,
  });
}

export function useSaveWeight() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ date, ...body }: WeightInput & { date: string }) => api.put<WeightEntry>(`/weights/${date}`, body),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteWeight() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (date: string) => api.del(`/weights/${date}`),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** 7일 이동평균: 각 기록일 기준 직전 7일(당일 포함) 안의 기록 평균 (DESIGN.md 6.4) */
export function withMovingAverage(entries: WeightEntry[]): (WeightEntry & { avg7: number })[] {
  return entries.map((e) => {
    const from = addDays(e.date, -6);
    const window = entries.filter((x) => x.date >= from && x.date <= e.date);
    const avg = window.reduce((s, x) => s + x.weight, 0) / window.length;
    return { ...e, avg7: Math.round(avg * 10) / 10 };
  });
}

/** 기준일(포함) 이전 가장 가까운 기록 */
export function entryOnOrBefore(entries: WeightEntry[], day: string): WeightEntry | undefined {
  return [...entries].reverse().find((e) => e.date <= day);
}
