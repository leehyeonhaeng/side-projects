import { type PointerEvent, type ReactNode, useRef, useState } from "react";
import { CheckIcon, RepeatIcon } from "lucide-react";
import type { Todo } from "@/api/todos";
import { cn } from "@/lib/utils";
import { relativeDay, todayStr } from "@/lib/dates";

const SWIPE = 80;

type Props = {
  todo: Todo;
  listName?: string;
  readOnly: boolean;
  onToggle: () => void;
  onPostpone: () => void;
  onOpen: () => void;
  handle?: ReactNode;
};

const PRIORITY_DOT: Record<Todo["priority"], string> = { high: "bg-red-500", normal: "bg-transparent", low: "bg-muted-foreground/40" };

/** 할 일 한 줄. 모바일 스와이프: 오른쪽 → 완료, 왼쪽 → 내일로 미루기 (DESIGN.md 6.2) */
export function TodoRow({ todo, listName, readOnly, onToggle, onPostpone, onOpen, handle }: Props) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiping = useRef(false);
  const overdue = !todo.done && todo.due !== undefined && todo.due < todayStr();
  const doneSubtasks = todo.subtasks.filter((s) => s.done).length;

  const onPointerDown = (e: PointerEvent) => {
    if (readOnly || e.pointerType === "mouse") return;
    start.current = { x: e.clientX, y: e.clientY };
    swiping.current = false;
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!start.current) return;
    const x = e.clientX - start.current.x;
    const y = e.clientY - start.current.y;
    if (!swiping.current && Math.abs(x) > 12 && Math.abs(x) > Math.abs(y)) swiping.current = true;
    if (swiping.current) setDx(Math.max(-140, Math.min(140, x)));
  };
  const onPointerUp = () => {
    if (swiping.current) {
      if (dx > SWIPE) onToggle();
      else if (dx < -SWIPE && !todo.done) onPostpone();
    }
    start.current = null;
    setDx(0);
  };

  return (
    <div className="relative overflow-hidden rounded-xl">
      {dx !== 0 && (
        <div className={cn("absolute inset-0 flex items-center px-4 text-sm font-medium text-white", dx > 0 ? "justify-start bg-emerald-600" : "justify-end bg-amber-500")}>
          {dx > 0 ? (todo.done ? "되돌리기" : "완료") : "내일로"}
        </div>
      )}
      <div
        className="relative flex touch-pan-y items-start gap-3 border bg-card px-3 py-2.5"
        style={{ transform: `translateX(${dx}px)`, transition: dx === 0 ? "transform 0.15s" : undefined }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {handle}
        <button
          type="button"
          aria-label={todo.done ? "완료 취소" : "완료"}
          disabled={readOnly}
          onClick={onToggle}
          className={cn(
            "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2",
            todo.done ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50",
          )}
        >
          {todo.done && <CheckIcon className="size-3" />}
        </button>
        <button type="button" className="grid min-w-0 flex-1 gap-0.5 text-left" onClick={onOpen}>
          <span className={cn("flex items-center gap-1.5 text-sm", todo.done && "text-muted-foreground line-through")}>
            <span className={cn("size-1.5 shrink-0 rounded-full", PRIORITY_DOT[todo.priority])} />
            <span className="truncate">{todo.title}</span>
          </span>
          <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
            {todo.due && (
              <span className={cn(overdue && "font-medium text-red-600 dark:text-red-400")}>
                {relativeDay(todo.due)}
                {todo.dueTime && ` ${todo.dueTime}`}
              </span>
            )}
            {todo.repeat && <RepeatIcon className="size-3 self-center" aria-label="반복" />}
            {todo.subtasks.length > 0 && (
              <span>
                {doneSubtasks}/{todo.subtasks.length}
              </span>
            )}
            {listName && <span>{listName}</span>}
          </span>
        </button>
      </div>
    </div>
  );
}
