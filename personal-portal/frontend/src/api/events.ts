import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

// backend/domains/events.py 와 같은 구조
export type EventColor = "blue" | "green" | "red" | "orange" | "purple" | "pink" | "teal" | "gray";
export type EventRepeat = { freq: "daily" | "weekly" | "monthly" | "yearly"; until?: string | null };

export type CalEvent = {
  id: string; // 반복 회차는 "<seriesId>@<날짜>"
  title: string;
  allDay: boolean;
  start: string;
  startTime?: string;
  end: string;
  endTime?: string;
  location: string;
  color: EventColor;
  memo: string;
  seriesId?: string;
  occurrenceDate?: string; // 반복 회차일 때만
  repeat?: EventRepeat; // 시리즈(검색 결과)일 때만
};

export type EventInput = Partial<{
  title: string;
  allDay: boolean;
  start: string;
  startTime: string | null;
  end: string;
  endTime: string | null;
  location: string;
  color: EventColor;
  memo: string;
}>;

export const EVENT_COLORS: { value: EventColor; label: string; hex: string }[] = [
  { value: "blue", label: "파랑", hex: "#3b82f6" },
  { value: "green", label: "초록", hex: "#22c55e" },
  { value: "red", label: "빨강", hex: "#ef4444" },
  { value: "orange", label: "주황", hex: "#f97316" },
  { value: "purple", label: "보라", hex: "#a855f7" },
  { value: "pink", label: "분홍", hex: "#ec4899" },
  { value: "teal", label: "청록", hex: "#14b8a6" },
  { value: "gray", label: "회색", hex: "#6b7280" },
];

export const colorHex = (c: EventColor) => EVENT_COLORS.find((x) => x.value === c)?.hex ?? "#3b82f6";

const KEY = ["events"] as const;

export function useEvents(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: [...KEY, from, to],
    queryFn: () => api.get<{ events: CalEvent[] }>(`/events?from=${from}&to=${to}`),
    select: (d) => d.events,
    enabled,
    placeholderData: (prev) => prev,
  });
}

export function useSearchEvents(q: string) {
  return useQuery({
    queryKey: [...KEY, "search", q],
    queryFn: () => api.get<{ events: CalEvent[] }>(`/events/search?q=${encodeURIComponent(q)}`),
    select: (d) => d.events,
    enabled: q.trim().length > 0,
  });
}

export type Scope = "this" | "all";

/** 일정 저장·삭제. 반복 회차는 scope(이 일정만/전체)에 따라 다른 API를 부른다. */
export function useEventMutations() {
  const qc = useQueryClient();
  const onSettled = () => qc.invalidateQueries({ queryKey: KEY });

  const create = useMutation({
    mutationFn: (input: EventInput & { title: string; start: string; repeat?: EventRepeat }) => api.post<CalEvent>("/events", input),
    onSettled,
  });

  const update = useMutation({
    mutationFn: ({ event, input, scope, repeat }: { event: CalEvent; input: EventInput; scope: Scope; repeat?: EventRepeat }) => {
      if (event.seriesId && event.occurrenceDate) {
        return scope === "this"
          ? api.patch(`/event-series/${event.seriesId}/occurrences/${event.occurrenceDate}`, input)
          : api.patch(`/event-series/${event.seriesId}`, seriesPatch(event, input, repeat));
      }
      return api.patch(`/events/${event.id}?start=${event.start}`, input);
    },
    onSettled,
  });

  const remove = useMutation({
    mutationFn: ({ event, scope }: { event: CalEvent; scope: Scope }) => {
      if (event.seriesId && event.occurrenceDate) {
        return scope === "this"
          ? api.del(`/event-series/${event.seriesId}/occurrences/${event.occurrenceDate}`)
          : api.del(`/event-series/${event.seriesId}`);
      }
      return api.del(`/events/${event.id}?start=${event.start}`);
    },
    onSettled,
  });

  return { create, update, remove };
}

/**
 * 회차 화면에서 "전체" 수정: 날짜는 바꾸지 않는다 (회차 날짜로 시리즈 시작일을 옮기면 이전 회차가 사라짐).
 * 날짜를 옮기는 건 "이 일정만"에서만 한다.
 */
function seriesPatch(_event: CalEvent, input: EventInput, repeat?: EventRepeat) {
  const { start: _start, end: _end, ...rest } = input;
  return { ...rest, ...(repeat ? { repeat } : {}) };
}
