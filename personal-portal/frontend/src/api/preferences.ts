import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ModuleId } from "@/modules/meta";
import { api } from "./client";
import type { Me } from "./me";

// backend/common/preferences.py 와 같은 구조
export type ItemSize = { w: 1 | 2; h: 1 | 2 };

export type LayoutItem = {
  id: string;
  kind: "icon" | "widget";
  module: ModuleId;
  widget?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  hidden?: boolean;
};

export type Section = { id: string; name: string; items: LayoutItem[] };
export type Layout = { version: 1; sections: Section[] };
export type SavedLayout = { layout: Layout | null; updatedAt: string | null };

export type ThemePref = "system" | "light" | "dark";
export type Settings = {
  theme: ThemePref;
  // 식단 목표 (없으면 null)
  goalKcal: number | null;
  goalCarb: number | null;
  goalProtein: number | null;
  goalFat: number | null;
  goalWeight: number | null; // kg
  navTabs: ModuleId[]; // 폰 하단 탭 가운데 두 칸
};

export function useLayout() {
  return useQuery({
    queryKey: ["layout"],
    queryFn: () => api.get<SavedLayout>("/layout"),
    // 다른 기기에서 바꾼 레이아웃을 바로 반영한다
    refetchOnWindowFocus: true,
  });
}

export function useSaveLayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (layout: Layout) => api.put<SavedLayout>("/layout", layout),
    onSuccess: (saved) => qc.setQueryData(["layout"], saved),
  });
}

export function useSettings(enabled = true) {
  return useQuery({ queryKey: ["settings"], queryFn: () => api.get<Settings>("/settings"), enabled, staleTime: 60_000 });
}

export function usePatchSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => api.patch<Settings>("/settings", patch),
    onSuccess: (s) => qc.setQueryData(["settings"], s),
  });
}

export function useUpdateName() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.patch<Me>("/me", { name }),
    onSuccess: (me) => qc.setQueryData(["me"], me),
  });
}
