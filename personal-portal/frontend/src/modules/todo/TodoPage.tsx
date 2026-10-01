import { type ReactNode, useState } from "react";
import { DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon, PencilIcon, PlusIcon } from "lucide-react";
import { useMe } from "@/api/me";
import {
  type Todo,
  type TodoList,
  useCreateList,
  useCreateTodo,
  useDeleteList,
  useDeleteTodo,
  useRenameList,
  useTodoLists,
  useTodos,
  useUpdateTodo,
} from "@/api/todos";
import { ConfirmButton } from "@/components/ConfirmButton";
import { NativeSelect } from "@/components/NativeSelect";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { addDays, formatDay, todayStr } from "@/lib/dates";
import { TodoEditor } from "./TodoEditor";
import { todayView } from "./selectors";
import { TodoRow } from "./TodoRow";

type Sort = "due" | "priority" | "manual";
const PRIORITY_RANK = { high: 0, normal: 1, low: 2 } as const;

const byDue = (a: Todo, b: Todo) =>
  (a.due ?? "9999") .localeCompare(b.due ?? "9999") || (a.dueTime ?? "99").localeCompare(b.dueTime ?? "99") || a.order - b.order;
const byPriority = (a: Todo, b: Todo) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byDue(a, b);
const byOrder = (a: Todo, b: Todo) => a.order - b.order;
const SORTERS: Record<Sort, (a: Todo, b: Todo) => number> = { due: byDue, priority: byPriority, manual: byOrder };

/** DESIGN.md 6.2 할 일: 오늘 / 예정 / 전체 / 완료 */
export function TodoPage() {
  const me = useMe();
  const open = useTodos("open");
  const done = useTodos("done");
  const lists = useTodoLists();
  const create = useCreateTodo();
  const update = useUpdateTodo();
  const remove = useDeleteTodo();
  const [quick, setQuick] = useState("");
  const [sort, setSort] = useState<Sort>("due");
  const [editing, setEditing] = useState<{ todo: Todo | null; key: number } | null>(null);

  const readOnly = me.data?.perms.todo !== "edit";
  const today = todayStr();
  const listName = (id?: string) => lists.data?.find((l) => l.id === id)?.name;

  if (open.isPending || lists.isPending) return <InlineSpinner />;
  if (open.isError || lists.isError) return <ErrorAlert error={open.error ?? lists.error} />;

  const todos = open.data;
  const { pending: todayItems, completed: doneToday } = todayView(todos, done.data ?? [], today);
  const upcoming = todos.filter((t) => t.due && t.due > today).sort(byDue);

  const row = (t: Todo, handle?: ReactNode) => (
    <TodoRow
      key={t.id}
      todo={t}
      listName={listName(t.listId)}
      readOnly={readOnly}
      handle={handle}
      onToggle={() => update.mutate({ id: t.id, done: !t.done })}
      onPostpone={() => update.mutate({ id: t.id, due: addDays(today, 1) })}
      onOpen={() => setEditing({ todo: t, key: Date.now() })}
    />
  );

  return (
    <main className="mx-auto grid max-w-2xl gap-4 p-4 pb-28 sm:pb-8">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">할 일</h1>
        {!readOnly && (
          <Button size="sm" variant="outline" onClick={() => setEditing({ todo: null, key: Date.now() })}>
            <PlusIcon data-icon="inline-start" />
            자세히 추가
          </Button>
        )}
      </div>

      {!readOnly && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const title = quick.trim();
            if (!title) return;
            // 빠른 추가: 제목만 입력하고 엔터 → 오늘 날짜로 생성
            create.mutate({ title, due: today }, { onSuccess: () => setQuick("") });
          }}
        >
          <Input aria-label="빠른 추가" placeholder="할 일 입력 후 엔터 (오늘 날짜로 추가)" value={quick} onChange={(e) => setQuick(e.target.value)} maxLength={200} />
        </form>
      )}
      <ErrorAlert error={create.error ?? update.error ?? remove.error} />

      <Tabs defaultValue="today">
        <TabsList>
          <TabsTrigger value="today">오늘 {todayItems.length > 0 && <span className="text-xs text-muted-foreground">{todayItems.length}</span>}</TabsTrigger>
          <TabsTrigger value="upcoming">예정</TabsTrigger>
          <TabsTrigger value="all">전체</TabsTrigger>
          <TabsTrigger value="done">완료</TabsTrigger>
        </TabsList>

        <TabsContent value="today" className="grid gap-2 pt-3">
          {todayItems.length === 0 && doneToday.length === 0 ? <Empty>오늘 할 일이 없습니다.</Empty> : todayItems.map((t) => row(t))}
          {/* 오늘 완료한 것은 맨 아래에 취소선으로 남긴다. 체크를 다시 누르면 되돌림 */}
          {doneToday.length > 0 && <p className="pt-1 text-xs text-muted-foreground">오늘 완료 {doneToday.length}</p>}
          {doneToday.map((t) => row(t))}
          <SwipeHint readOnly={readOnly} />
        </TabsContent>

        <TabsContent value="upcoming" className="grid gap-4 pt-3">
          {upcoming.length === 0 ? (
            <Empty>예정된 할 일이 없습니다.</Empty>
          ) : (
            groupBy(upcoming, (t) => t.due!).map(([day, items]) => (
              <section key={day} className="grid gap-2">
                <h2 className="text-xs font-medium text-muted-foreground">{formatDay(day)}</h2>
                {items.map((t) => row(t))}
              </section>
            ))
          )}
        </TabsContent>

        <TabsContent value="all" className="grid gap-4 pt-3">
          <div className="flex items-center justify-between gap-2">
            <NativeSelect aria-label="정렬" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="due">마감일순</option>
              <option value="priority">우선순위순</option>
              <option value="manual">직접 순서</option>
            </NativeSelect>
            {!readOnly && <AddListButton />}
          </div>
          {[{ id: "", name: "목록 없음", order: -1 } as TodoList, ...lists.data].map((list) => {
            const items = todos.filter((t) => (t.listId ?? "") === list.id).sort(SORTERS[sort]);
            if (list.id === "" && items.length === 0) return null;
            return (
              <section key={list.id || "none"} className="grid gap-2">
                <ListHeader list={list} count={items.length} readOnly={readOnly} />
                {items.length === 0 ? (
                  <Empty>비어 있음</Empty>
                ) : sort === "manual" && !readOnly ? (
                  <SortableTodos items={items} onReorder={(id, order) => update.mutate({ id, order })} render={row} />
                ) : (
                  items.map((t) => row(t))
                )}
              </section>
            );
          })}
        </TabsContent>

        <TabsContent value="done" className="grid gap-2 pt-3">
          {done.isPending ? (
            <InlineSpinner />
          ) : done.data && done.data.length > 0 ? (
            done.data.map((t) => row(t))
          ) : (
            <Empty>완료한 할 일이 없습니다.</Empty>
          )}
          {done.data && done.data.length > 0 && <p className="text-xs text-muted-foreground">체크를 다시 누르면 복구됩니다. 최근 200개까지 표시합니다.</p>}
        </TabsContent>
      </Tabs>

      {editing && (
        <TodoEditor
          key={editing.key}
          todo={editing.todo}
          lists={lists.data}
          readOnly={readOnly}
          open
          onOpenChange={(o) => !o && setEditing(null)}
          onSave={(input) => (editing.todo ? update.mutateAsync({ id: editing.todo.id, ...input }) : create.mutateAsync(input))}
          onDelete={editing.todo ? () => remove.mutateAsync(editing.todo!.id).then(() => setEditing(null)) : undefined}
        />
      )}
    </main>
  );
}

