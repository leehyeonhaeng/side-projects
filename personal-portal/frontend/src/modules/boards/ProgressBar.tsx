import type { Progress } from "@/api/boards";

/** 완료 컬럼에 있는 카드 비율 (DESIGN.md 6.6 진행률) */
export function ProgressBar({ progress }: { progress: Progress }) {
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="grid gap-1">
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] tabular-nums text-muted-foreground">
        완료 {progress.done}/{progress.total} ({pct}%)
      </span>
    </div>
  );
}
