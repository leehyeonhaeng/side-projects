import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeftIcon, CheckIcon, LayoutTemplateIcon, PencilIcon, RefreshCwIcon, UsersIcon, XIcon } from "lucide-react";
import { type ChecklistDetail, type ListItem, sortItems, useChecklist, useChecklistActions, useListCandidates, useListMutations } from "@/api/checklists";
import { ApiError } from "@/api/client";
import { useMe } from "@/api/me";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ROLE_LABEL, SharedMembersDialog } from "@/components/SharedMembersDialog";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { FavoriteButton } from "@/modules/boards/BoardsPage";
import { IconPicker } from "./IconPicker";

/** DESIGN.md 6.10 공용 체크리스트: 항목 체크(체크한 사람·시각), 체크 항목 아래, 일괄 삭제, 전체 해제, 템플릿 */
export function ChecklistPage() {
  const { id = "" } = useParams();
  const list = useChecklist(id);

  if (list.isPending) return <main className="p-4"><InlineSpinner /></main>;
  if (list.isError) {
    return (
      <main className="mx-auto grid max-w-2xl justify-items-start gap-3 p-4 md:p-6">
        {list.error instanceof ApiError && list.error.status === 404 ? <p className="text-sm text-muted-foreground">리스트가 없거나 참여하지 않은 리스트입니다.</p> : <ErrorAlert error={list.error} />}
        <Button variant="outline" size="sm" nativeButton={false} render={<Link to="/checklists" />}>
          리스트 목록
        </Button>
      </main>
    );
  }
  return <ListView data={list.data} refetch={() => void list.refetch()} refreshing={list.isFetching} />;
}

