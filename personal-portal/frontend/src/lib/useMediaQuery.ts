import { useSyncExternalStore } from "react";

/** 화면 크기 조건 (예: "(max-width: 639px)"). 창 크기가 바뀌면 다시 그린다 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => matchMedia(query).matches,
  );
}
