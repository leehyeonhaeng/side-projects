import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArchiveIcon, ArrowLeftIcon, CheckIcon, ChevronLeftIcon, FilterIcon, HistoryIcon, LayoutTemplateIcon, PencilIcon, PlusIcon, SettingsIcon, TagIcon, UsersIcon } from "lucide-react";
import { type BoardDetail, type Card, type Column, orderAt, useBoard, useBoardMutations, useSetFavorite } from "@/api/boards";
import { ApiError } from "@/api/client";
import { useMe } from "@/api/me";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActivityDialog } from "./ActivityDialog";
import { ArchiveDialog } from "./ArchiveDialog";
import { FavoriteButton, ROLE_LABEL } from "./BoardsPage";
import { type CardFilter, EMPTY_FILTER, FilterBar, isFiltering, matchesFilter } from "./FilterBar";
import { SaveTemplateDialog } from "./SaveTemplateDialog";
import { CardDialog } from "./CardDialog";
import { CardTile } from "./CardTile";
import { ColumnDialog } from "./ColumnDialog";
import { LabelsDialog } from "./LabelsDialog";
import { MembersDialog } from "./MembersDialog";
import { ProgressBar } from "./ProgressBar";

type Mutations = ReturnType<typeof useBoardMutations>;

/** DESIGN.md 6.6 작업 보드: 보드 → 컬럼 → 카드. PC는 드래그, 모바일은 길게 눌러 드래그 또는 카드의 "이동" */
export function BoardPage() {
  const { id = "" } = useParams();
  const board = useBoard(id);
  const mut = useBoardMutations(id);

  if (board.isPending) return <main className="p-4"><InlineSpinner /></main>;
  if (board.isError) {
    const gone = board.error instanceof ApiError && board.error.status === 404;
    return (
      <main className="mx-auto grid max-w-3xl justify-items-start gap-3 p-4">
        {gone ? <p className="text-sm text-muted-foreground">보드가 없거나 멤버가 아닙니다.</p> : <ErrorAlert error={board.error} />}
        <Button variant="outline" size="sm" nativeButton={false} render={<Link to="/boards" />}>
          보드 목록
        </Button>
      </main>
    );
  }
  return <BoardView data={board.data} mut={mut} />;
}

