import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** 모바일에서 OS 기본 선택창이 뜨는 네이티브 select (권한 매트릭스처럼 칸이 많은 곳에 쓴다) */
export function NativeSelect({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-8 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30",
        className,
      )}
      {...props}
    />
  );
}
