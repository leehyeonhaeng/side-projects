import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, isoWeekdayOf } from "@/lib/dates";
import { api } from "./client";

// backend/domains/exercise.py 와 같은 구조
export type RunType = "easy" | "interval" | "tempo" | "long";
export const RUN_TYPES: { value: RunType; label: string }[] = [
  { value: "easy", label: "이지런" },
  { value: "interval", label: "인터벌" },
  { value: "tempo", label: "템포" },
  { value: "long", label: "장거리" },
];

export type Run = {
  id: string;
  date: string;
  distanceKm: number;
  durationSec: number;
  paceSecPerKm: number;
  type: RunType;
  effort?: number;
  kcal?: number;
  kcalEstimated: boolean;
  memo: string;
};
export type RunInput = Omit<Run, "id" | "paceSecPerKm" | "kcalEstimated" | "kcal" | "effort"> & { effort?: number | null; kcal?: number | null };

export type GymSet = { reps: number; weight: number };
export type GymExercise = { name: string; sets: GymSet[] };
export type GymSession = { id: string; date: string; title: string; routineId?: string; exercises: GymExercise[]; kcal?: number; memo: string };
export type GymInput = Omit<GymSession, "id" | "kcal"> & { kcal?: number | null };

export type Routine = { id: string; name: string; exercises: { name: string; sets: number }[] };

export type PlanItem = { week: number; weekday: number; kind: "run" | "gym" | "other"; title: string };
export type Program = { id: string; name: string; startDate: string; weeks: number; items: PlanItem[]; active: boolean; manualDone: string[] };
export type ProgramInput = Omit<Program, "id" | "manualDone">;

function useInvalidate(keys: string[][]) {
  const qc = useQueryClient();
  return () => keys.forEach((k) => void qc.invalidateQueries({ queryKey: k }));
}

export function useRuns(from: string, to: string, enabled = true) {
  return useQuery({ queryKey: ["runs", from, to], queryFn: () => api.get<{ runs: Run[] }>(`/runs?from=${from}&to=${to}`), select: (d) => d.runs, enabled });
}
export function useRunRecords() {
  return useQuery({ queryKey: ["runs", "records"], queryFn: () => api.get<{ best5k: Run | null; best10k: Run | null }>("/runs/records") });
}
export function useSaveRun() {
  const invalidate = useInvalidate([["runs"]]);
  return useMutation({
    mutationFn: ({ original, input }: { original?: Run; input: RunInput }) =>
      original ? api.put<Run>(`/runs/${original.id}?date=${original.date}`, input) : api.post<Run>("/runs", input),
    onSettled: invalidate,
  });
}
export function useDeleteRun() {
  const invalidate = useInvalidate([["runs"]]);
  return useMutation({ mutationFn: (run: Run) => api.del(`/runs/${run.id}?date=${run.date}`), onSettled: invalidate });
}

export function useGymSessions(from: string, to: string, enabled = true) {
  return useQuery({ queryKey: ["gym", from, to], queryFn: () => api.get<{ sessions: GymSession[] }>(`/gym?from=${from}&to=${to}`), select: (d) => d.sessions, enabled });
}
export function useGymLast(names: string[]) {
  const key = names.join(",");
  return useQuery({
    queryKey: ["gym", "last", key],
    queryFn: () => api.get<{ last: Record<string, { date: string; sets: GymSet[] }> }>(`/gym/last?names=${encodeURIComponent(key)}`),
    select: (d) => d.last,
    enabled: names.length > 0,
  });
}
export function useGymProgress(name: string) {
  return useQuery({
    queryKey: ["gym", "progress", name],
    queryFn: () => api.get<{ points: { date: string; maxWeight: number; volume: number }[] }>(`/gym/progress?name=${encodeURIComponent(name)}`),
    select: (d) => d.points,
    enabled: name.length > 0,
  });
}
export function useSaveGym() {
  const invalidate = useInvalidate([["gym"]]);
  return useMutation({
    mutationFn: ({ original, input }: { original?: GymSession; input: GymInput }) =>
      original ? api.put<GymSession>(`/gym/${original.id}?date=${original.date}`, input) : api.post<GymSession>("/gym", input),
    onSettled: invalidate,
  });
}
export function useDeleteGym() {
  const invalidate = useInvalidate([["gym"]]);
  return useMutation({ mutationFn: (s: GymSession) => api.del(`/gym/${s.id}?date=${s.date}`), onSettled: invalidate });
}

