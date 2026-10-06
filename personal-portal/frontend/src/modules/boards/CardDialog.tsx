import { type ReactNode, useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { type BoardDetail, type Card, type CardLink, type CheckItem, type Priority, formatTime, labelClass, orderAt, type useBoardMutations, useComments } from "@/api/boards";
import { useMe } from "@/api/me";
import { ConfirmButton } from "@/components/ConfirmButton";
import { MarkdownView } from "@/components/MarkdownView";
import { NativeSelect } from "@/components/NativeSelect";
import { ErrorAlert } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { newId } from "@/modules/home/layoutModel";
import { ActivityList } from "./ActivityDialog";

type Props = { card: Card; data: BoardDetail; mut: ReturnType<typeof useBoardMutations>; readOnly: boolean; onClose: () => void };
type Position = "keep" | "top" | "bottom";

/** 카드 상세 (DESIGN.md 6.6 카드 항목). 모바일 "이동"은 여기의 컬럼·위치 선택 */
export function CardDialog({ card, data, mut, readOnly, onClose }: Props) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [preview, setPreview] = useState(readOnly || !!card.description);
  const [assignee, setAssignee] = useState(card.assignee ?? "");
  const [due, setDue] = useState(card.due ?? "");
  const [priority, setPriority] = useState<Priority>(card.priority);
  const [labels, setLabels] = useState(card.labels);
  const [checklist, setChecklist] = useState<CheckItem[]>(card.checklist);
  const [newItem, setNewItem] = useState("");
  const [links, setLinks] = useState<CardLink[]>(card.links);
  const [newLink, setNewLink] = useState<CardLink>({ title: "", url: "" });
  const [columnId, setColumnId] = useState(card.columnId);
  const [position, setPosition] = useState<Position>("keep");

  const save = () => {
    // 다른 컬럼으로 옮기면 기본은 맨 아래
    const pos: Position = columnId !== card.columnId && position === "keep" ? "bottom" : position;
    const others = data.cards.filter((c) => c.columnId === columnId && c.id !== card.id);
    const order = pos === "top" ? orderAt(others, 0) : pos === "bottom" ? orderAt(others, others.length) : undefined;
    mut.patchCard.mutate(
      {
        id: card.id,
        patch: {
          title: title.trim(),
          description,
          assignee: assignee || null,
          due: due || null,
          priority,
          labels,
          checklist,
          links,
          ...(order !== undefined ? { columnId, order } : {}),
        },
      },
      { onSuccess: onClose },
    );
  };

  // 체크리스트는 열람 화면에서도 바로 반영되게 체크할 때마다 저장 (편집자만)
  const toggleItem = (id: string) => {
    const next = checklist.map((i) => (i.id === id ? { ...i, done: !i.done } : i));
    setChecklist(next);
    mut.patchCard.mutate({ id: card.id, patch: { checklist: next } });
  };

  const addLink = () => {
    const url = newLink.url.trim();
    if (!/^https?:\/\//.test(url)) return;
    setLinks([...links, { title: newLink.title.trim(), url }]);
    setNewLink({ title: "", url: "" });
  };

  const done = checklist.filter((i) => i.done).length;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="sr-only">카드</DialogTitle>
          {readOnly ? <p className="pr-8 text-base font-semibold">{card.title}</p> : <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} className="mr-8 h-9 w-auto text-base font-medium" aria-label="제목" />}
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2">
          <Field label="컬럼">
            <NativeSelect value={columnId} disabled={readOnly} onChange={(e) => setColumnId(e.target.value)}>
              {data.columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {!readOnly && (
            <Field label="위치">
              <NativeSelect value={position} onChange={(e) => setPosition(e.target.value as Position)}>
                <option value="keep">{columnId === card.columnId ? "그대로" : "맨 아래"}</option>
                <option value="top">맨 위</option>
                <option value="bottom">맨 아래</option>
              </NativeSelect>
            </Field>
          )}
          <Field label="담당자">
            <NativeSelect value={assignee} disabled={readOnly} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">없음</option>
              {data.members.map((m) => (
                <option key={m.sub} value={m.sub}>
                  {m.name || m.email}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="마감일">
            <Input type="date" value={due} disabled={readOnly} onChange={(e) => setDue(e.target.value)} className="h-8" />
          </Field>
          <Field label="우선순위">
            <NativeSelect value={priority} disabled={readOnly} onChange={(e) => setPriority(e.target.value as Priority)}>
              <option value="high">높음</option>
              <option value="normal">보통</option>
              <option value="low">낮음</option>
            </NativeSelect>
          </Field>
        </div>

        {data.board.labels.length > 0 && (
          <Field label="라벨">
            <div className="flex flex-wrap gap-1">
              {data.board.labels.map((l) => {
                const on = labels.includes(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    disabled={readOnly}
                    aria-pressed={on}
                    onClick={() => setLabels(on ? labels.filter((x) => x !== l.id) : [...labels, l.id])}
                    className={cn("flex h-6 items-center gap-1 rounded-full border px-2 text-xs", on ? "border-transparent bg-muted text-foreground" : "text-muted-foreground opacity-60")}
                  >
                    <span className={cn("size-2.5 rounded-full", labelClass(l.color))} />
                    {l.name || "라벨"}
                  </button>
                );
              })}
            </div>
          </Field>
        )}

        <Field
          label="설명"
          action={
            !readOnly && (
              <Button type="button" size="xs" variant="ghost" onClick={() => setPreview(!preview)}>
                {preview ? "편집" : "미리보기"}
              </Button>
            )
          }
        >
          {preview ? (
            description ? (
              <MarkdownView text={description} />
            ) : (
              <p className="text-xs text-muted-foreground">설명 없음</p>
            )
          ) : (
            <Textarea rows={5} maxLength={10000} placeholder="마크다운 사용 가능 (**굵게**, - 목록, [링크](https://...))" value={description} onChange={(e) => setDescription(e.target.value)} />
          )}
        </Field>

        <Field label={`체크리스트${checklist.length ? ` ${done}/${checklist.length}` : ""}`}>
          <ul className="grid gap-1">
            {checklist.map((i) => (
              <li key={i.id} className="flex items-center gap-2">
                <input type="checkbox" className="size-4 accent-primary" checked={i.done} disabled={readOnly} onChange={() => toggleItem(i.id)} />
                <span className={cn("flex-1 text-sm", i.done && "text-muted-foreground line-through")}>{i.text}</span>
                {!readOnly && (
                  <Button type="button" size="icon-xs" variant="ghost" aria-label="항목 삭제" onClick={() => setChecklist(checklist.filter((x) => x.id !== i.id))}>
                    <XIcon />
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {!readOnly && (
            <form
              className="flex gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (newItem.trim()) setChecklist([...checklist, { id: newId(), text: newItem.trim(), done: false }]);
                setNewItem("");
              }}
            >
              <Input placeholder="항목 추가" maxLength={200} value={newItem} onChange={(e) => setNewItem(e.target.value)} className="h-8" />
              <Button type="submit" size="icon-sm" variant="outline" aria-label="추가" disabled={!newItem.trim()}>
                <PlusIcon />
              </Button>
            </form>
          )}
        </Field>

        <Field label="관련 링크">
          <ul className="grid gap-1">
            {links.map((l, idx) => (
              <li key={idx} className="flex items-center gap-2 text-sm">
                <a href={l.url} target="_blank" rel="noopener noreferrer" className="flex-1 truncate text-primary underline-offset-2 hover:underline">
                  {l.title || l.url}
                </a>
                {!readOnly && (
                  <Button type="button" size="icon-xs" variant="ghost" aria-label="링크 삭제" onClick={() => setLinks(links.filter((_, i) => i !== idx))}>
                    <XIcon />
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {!readOnly && links.length < 20 && (
            <div className="grid grid-cols-[1fr_auto] gap-1 sm:flex">
              <Input placeholder="이름 (선택)" maxLength={100} value={newLink.title} onChange={(e) => setNewLink({ ...newLink, title: e.target.value })} className="col-span-2 h-8 sm:w-28" />
              <Input placeholder="https://" type="url" maxLength={1000} value={newLink.url} onChange={(e) => setNewLink({ ...newLink, url: e.target.value })} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addLink())} className="h-8" />
              <Button type="button" size="icon-sm" variant="outline" aria-label="링크 추가" disabled={!/^https?:\/\//.test(newLink.url.trim())} onClick={addLink}>
                <PlusIcon />
              </Button>
            </div>
          )}
        </Field>

        <CardHistory card={card} data={data} readOnly={readOnly} />

        <ErrorAlert error={mut.patchCard.error ?? mut.deleteCard.error} />
        {!readOnly && (
          <DialogFooter className="flex-row flex-wrap items-center">
            <ConfirmButton type="button" variant="ghost" title="카드를 삭제할까요?" description={`${card.title} — 댓글도 함께 지워집니다. 지우지 않고 치우려면 "보관"을 쓰세요.`} confirmLabel="삭제" onConfirm={() => mut.deleteCard.mutateAsync(card.id).then(onClose)}>
              삭제
            </ConfirmButton>
            <Button type="button" variant="ghost" className="mr-auto" onClick={() => mut.patchCard.mutate({ id: card.id, patch: { archived: true } }, { onSuccess: onClose })}>
              보관
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              취소
            </Button>
            <Button type="button" disabled={!title.trim() || mut.patchCard.isPending} onClick={save}>
              저장
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, action, children }: { label: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        {action}
      </div>
      {children}
    </div>
  );
}


/** 카드 하단: 댓글 / 활동(변경 이력) */
function CardHistory({ card, data, readOnly }: { card: Card; data: BoardDetail; readOnly: boolean }) {
  const [tab, setTab] = useState<"comments" | "activity">("comments");
  return (
    <section className="grid gap-2 border-t pt-3">
      <div className="flex gap-1">
        <Button type="button" size="xs" variant={tab === "comments" ? "secondary" : "ghost"} onClick={() => setTab("comments")}>
          댓글
        </Button>
        <Button type="button" size="xs" variant={tab === "activity" ? "secondary" : "ghost"} onClick={() => setTab("activity")}>
          활동
        </Button>
      </div>
      {tab === "comments" ? <Comments card={card} data={data} readOnly={readOnly} /> : <ActivityList data={data} cardId={card.id} />}
    </section>
  );
}

function Comments({ card, data, readOnly }: { card: Card; data: BoardDetail; readOnly: boolean }) {
  const me = useMe();
  const { list, add, remove } = useComments(data.board.id, card.id);
  const [text, setText] = useState("");
  const name = (sub: string) => data.members.find((m) => m.sub === sub)?.name || "(나간 멤버)";
  const canDelete = (author: string) => !readOnly && (author === me.data?.sub || data.role === "owner");

  return (
    <div className="grid gap-2">
      {list.isPending ? null : list.data?.length ? (
        <ul className="grid gap-2">
          {list.data.map((c) => (
            <li key={c.id} className="grid gap-0.5 rounded-lg bg-muted/40 px-2.5 py-1.5">
              <div className="flex items-center gap-2 text-xs">
                <b className="font-medium">{name(c.author)}</b>
                <span className="text-muted-foreground">{formatTime(c.createdAt)}</span>
                {canDelete(c.author) && (
                  <button type="button" className="ml-auto text-muted-foreground hover:text-destructive" disabled={remove.isPending} onClick={() => remove.mutate(c.id)}>
                    삭제
                  </button>
                )}
              </div>
              <p className="text-sm whitespace-pre-wrap break-words">{c.text}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">댓글이 없습니다.</p>
      )}
      {!readOnly && (
        <form
          className="grid gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) add.mutate(text.trim(), { onSuccess: () => setText("") });
          }}
        >
          <Textarea rows={2} maxLength={2000} placeholder="댓글 입력" value={text} onChange={(e) => setText(e.target.value)} />
          <Button type="submit" size="sm" variant="outline" className="justify-self-end" disabled={!text.trim() || add.isPending}>
            댓글 달기
          </Button>
        </form>
      )}
      <ErrorAlert error={list.error ?? add.error ?? remove.error} />
    </div>
  );
}
