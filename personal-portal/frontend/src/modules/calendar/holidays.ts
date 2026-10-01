import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { getHolidayPreset } from "@hyunbinseo/holidays-kr";

type Holidays = Readonly<Record<string, readonly string[]>>;

/** 기간에 걸친 연도들의 한국 공휴일 (패키지에 내장된 관보 기준 데이터, 외부 호출 없음) */
export function useHolidays(from?: string, to?: string): Holidays {
  const years = from && to ? range(Number(from.slice(0, 4)), Number(to.slice(0, 4))) : [];
  const results = useQueries({
    queries: years.map((year) => ({
      queryKey: ["holidays", year],
      // 패키지에 그 해 데이터가 없으면 RangeError → 빈 값
      queryFn: (): Promise<Holidays> => getHolidayPreset(String(year)).catch(() => ({})),
      staleTime: Number.POSITIVE_INFINITY,
    })),
  });
  const loaded = results.map((r) => r.dataUpdatedAt).join(",");

  return useMemo(() => {
    const out: Record<string, readonly string[]> = {};
    if (!from || !to) return out;
    for (const r of results) {
      for (const [day, names] of Object.entries(r.data ?? {})) {
        if (day >= from && day <= to) out[day] = names;
      }
    }
    return out;
    // results 배열은 매 렌더 새로 만들어지므로 데이터 갱신 시각으로 판단한다
  }, [from, to, loaded]);
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
