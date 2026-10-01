import { useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import type { Priority, Subtask, Todo, TodoInput, TodoList, TodoRepeat } from "@/api/todos";
import { ConfirmButton } from "@/components/ConfirmButton";
import { NativeSelect } from "@/components/NativeSelect";
import { ErrorAlert } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ISO_WEEKDAYS, isoWeekdayOf, todayStr } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { newId } from "@/modules/home/layoutModel";

type RepeatKind = "none" | TodoRepeat["freq"];

type Props = {
  todo: Todo | null; // null = 새 할 일
  lists: TodoList[];
  defaultListId?: string;
  readOnly: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (input: TodoInput & { title: string }) => Promise<unknown>;
  onDelete?: () => Promise<unknown>;
};

export function TodoEditor({ todo, lists, defaultListId, readOnly, open, onOpenChange, onSave, onDelete }: Props) {
  // 다이얼로그를 열 때마다 key로 새로 마운트해서 초기값을 다시 잡는다 (TodoPage)
  const [title, setTitle] = useState(todo?.title ?? "");
  const [note, setNote] = useState(todo?.note ?? "");
  const [due, setDue] = useState(todo?.due ?? (todo ? "" : todayStr()));
  const [dueTime, setDueTime] = useState(todo?.dueTime ?? "");
  const [priority, setPriority] = useState<Priority>(todo?.priority ?? "normal");
  const [listId, setListId] = useState(todo?.listId ?? defaultListId ?? "");
  const [repeatKind, setRepeatKind] = useState<RepeatKind>(todo?.repeat?.freq ?? "none");
  const [weekdays, setWeekdays] = useState<number[]>(todo?.repeat?.freq === "weekly" ? todo.repeat.weekdays : []);
  const [subtasks, setSubtasks] = useState<Subtask[]>(todo?.subtasks ?? []);
  const [newSubtask, setNewSubtask] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const repeat = (): TodoRepeat | null => {
    if (repeatKind === "none") return null;
    if (repeatKind === "weekly") return { freq: "weekly", weekdays: weekdays.length ? weekdays : [isoWeekdayOf(due || todayStr())] };
    return { freq: repeatKind };
  };

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      await onSave({
        title: title.trim(),
        note,
        due: due || null,
        dueTime: due && dueTime ? dueTime : null,
        priority,
        listId: listId || null,
        repeat: due ? repeat() : null,
        subtasks,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const addSubtask = () => {
    const text = newSubtask.trim();
    if (!text) return;
    setSubtasks((s) => [...s, { id: newId(), text, done: false }]);
    setNewSubtask("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{todo ? "할 일" : "새 할 일"}</DialogTitle>
        </DialogHeader>
        <fieldset disabled={readOnly} className="grid gap-3">
          <Input aria-label="제목" placeholder="제목" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus={!todo} />
          <Textarea aria-label="메모" placeholder="메모" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />

          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-xs text-muted-foreground">
              마감일
              <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">
              시간 (선택)
              <Input type="time" value={dueTime} disabled={!due} onChange={(e) => setDueTime(e.target.value)} />
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">
              우선순위
              <NativeSelect value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                <option value="high">높음</option>
                <option value="normal">보통</option>
                <option value="low">낮음</option>
              </NativeSelect>
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">
              목록
              <NativeSelect value={listId} onChange={(e) => setListId(e.target.value)}>
                <option value="">없음</option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </NativeSelect>
            </label>
          </div>

          <label className="grid gap-1 text-xs text-muted-foreground">
            반복 {!due && "(마감일이 있어야 반복할 수 있어요)"}
            <NativeSelect value={repeatKind} disabled={!due} onChange={(e) => setRepeatKind(e.target.value as RepeatKind)}>
              <option value="none">반복 안 함</option>
              <option value="daily">매일</option>
              <option value="weekdays">평일</option>
              <option value="weekly">매주</option>
              <option value="monthly">매월</option>
            </NativeSelect>
          </label>
          {repeatKind === "weekly" && due && (
            <div className="flex flex-wrap gap-1" role="group" aria-label="반복 요일">
              {ISO_WEEKDAYS.map((d) => {
                const on = weekdays.includes(d.value);
                return (
                  <button
                    key={d.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setWeekdays((w) => (on ? w.filter((x) => x !== d.value) : [...w, d.value]))}
                    className={cn("size-8 rounded-full border text-xs", on && "border-primary bg-primary text-primary-foreground")}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          )}

          <div className="grid gap-1.5">
            <p className="text-xs text-muted-foreground">하위 체크리스트</p>
            {subtasks.map((s) => (
              <div key={s.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  aria-label={s.text}
                  checked={s.done}
                  onChange={() => setSubtasks((all) => all.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)))}
                />
                <span className={cn("flex-1", s.done && "text-muted-foreground line-through")}>{s.text}</span>
                <Button size="icon-xs" variant="ghost" aria-label="삭제" onClick={() => setSubtasks((all) => all.filter((x) => x.id !== s.id))}>
                  <XIcon />
                </Button>
              </div>
            ))}
            <div className="flex gap-1">
              <Input
                aria-label="하위 항목 추가"
                placeholder="항목 추가"
                maxLength={200}
                value={newSubtask}
                onChange={(e) => setNewSubtask(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    addSubtask();
                  }
                }}
                className="h-8"
              />
              <Button size="icon-sm" variant="outline" aria-label="하위 항목 추가" onClick={addSubtask}>
                <PlusIcon />
              </Button>
            </div>
          </div>
        </fieldset>
        <ErrorAlert error={error} />
        <DialogFooter>
          {todo && onDelete && !readOnly && (
            <ConfirmButton variant="ghost" title="할 일을 삭제할까요?" description={todo.title} confirmLabel="삭제" onConfirm={onDelete} className="mr-auto">
              삭제
            </ConfirmButton>
          )}
          {!readOnly && (
            <Button disabled={!title.trim() || busy} onClick={() => void save()}>
              저장
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
