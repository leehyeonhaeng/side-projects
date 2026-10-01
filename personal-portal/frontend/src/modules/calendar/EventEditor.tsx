import { useState } from "react";
import { type CalEvent, EVENT_COLORS, type EventColor, type EventInput, type EventRepeat, type Scope } from "@/api/events";
import { ConfirmButton } from "@/components/ConfirmButton";
import { NativeSelect } from "@/components/NativeSelect";
import { ErrorAlert } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type RepeatKind = "none" | EventRepeat["freq"];

type Props = {
  event: CalEvent | null; // null = 새 일정
  defaultDate: string;
  readOnly: boolean;
  onClose: () => void;
  onCreate: (input: EventInput & { title: string; start: string; repeat?: EventRepeat }) => Promise<unknown>;
  onUpdate: (input: EventInput, scope: Scope, repeat?: EventRepeat) => Promise<unknown>;
  onDelete: (scope: Scope) => Promise<unknown>;
};

/** 일정 만들기·수정. 반복 회차는 저장·삭제할 때 "이 일정만 / 전체"를 고른다 (DESIGN 결정). */
export function EventEditor({ event, defaultDate, readOnly, onClose, onCreate, onUpdate, onDelete }: Props) {
  const isOccurrence = Boolean(event?.seriesId && event.occurrenceDate);
  const [title, setTitle] = useState(event?.title ?? "");
  const [allDay, setAllDay] = useState(event?.allDay ?? true);
  const [start, setStart] = useState(event?.start ?? defaultDate);
  const [startTime, setStartTime] = useState(event?.startTime ?? "09:00");
  const [end, setEnd] = useState(event?.end ?? defaultDate);
  const [endTime, setEndTime] = useState(event?.endTime ?? "10:00");
  const [location, setLocation] = useState(event?.location ?? "");
  const [color, setColor] = useState<EventColor>(event?.color ?? "blue");
  const [memo, setMemo] = useState(event?.memo ?? "");
  const [repeatKind, setRepeatKind] = useState<RepeatKind>("none");
  const [until, setUntil] = useState("");
  const [askScope, setAskScope] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const input = (): EventInput => ({
    title: title.trim(),
    allDay,
    start,
    end: end < start ? start : end,
    startTime: allDay ? null : startTime,
    endTime: allDay ? null : endTime,
    location,
    color,
    memo,
  });

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
      onClose();
    } catch (err) {
      setError(err);
      setAskScope(null);
    } finally {
      setBusy(false);
    }
  };

  const save = (scope: Scope = "all") =>
    run(() => {
      if (!event) {
        const repeat = repeatKind === "none" ? undefined : { freq: repeatKind, until: until || null };
        return onCreate({ ...input(), title: title.trim(), start, repeat });
      }
      return onUpdate(input(), scope);
    });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{event ? "일정" : "새 일정"}</DialogTitle>
        </DialogHeader>

        {askScope ? (
          <div className="grid gap-3 text-sm">
            <p>반복 일정입니다. 어디까지 {askScope === "save" ? "바꿀" : "삭제할"}까요?</p>
            <div className="grid gap-2">
              <Button variant="outline" disabled={busy} onClick={() => void (askScope === "save" ? save("this") : run(() => onDelete("this")))}>
                이 일정만
              </Button>
              <Button variant={askScope === "delete" ? "destructive" : "default"} disabled={busy} onClick={() => void (askScope === "save" ? save("all") : run(() => onDelete("all")))}>
                반복 일정 전체
              </Button>
              {askScope === "save" && <p className="text-xs text-muted-foreground">전체를 바꿀 때 날짜 변경은 반영되지 않습니다. 날짜는 "이 일정만"으로 옮기세요.</p>}
              <Button variant="ghost" onClick={() => setAskScope(null)}>
                돌아가기
              </Button>
            </div>
          </div>
        ) : (
          <fieldset disabled={readOnly} className="grid gap-3">
            <Input aria-label="제목" placeholder="제목" maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus={!event} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
              종일
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-xs text-muted-foreground">
                시작
                <Input
                  type="date"
                  value={start}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (end < v || end === start) setEnd(v);
                    setStart(v);
                  }}
                />
              </label>
              <label className="grid gap-1 text-xs text-muted-foreground">
                종료
                <Input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
              </label>
              {!allDay && (
                <>
                  <Input type="time" aria-label="시작 시간" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                  <Input type="time" aria-label="종료 시간" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </>
              )}
            </div>
            <Input aria-label="장소" placeholder="장소" maxLength={100} value={location} onChange={(e) => setLocation(e.target.value)} />
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="색상">
              {EVENT_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  role="radio"
                  aria-checked={color === c.value}
                  aria-label={c.label}
                  onClick={() => setColor(c.value)}
                  className={cn("size-6 rounded-full ring-offset-2 ring-offset-background", color === c.value && "ring-2 ring-foreground")}
                  style={{ backgroundColor: c.hex }}
                />
              ))}
            </div>
            {!event && (
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-xs text-muted-foreground">
                  반복
                  <NativeSelect value={repeatKind} onChange={(e) => setRepeatKind(e.target.value as RepeatKind)}>
                    <option value="none">반복 안 함</option>
                    <option value="daily">매일</option>
                    <option value="weekly">매주</option>
                    <option value="monthly">매월</option>
                    <option value="yearly">매년</option>
                  </NativeSelect>
                </label>
                {repeatKind !== "none" && (
                  <label className="grid gap-1 text-xs text-muted-foreground">
                    종료일 (선택)
                    <Input type="date" min={start} value={until} onChange={(e) => setUntil(e.target.value)} />
                  </label>
                )}
              </div>
            )}
            {isOccurrence && <p className="text-xs text-muted-foreground">반복 일정의 한 회차입니다.</p>}
            <Textarea aria-label="메모" placeholder="메모" rows={3} maxLength={2000} value={memo} onChange={(e) => setMemo(e.target.value)} />
          </fieldset>
        )}

        <ErrorAlert error={error} />
        {!askScope && !readOnly && (
          <DialogFooter>
            {event &&
              (isOccurrence ? (
                <Button variant="ghost" className="mr-auto" disabled={busy} onClick={() => setAskScope("delete")}>
                  삭제
                </Button>
              ) : (
                <ConfirmButton variant="ghost" className="mr-auto" title="일정을 삭제할까요?" description={event.title} confirmLabel="삭제" onConfirm={() => run(() => onDelete("all"))}>
                  삭제
                </ConfirmButton>
              ))}
            <Button disabled={!title.trim() || busy} onClick={() => (isOccurrence ? setAskScope("save") : void save())}>
              저장
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