function groupBy<T>(items: T[], key: (t: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const item of items) map.set(key(item), [...(map.get(key(item)) ?? []), item]);
  return [...map.entries()];
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">{children}</p>;
}

function SwipeHint({ readOnly }: { readOnly: boolean }) {
  if (readOnly) return null;
  return <p className="text-center text-[11px] text-muted-foreground sm:hidden">오른쪽으로 밀면 완료, 왼쪽으로 밀면 내일로 미룹니다.</p>;
}

/** 직접 순서: 손잡이로 끌어서 정렬하고, 놓은 자리 앞뒤 order의 중간값을 저장한다 */
function SortableTodos({ items, onReorder, render }: { items: Todo[]; onReorder: (id: string, order: number) => void; render: (t: Todo, handle: ReactNode) => ReactNode }) {
  const [local, setLocal] = useState(items);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const shown = local.length === items.length && local.every((t) => items.some((i) => i.id === t.id)) ? local.map((t) => items.find((i) => i.id === t.id)!) : items;

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = shown.findIndex((t) => t.id === active.id);
    const to = shown.findIndex((t) => t.id === over.id);
    const next = arrayMove(shown, from, to);
    setLocal(next);
    const prev = next[to - 1]?.order;
    const after = next[to + 1]?.order;
    const order = prev === undefined ? (after ?? 0) - 1 : after === undefined ? prev + 1 : (prev + after) / 2;
    onReorder(String(active.id), order);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={shown.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        {shown.map((t) => (
          <SortableItem key={t.id} id={t.id}>
            {(handle) => render(t, handle)}
          </SortableItem>
        ))}
      </SortableContext>
    </DndContext>
  );
}

function SortableItem({ id, children }: { id: string; children: (handle: ReactNode) => ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition } = useSortable({ id });
  const handle = (
    <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label="끌어서 순서 변경" className="mt-0.5 cursor-grab touch-none text-muted-foreground">
      <GripVerticalIcon className="size-4" />
    </button>
  );
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      {children(handle)}
    </div>
  );
}

function AddListButton() {
  const create = useCreateList();
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <PlusIcon data-icon="inline-start" />
        목록
      </Button>
    );
  }
  return (
    <form
      className="flex gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) create.mutate(name.trim(), { onSuccess: () => (setName(""), setOpen(false)) });
      }}
    >
      <Input aria-label="새 목록 이름" placeholder="목록 이름" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} className="h-8 w-32" autoFocus />
      <Button size="sm" type="submit" disabled={!name.trim() || create.isPending}>
        추가
      </Button>
    </form>
  );
}

function ListHeader({ list, count, readOnly }: { list: TodoList; count: number; readOnly: boolean }) {
  const rename = useRenameList();
  const remove = useDeleteList();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(list.name);

  if (editing) {
    return (
      <form
        className="flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) rename.mutate({ id: list.id, name: name.trim() }, { onSuccess: () => setEditing(false) });
        }}
      >
        <Input aria-label="목록 이름" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} className="h-8 w-40" autoFocus />
        <Button size="sm" type="submit">
          저장
        </Button>
        <ConfirmButton size="sm" variant="ghost" title="목록을 삭제할까요?" description="목록 안의 할 일은 '목록 없음'으로 옮겨집니다." confirmLabel="삭제" onConfirm={() => remove.mutateAsync(list.id)}>
          삭제
        </ConfirmButton>
      </form>
    );
  }
  return (
    <h2 className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
      {list.name} · {count}
      {list.id && !readOnly && (
        <Button size="icon-xs" variant="ghost" aria-label={`${list.name} 목록 편집`} onClick={() => setEditing(true)}>
          <PencilIcon />
        </Button>
      )}
    </h2>
  );
}