function BoardView({ data, mut }: { data: BoardDetail; mut: Mutations }) {
  const me = useMe();
  const navigate = useNavigate();
  const { board, role, columns, cards, members, progress } = data;
  const canEdit = role !== "viewer";
  const [renaming, setRenaming] = useState<string | null>(null);
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [openColumn, setOpenColumn] = useState<Column | null>(null);
  const [dialog, setDialog] = useState<"members" | "labels" | "archive" | "activity" | "template" | null>(null);
  const [dragging, setDragging] = useState<Card | null>(null);
  const [showFilter, setShowFilter] = useState(false);
  const [filter, setFilter] = useState<CardFilter>(EMPTY_FILTER);
  const favorite = useSetFavorite();
  const filtering = isFiltering(filter);
  const doneColumns = new Set(columns.filter((c) => c.done).map((c) => c.id));

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    // 모바일: 길게 눌러야 드래그 시작 (그냥 쓸면 화면 스크롤)
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const byColumn = (cid: string) => cards.filter((c) => c.columnId === cid);
  const shownIn = (cid: string) => byColumn(cid).filter((c) => matchesFilter(c, filter, me.data?.sub, doneColumns));
  const doneCount = cards.filter((c) => doneColumns.has(c.columnId)).length;
  const memberName = (sub?: string) => members.find((m) => m.sub === sub)?.name;
  const current = cards.find((c) => c.id === openCard) ?? null;

  const onDragStart = ({ active }: DragStartEvent) => setDragging(cards.find((c) => c.id === active.id) ?? null);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    const card = cards.find((c) => c.id === active.id);
    if (!card || !over || active.id === over.id) return;
    const overId = String(over.id);
    const overCard = cards.find((c) => c.id === overId);
    const target = overCard ? overCard.columnId : overId.replace(/^col:/, "");
    const list = byColumn(target);
    let others: Card[];
    let index: number;
    if (target === card.columnId) {
      const ids = list.map((c) => c.id);
      const moved = arrayMove(ids, ids.indexOf(card.id), overCard ? ids.indexOf(overCard.id) : ids.length - 1);
      index = moved.indexOf(card.id);
      others = list.filter((c) => c.id !== card.id);
    } else {
      others = list;
      index = overCard ? list.indexOf(overCard) : list.length;
    }
    mut.patchCard.mutate({ id: card.id, patch: { columnId: target, order: orderAt(others, index) } });
  };

  const moveColumn = (col: Column, dir: -1 | 1) => {
    const i = columns.findIndex((c) => c.id === col.id);
    const others = columns.filter((c) => c.id !== col.id);
    const index = Math.max(0, Math.min(others.length, i + dir));
    mut.patchColumn.mutate({ id: col.id, order: orderAt(others, index) });
  };

  const isOwner = role === "owner";
  const myMembership = members.find((m) => m.sub === me.data?.sub);

  return (
    <main className="grid min-w-0 gap-3 p-4">
      <header className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon-sm" nativeButton={false} render={<Link to="/boards" aria-label="보드 목록" />}>
          <ArrowLeftIcon />
        </Button>
        {renaming !== null ? (
          <form
            className="flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (renaming.trim()) mut.patchBoard.mutate({ name: renaming.trim() }, { onSuccess: () => setRenaming(null) });
            }}
          >
            <Input autoFocus maxLength={60} value={renaming} onChange={(e) => setRenaming(e.target.value)} className="h-8 w-56" />
            <Button type="submit" size="icon-sm" aria-label="저장">
              <CheckIcon />
            </Button>
          </form>
        ) : (
          <h1 className="flex items-center gap-1 text-lg font-semibold">
            {board.name}
            {canEdit && (
              <Button variant="ghost" size="icon-xs" aria-label="이름 변경" onClick={() => setRenaming(board.name)}>
                <PencilIcon />
              </Button>
            )}
          </h1>
        )}
        <FavoriteButton on={data.favorite} onClick={() => favorite.mutate({ id: board.id, favorite: !data.favorite })} />
        <span className="text-xs text-muted-foreground">{ROLE_LABEL[role]}</span>
        <div className="ml-auto flex gap-1">
          <Button variant="outline" size="sm" onClick={() => setDialog("members")}>
            <UsersIcon /> 멤버 {members.length}
          </Button>
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => setDialog("labels")}>
              <TagIcon /> 라벨
            </Button>
          )}
          {isOwner ? (
            <ConfirmButton variant="ghost" size="sm" title="보드를 삭제할까요?" description={`"${board.name}"의 컬럼·카드가 모두 지워지고 멤버도 더 이상 볼 수 없습니다.`} confirmLabel="삭제" onConfirm={() => mut.deleteBoard.mutateAsync().then(() => navigate("/boards"))}>
              삭제
            </ConfirmButton>
          ) : (
            myMembership && (
              <ConfirmButton variant="ghost" size="sm" title="보드에서 나갈까요?" description="다시 들어오려면 소유자가 초대해야 합니다. 내가 담당인 카드는 담당자가 비워집니다." confirmLabel="나가기" onConfirm={() => mut.removeMember.mutateAsync(myMembership.sub).then(() => navigate("/boards"))}>
                나가기
              </ConfirmButton>
            )
          )}
        </div>
        <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
          <div className="w-full max-w-xs">
            <ProgressBar progress={progress} />
          </div>
          <div className="flex flex-wrap gap-1">
            <Button variant={showFilter || filtering ? "secondary" : "ghost"} size="xs" onClick={() => setShowFilter(!showFilter)}>
              <FilterIcon /> 필터{filtering && " 적용 중"}
            </Button>
            {canEdit && (
              <ConfirmButton variant="ghost" size="xs" disabled={doneCount === 0} title="완료 카드를 보관할까요?" description={`완료 컬럼의 카드 ${doneCount}개를 보관함으로 옮깁니다. 보관함에서 언제든 복구할 수 있습니다.`} confirmLabel="보관" onConfirm={() => mut.archiveDone.mutateAsync(undefined)}>
                <ArchiveIcon /> 완료 카드 보관
              </ConfirmButton>
            )}
            <Button variant="ghost" size="xs" onClick={() => setDialog("archive")}>
              보관함 {data.archivedCount}
            </Button>
            <Button variant="ghost" size="xs" onClick={() => setDialog("activity")}>
              <HistoryIcon /> 활동
            </Button>
            {me.data?.perms.boards === "edit" && (
              <Button variant="ghost" size="xs" onClick={() => setDialog("template")}>
                <LayoutTemplateIcon /> 템플릿으로 저장
              </Button>
            )}
          </div>
        </div>
        {(showFilter || filtering) && <FilterBar filter={filter} onChange={setFilter} data={data} />}
      </header>
      <ErrorAlert error={mut.patchCard.error ?? mut.patchColumn.error ?? mut.patchBoard.error ?? mut.createCard.error ?? mut.createColumn.error ?? mut.archiveDone.error ?? favorite.error} />
      {filtering && canEdit && <p className="text-xs text-muted-foreground">필터 중에는 드래그가 꺼집니다. 카드를 열어 "컬럼·위치"로 옮기거나 필터를 해제하세요.</p>}

      <DndContext sensors={canEdit && !filtering ? sensors : undefined} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        <div className="-mx-4 flex snap-x snap-mandatory items-start gap-3 overflow-x-auto px-4 pb-4 sm:snap-none">
          {columns.map((col, i) => (
            <ColumnView
              key={col.id}
              column={col}
              cards={shownIn(col.id)}
              total={byColumn(col.id).length}
              board={data}
              canEdit={canEdit}
              memberName={memberName}
              first={i === 0}
              last={i === columns.length - 1}
              onMove={(dir) => moveColumn(col, dir)}
              onSettings={() => setOpenColumn(col)}
              onOpenCard={setOpenCard}
              onAdd={(title) => mut.createCard.mutateAsync({ title, columnId: col.id })}
            />
          ))}
          {canEdit && <AddColumn onAdd={(name) => mut.createColumn.mutateAsync({ name })} />}
        </div>
        <DragOverlay>{dragging && <CardTile card={dragging} board={data} memberName={memberName} overlay />}</DragOverlay>
      </DndContext>

      {current && <CardDialog key={current.id} card={current} data={data} mut={mut} readOnly={!canEdit} onClose={() => setOpenCard(null)} />}
      {openColumn && <ColumnDialog key={openColumn.id} column={openColumn} cardCount={byColumn(openColumn.id).length} isOnly={columns.length === 1} mut={mut} onClose={() => setOpenColumn(null)} />}
      {dialog === "members" && <MembersDialog data={data} mut={mut} onClose={() => setDialog(null)} />}
      {dialog === "labels" && <LabelsDialog labels={board.labels} mut={mut} onClose={() => setDialog(null)} />}
      {dialog === "archive" && <ArchiveDialog data={data} mut={mut} onClose={() => setDialog(null)} />}
      {dialog === "activity" && <ActivityDialog data={data} onOpenCard={(cid) => (setDialog(null), setOpenCard(cid))} onClose={() => setDialog(null)} />}
      {dialog === "template" && <SaveTemplateDialog boardId={board.id} defaultName={board.name} onClose={() => setDialog(null)} />}
    </main>
  );
}