export function useRoutines() {
  return useQuery({ queryKey: ["routines"], queryFn: () => api.get<{ routines: Routine[] }>("/routines"), select: (d) => d.routines });
}
export function useSaveRoutine() {
  const invalidate = useInvalidate([["routines"]]);
  return useMutation({
    mutationFn: ({ id, ...body }: Omit<Routine, "id"> & { id?: string }) => (id ? api.put<Routine>(`/routines/${id}`, body) : api.post<Routine>("/routines", body)),
    onSettled: invalidate,
  });
}
export function useDeleteRoutine() {
  const invalidate = useInvalidate([["routines"]]);
  return useMutation({ mutationFn: (id: string) => api.del(`/routines/${id}`), onSettled: invalidate });
}

export function usePrograms() {
  return useQuery({ queryKey: ["programs"], queryFn: () => api.get<{ programs: Program[] }>("/programs"), select: (d) => d.programs });
}
export function useSaveProgram() {
  const invalidate = useInvalidate([["programs"]]);
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: ProgramInput }) => (id ? api.put<Program>(`/programs/${id}`, input) : api.post<Program>("/programs", input)),
    onSettled: invalidate,
  });
}
export function useProgramDone() {
  const invalidate = useInvalidate([["programs"]]);
  return useMutation({
    mutationFn: ({ id, date, done }: { id: string; date: string; done: boolean }) => api.patch<Program>(`/programs/${id}/done`, { date, done }),
    onSettled: invalidate,
  });
}
export function useDeleteProgram() {
  const invalidate = useInvalidate([["programs"]]);
  return useMutation({ mutationFn: (id: string) => api.del(`/programs/${id}`), onSettled: invalidate });
}

// ── 계산 ────────────────────────────────────────────

/** 초 → "m:ss" 또는 "h:mm:ss" */
export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** "25:30", "1:05:00", "25" (분) → 초. 잘못된 형식이면 null */
export function parseDuration(text: string): number | null {
  const parts = text.trim().split(":").map((p) => Number(p));
  if (parts.length === 0 || parts.some((p) => Number.isNaN(p) || p < 0)) return null;
  const [a = 0, b = 0, c = 0] = parts;
  const sec = parts.length === 1 ? a * 60 : parts.length === 2 ? a * 60 + b : a * 3600 + b * 60 + c;
  return sec > 0 ? Math.round(sec) : null;
}

export const formatPace = (secPerKm: number) => `${formatDuration(secPerKm)}/km`;

/** 그 날이 속한 주의 월요일 */
export const mondayOf = (day: string) => addDays(day, 1 - isoWeekdayOf(day));

/** 프로그램 계획 항목의 실제 날짜: 시작일이 속한 주의 월요일이 1주차 월요일 */
export const planDate = (program: Program, item: PlanItem) => addDays(mondayOf(program.startDate), (item.week - 1) * 7 + item.weekday - 1);

export const programEnd = (program: Program) => addDays(mondayOf(program.startDate), program.weeks * 7 - 1);

/** 러닝·헬스 계획은 그 날 기록이 있으면 자동 완료, 기타는 직접 체크 (DESIGN.md 6.5) */
export function isPlanDone(program: Program, item: PlanItem, runs: Run[], gym: GymSession[]): boolean {
  const day = planDate(program, item);
  if (item.kind === "run") return runs.some((r) => r.date === day);
  if (item.kind === "gym") return gym.some((g) => g.date === day);
  return program.manualDone.includes(day);
}

/** 그 날 운동 소모 칼로리 합 (러닝 + 헬스, 기록된 값만) */
export const burnedKcal = (runs: Run[], gym: GymSession[]) =>
  Math.round(runs.reduce((s, r) => s + (r.kcal ?? 0), 0) + gym.reduce((s, g) => s + (g.kcal ?? 0), 0));
