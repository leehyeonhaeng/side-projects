import { XIcon } from "lucide-react";
import { type BoardDetail, type Card, labelClass } from "@/api/boards";
import { NativeSelect } from "@/components/NativeSelect";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { dueState } from "./CardTile";

/** DESIGN.md 6.6 필터: 라벨, 담당자, 마감 임박 (화면에서만 거른다) */
export type CardFilter = { labels: string[]; assignee: "" | "me" | "none" | string; dueSoon: boolean };
export const EMPTY_FILTER: CardFilter = { labels: [], assignee: "", dueSoon: false };

export const isFiltering = (f: CardFilter) => f.labels.length > 0 || f.assignee !== "" || f.dueSoon;

export function matchesFilter(card: Card, f: CardFilter, mySub: string | undefined, doneColumns: Set<string>): boolean {
  if (f.labels.length && !f.labels.some((l) => card.labels.includes(l))) return false;
  if (f.assignee === "me" && card.assignee !== mySub) return false;
  if (f.assignee === "none" && card.assignee) return false;
  if (f.assignee && !["me", "none"].includes(f.assignee) && card.assignee !== f.assignee) return false;
  if (f.dueSoon && !dueState(card, doneColumns)) return false;
  return true;
}

export function FilterBar({ filter, onChange, data }: { filter: CardFilter; onChange: (f: CardFilter) => void; data: BoardDetail }) {
  const toggleLabel = (id: string) => onChange({ ...filter, labels: filter.labels.includes(id) ? filter.labels.filter((x) => x !== id) : [...filter.labels, id] });

  return (
    <div className="flex w-full flex-wrap items-center gap-1.5 rounded-xl border bg-card p-2">
      {data.board.labels.map((l) => {
        const on = filter.labels.includes(l.id);
        return (
          <button
            key={l.id}
            type="button"
            aria-pressed={on}
            onClick={() => toggleLabel(l.id)}
            className={cn("flex h-7 items-center gap-1 rounded-full border px-2 text-xs", on ? "border-primary bg-muted" : "text-muted-foreground")}
          >
            <span className={cn("size-2.5 rounded-full", labelClass(l.color))} />
            {l.name || "라벨"}
          </button>
        );
      })}
      <NativeSelect value={filter.assignee} onChange={(e) => onChange({ ...filter, assignee: e.target.value })} aria-label="담당자" className="h-7 text-xs">
        <option value="">담당자 전체</option>
        <option value="me">내 카드</option>
        <option value="none">담당자 없음</option>
        {data.members.map((m) => (
          <option key={m.sub} value={m.sub}>
            {m.name || m.email}
          </option>
        ))}
      </NativeSelect>
      <button
        type="button"
        aria-pressed={filter.dueSoon}
        onClick={() => onChange({ ...filter, dueSoon: !filter.dueSoon })}
        className={cn("h-7 rounded-full border px-2 text-xs", filter.dueSoon ? "border-primary bg-muted" : "text-muted-foreground")}
      >
        마감 임박 (3일 이내·지남)
      </button>
      {isFiltering(filter) && (
        <Button variant="ghost" size="xs" onClick={() => onChange(EMPTY_FILTER)}>
          <XIcon /> 해제
        </Button>
      )}
    </div>
  );
}