type ColumnProps = {
  column: Column;
  cards: Card[];
  total: number;
  board: BoardDetail;
  canEdit: boolean;
  memberName: (sub?: string) => string | undefined;
  first: boolean;
  last: boolean;
  onMove: (dir: -1 | 1) => void;
  onSettings: () => void;
  onOpenCard: (id: string) => void;
  onAdd: (title: string) => Promise<unknown>;
};

function ColumnView({ column, cards, total, board, canEdit, memberName, first, last, onMove, onSettings, onOpenCard, onAdd }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${column.id}` });
  const [adding, setAdding] = useState<string | null>(null);

  return (
    <section ref={setNodeRef} className={`grid w-[85vw] max-w-72 shrink-0 snap-start gap-2 rounded-2xl border bg-muted/40 p-2 transition-colors sm:w-72 ${isOver ? "border-primary" : ""}`}>
      <div className="flex items-center gap-1 px-1">
        <h2 className="truncate text-sm font-medium">{column.name}</h2>
        {column.done && <CheckIcon className="size-3.5 shrink-0 text-primary" aria-label="완료 컬럼" />}
        <span className="text-xs tabular-nums text-muted-foreground">{cards.length === total ? total : `${cards.length}/${total}`}</span>
        {canEdit && (
          <div className="ml-auto flex">
            <Button variant="ghost" size="icon-xs" aria-label="왼쪽으로" disabled={first} onClick={() => onMove(-1)}>
              <ChevronLeftIcon />
            </Button>
            <Button variant="ghost" size="icon-xs" aria-label="오른쪽으로" disabled={last} onClick={() => onMove(1)}>
              <ChevronLeftIcon className="rotate-180" />
            </Button>
            <Button variant="ghost" size="icon-xs" aria-label="컬럼 설정" onClick={onSettings}>
              <SettingsIcon />
            </Button>
          </div>
        )}
      </div>

      <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <ul className="grid min-h-8 gap-2">
          {cards.map((c) => (
            <SortableCard key={c.id} card={c} board={board} memberName={memberName} disabled={!canEdit} onOpen={() => onOpenCard(c.id)} />
          ))}
        </ul>
      </SortableContext>

      {canEdit &&
        (adding === null ? (
          <Button variant="ghost" size="sm" className="justify-start text-muted-foreground" onClick={() => setAdding("")}>
            <PlusIcon /> 카드 추가
          </Button>
        ) : (
          <form
            className="grid gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              const title = adding.trim();
              if (title) void onAdd(title).then(() => setAdding(""));
            }}
          >
            <Input autoFocus placeholder="카드 제목" maxLength={200} value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setAdding(null)} className="h-8 bg-background" />
            <div className="flex gap-1">
              <Button type="submit" size="sm" disabled={!adding.trim()}>
                추가
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(null)}>
                닫기
              </Button>
            </div>
          </form>
        ))}
    </section>
  );
}

function SortableCard({ card, board, memberName, disabled, onOpen }: { card: Card; board: BoardDetail; memberName: (sub?: string) => string | undefined; disabled: boolean; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id, disabled });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={isDragging ? "opacity-40" : ""} {...attributes} {...listeners}>
      <CardTile card={card} board={board} memberName={memberName} onOpen={onOpen} />
    </li>
  );
}

function AddColumn({ onAdd }: { onAdd: (name: string) => Promise<unknown> }) {
  const [name, setName] = useState<string | null>(null);
  if (name === null)
    return (
      <Button variant="outline" className="w-48 shrink-0 snap-start" onClick={() => setName("")}>
        <PlusIcon /> 컬럼 추가
      </Button>
    );
  return (
    <form
      className="flex w-60 shrink-0 snap-start gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) void onAdd(name.trim()).then(() => setName(null));
      }}
    >
      <Input autoFocus placeholder="컬럼 이름" maxLength={30} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setName(null)} className="h-8" />
      <Button type="submit" size="sm" disabled={!name.trim()}>
        추가
      </Button>
    </form>
  );
}
