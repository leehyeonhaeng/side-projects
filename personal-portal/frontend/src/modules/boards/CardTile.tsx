import { AlignLeftIcon, CalendarIcon, ChevronsUpIcon, ListChecksIcon, LinkIcon } from "lucide-react";
import { type BoardDetail, type Card, labelClass } from "@/api/boards";
import { addDays, formatDay, todayStr } from "@/lib/dates";
import { cn } from "@/lib/utils";

/** 마감 임박: 오늘 포함 3일 이내 (완료 컬럼 카드는 제외) */
export function dueState(card: Card, doneColumns: Set<string>): "overdue" | "soon" | null {
  if (!card.due || doneColumns.has(card.columnId)) return null;
  const today = todayStr();
  if (card.due < today) return "overdue";
  if (card.due <= addDays(today, 2)) return "soon";
  return null;
}

type Props = { card: Card; board: BoardDetail; memberName: (sub?: string) => string | undefined; onOpen?: () => void; overlay?: boolean };

export function CardTile({ card, board, memberName, onOpen, overlay }: Props) {
  const labels = board.board.labels.filter((l) => card.labels.includes(l.id));
  const doneColumns = new Set(board.columns.filter((c) => c.done).map((c) => c.id));
  const due = dueState(card, doneColumns);
  const checked = card.checklist.filter((i) => i.done).length;
  const assignee = memberName(card.assignee);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "grid w-full gap-1.5 rounded-xl border bg-card p-2.5 text-left text-sm shadow-xs transition-colors hover:border-primary/40",
        overlay && "rotate-2 cursor-grabbing shadow-lg",
      )}
    >
      {labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {labels.map((l) => (
            <span key={l.id} className={cn("h-1.5 min-w-6 rounded-full", labelClass(l.color), l.name && "h-auto px-1.5 text-[10px] leading-4 text-white")}>
              {l.name}
            </span>
          ))}
        </div>
      )}
      <span className="flex items-start gap-1 break-words">
        {card.priority === "high" && <ChevronsUpIcon className="mt-0.5 size-3.5 shrink-0 text-red-500" aria-label="우선순위 높음" />}
        <span className={cn(card.priority === "low" && "text-muted-foreground")}>{card.title}</span>
      </span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        {card.due && (
          <span className={cn("flex items-center gap-0.5", due === "overdue" && "text-red-600 dark:text-red-400", due === "soon" && "text-amber-600 dark:text-amber-400")}>
            <CalendarIcon className="size-3" />
            {formatDay(card.due)}
          </span>
        )}
        {card.checklist.length > 0 && (
          <span className={cn("flex items-center gap-0.5", checked === card.checklist.length && "text-primary")}>
            <ListChecksIcon className="size-3" />
            {checked}/{card.checklist.length}
          </span>
        )}
        {card.description && <AlignLeftIcon className="size-3" aria-label="설명 있음" />}
        {card.links.length > 0 && <LinkIcon className="size-3" aria-label="링크 있음" />}
        {assignee && <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-foreground">{assignee}</span>}
      </span>
    </button>
  );
}