function ListView({ data, refetch, refreshing }: { data: ChecklistDetail; refetch: () => void; refreshing: boolean }) {
  const me = useMe();
  const navigate = useNavigate();
  const mut = useListMutations(data.list.id);
  const actions = useChecklistActions();
  const candidates = useListCandidates(data.list.id, data.role === "owner");
  const canEdit = data.role !== "viewer";
  const [text, setText] = useState("");
  const [editingName, setEditingName] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"members" | "template" | null>(null);
  const name = (sub?: string) => data.members.find((m) => m.sub === sub)?.name || "(나간 멤버)";
  const items = sortItems(data.items);
  const doneCount = data.items.filter((i) => i.done).length;
  const mine = data.members.find((m) => m.sub === me.data?.sub);

  // 여러 줄을 붙여넣으면 줄마다 항목 하나
  const add = (raw: string) => {
    const texts = raw.split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
    if (texts.length) mut.addItems.mutate(texts, { onSuccess: () => setText("") });
  };

  return (
    <main className="mx-auto grid max-w-2xl gap-3 p-4 md:p-6">
      <header className="flex flex-wrap items-center gap-1">
        <Button variant="ghost" size="icon-sm" nativeButton={false} render={<Link to="/checklists" aria-label="리스트 목록" />}>
          <ArrowLeftIcon />
        </Button>
        {canEdit ? <IconPicker value={data.list.icon} onChange={(icon) => mut.patchList.mutate({ icon })} /> : <span className="text-xl">{data.list.icon}</span>}
        {editingName !== null ? (
          <form
            className="flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (editingName.trim()) mut.patchList.mutate({ name: editingName.trim() }, { onSuccess: () => setEditingName(null) });
            }}
          >
            <Input autoFocus maxLength={40} value={editingName} onChange={(e) => setEditingName(e.target.value)} className="h-8 w-48" />
            <Button type="submit" size="icon-sm" aria-label="저장">
              <CheckIcon />
            </Button>
          </form>
        ) : (
          <h1 className="flex items-center gap-1 text-lg font-semibold">
            {data.list.name}
            {canEdit && (
              <Button variant="ghost" size="icon-xs" aria-label="이름 변경" onClick={() => setEditingName(data.list.name)}>
                <PencilIcon />
              </Button>
            )}
          </h1>
        )}
        <FavoriteButton on={data.favorite} onClick={() => actions.setFavorite.mutate({ id: data.list.id, favorite: !data.favorite })} />
        <span className="text-xs text-muted-foreground">{ROLE_LABEL[data.role]}</span>
        <div className="ml-auto flex gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="새로고침" onClick={refetch}>
            <RefreshCwIcon className={cn(refreshing && "animate-spin")} />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDialog("members")}>
            <UsersIcon /> {data.members.length}
          </Button>
        </div>
      </header>

      {canEdit && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add(text);
          }}
        >
          <Input
            placeholder="항목 추가 (여러 줄 붙여넣기 가능)"
            maxLength={2000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData("text");
              if (pasted.includes("\n")) {
                e.preventDefault();
                add(pasted);
              }
            }}
            className="h-10"
          />
        </form>
      )}
      <ErrorAlert error={mut.addItems.error ?? mut.patchItem.error ?? mut.deleteItem.error ?? mut.patchList.error ?? mut.clearDone.error ?? mut.uncheckAll.error} />

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">항목이 없습니다.</p>
      ) : (
        <ul className="grid gap-1">
          {items.map((i, idx) => (
            <ItemRow key={i.id} item={i} canEdit={canEdit} doneBy={name(i.doneBy)} firstDone={i.done && !items[idx - 1]?.done} onToggle={() => mut.patchItem.mutate({ iid: i.id, done: !i.done })} onRename={(t) => mut.patchItem.mutate({ iid: i.id, text: t })} onDelete={() => mut.deleteItem.mutate(i.id)} />
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-1 border-t pt-3">
        {canEdit && (
          <>
            <ConfirmButton size="sm" variant="ghost" disabled={doneCount === 0} title="체크한 항목을 지울까요?" description={`${doneCount}개를 삭제합니다.`} confirmLabel="삭제" onConfirm={() => mut.clearDone.mutateAsync(undefined)}>
              체크 항목 삭제
            </ConfirmButton>
            <Button size="sm" variant="ghost" disabled={doneCount === 0 || mut.uncheckAll.isPending} onClick={() => mut.uncheckAll.mutate(undefined)}>
              전체 체크 해제
            </Button>
          </>
        )}
        {me.data?.perms.checklists === "edit" && (
          <Button size="sm" variant="ghost" disabled={data.items.length === 0} onClick={() => setDialog("template")}>
            <LayoutTemplateIcon /> 템플릿으로 저장
          </Button>
        )}
        <div className="ml-auto">
          {data.role === "owner" ? (
            <ConfirmButton size="sm" variant="ghost" title="리스트를 삭제할까요?" description={`"${data.list.name}"의 항목이 모두 지워지고 참여자도 더 이상 볼 수 없습니다.`} confirmLabel="삭제" onConfirm={() => mut.deleteList.mutateAsync().then(() => navigate("/checklists"))}>
              리스트 삭제
            </ConfirmButton>
          ) : (
            mine && (
              <ConfirmButton size="sm" variant="ghost" title="리스트에서 나갈까요?" description="다시 들어오려면 소유자가 초대해야 합니다." confirmLabel="나가기" onConfirm={() => mut.removeMember.mutateAsync(mine.sub).then(() => navigate("/checklists"))}>
                나가기
              </ConfirmButton>
            )
          )}
        </div>
      </div>

      {dialog === "members" && (
        <SharedMembersDialog
          myRole={data.role}
          members={data.members}
          candidates={candidates}
          addMember={mut.addMember}
          patchMember={mut.patchMember}
          removeMember={mut.removeMember}
          editorHint="편집자는 항목을 추가·체크·삭제할 수 있고,"
          moduleLabel="체크리스트"
          removeNote=""
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "template" && <SaveTemplate listId={data.list.id} defaultName={data.list.name} onClose={() => setDialog(null)} />}
    </main>
  );
}

type RowProps = { item: ListItem; canEdit: boolean; doneBy: string; firstDone: boolean; onToggle: () => void; onRename: (text: string) => void; onDelete: () => void };

function ItemRow({ item: i, canEdit, doneBy, firstDone, onToggle, onRename, onDelete }: RowProps) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <li className={cn("flex items-center gap-2 rounded-lg border bg-card px-2 py-1.5", firstDone && "mt-2", i.done && "bg-muted/30")}>
      <button
        type="button"
        disabled={!canEdit}
        aria-label={i.done ? `${i.text} 체크 해제` : `${i.text} 체크`}
        onClick={onToggle}
        className="grid size-8 shrink-0 place-items-center rounded-full"
      >
        <span className={cn("grid size-5 place-items-center rounded-md border-2", i.done ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50")}>{i.done && <CheckIcon className="size-3.5" />}</span>
      </button>
      {editing !== null ? (
        <form
          className="flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (editing.trim()) onRename(editing.trim());
            setEditing(null);
          }}
        >
          <Input autoFocus maxLength={200} value={editing} onChange={(e) => setEditing(e.target.value)} onBlur={() => setEditing(null)} className="h-8" />
        </form>
      ) : (
        <button type="button" disabled={!canEdit} onClick={() => setEditing(i.text)} className="min-w-0 flex-1 text-left">
          <span className={cn("block text-sm break-words", i.done && "text-muted-foreground line-through")}>{i.text}</span>
          {i.done && i.doneAt && (
            <span className="text-[11px] text-muted-foreground">
              {doneBy} · {formatTime(i.doneAt)}
            </span>
          )}
        </button>
      )}
      {canEdit && editing === null && (
        <Button size="icon-xs" variant="ghost" aria-label="항목 삭제" onClick={onDelete}>
          <XIcon />
        </Button>
      )}
    </li>
  );
}

function SaveTemplate({ listId, defaultName, onClose }: { listId: string; defaultName: string; onClose: () => void }) {
  const [name, setName] = useState(defaultName.slice(0, 40));
  const save = useChecklistActions().saveTemplate;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>템플릿으로 저장</DialogTitle>
          <DialogDescription>항목 내용과 아이콘을 저장합니다(체크 상태는 저장하지 않음). 새 리스트를 만들 때 고를 수 있습니다.</DialogDescription>
        </DialogHeader>
        <form
          id="list-template-form"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ name: name.trim(), listId }, { onSuccess: onClose });
          }}
        >
          <Input autoFocus maxLength={40} value={name} onChange={(e) => setName(e.target.value)} aria-label="템플릿 이름" />
        </form>
        <ErrorAlert error={save.error} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" form="list-template-form" disabled={!name.trim() || save.isPending}>
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
