import { useState } from "react";
import { Link } from "react-router";
import { PinIcon, PlusIcon, SearchIcon } from "lucide-react";
import { useMe } from "@/api/me";
import { type Note, TRASH_DAYS, noteTitle, notePreview, useNoteMutations, useNotes } from "@/api/notes";
import { PageTitle } from "@/components/ModuleIcon";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatTime } from "@/lib/dates";
import { cn } from "@/lib/utils";

/** DESIGN.md 6.7 메모: 목록(고정 → 최근 수정순), 태그 필터, 검색, 휴지통 */
export function NotesPage() {
  const me = useMe();
  const canEdit = me.data?.perms.notes === "edit";

  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 md:p-6">
      <div className="flex items-center justify-between gap-2">
        <PageTitle module="notes" />
        {canEdit && (
          <Button nativeButton={false} render={<Link to="/notes/new" />}>
            <PlusIcon /> 새 메모
          </Button>
        )}
      </div>
      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">메모</TabsTrigger>
          <TabsTrigger value="trash">휴지통</TabsTrigger>
        </TabsList>
        <TabsContent value="list" className="pt-3">
          <NoteList />
        </TabsContent>
        <TabsContent value="trash" className="pt-3">
          <Trash canEdit={canEdit} />
        </TabsContent>
      </Tabs>
    </main>
  );
}

function matches(n: Note, q: string, tag: string | null) {
  if (tag && !n.tags.includes(tag)) return false;
  if (!q) return true;
  const text = `${n.title}\n${n.body}\n${n.tags.join(" ")}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).every((w) => text.includes(w));
}

function NoteList() {
  const notes = useNotes();
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<string | null>(null);

  if (notes.isPending) return <InlineSpinner />;
  if (notes.isError) return <ErrorAlert error={notes.error} />;

  const tags = [...new Set(notes.data.flatMap((n) => n.tags))].sort((a, b) => a.localeCompare(b));
  const shown = notes.data.filter((n) => matches(n, q.trim(), tag));
  const pinned = shown.filter((n) => n.pinned);
  const rest = shown.filter((n) => !n.pinned);

  return (
    <div className="grid gap-3">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="제목·본문·태그 검색" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 pl-8" />
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tag === t}
              onClick={() => setTag(tag === t ? null : t)}
              className={cn("h-7 rounded-full border px-2.5 text-xs", tag === t ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
            >
              #{t}
            </button>
          ))}
        </div>
      )}
      {notes.data.length === 0 && <p className="text-sm text-muted-foreground">아직 메모가 없습니다.</p>}
      {notes.data.length > 0 && shown.length === 0 && <p className="text-sm text-muted-foreground">조건에 맞는 메모가 없습니다.</p>}
      {pinned.length > 0 && <Section title="고정" notes={pinned} />}
      {rest.length > 0 && <Section title={pinned.length ? "메모" : undefined} notes={rest} />}
    </div>
  );
}

function Section({ title, notes }: { title?: string; notes: Note[] }) {
  return (
    <section className="grid gap-1.5">
      {title && <h2 className="text-xs font-medium text-muted-foreground">{title}</h2>}
      <ul className="grid gap-1.5">
        {notes.map((n) => (
          <li key={n.id}>
            <Link to={`/notes/${n.id}`} className="grid gap-1 rounded-xl border bg-card px-3 py-2.5 transition-colors hover:bg-muted/50">
              <span className="flex items-center gap-1.5">
                {n.pinned && <PinIcon className="size-3.5 shrink-0 text-primary" aria-label="고정" />}
                <span className="truncate font-medium">{noteTitle(n)}</span>
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{formatTime(n.updatedAt)}</span>
              </span>
              {notePreview(n) && <span className="line-clamp-2 text-xs text-muted-foreground">{notePreview(n)}</span>}
              {n.tags.length > 0 && <span className="text-[11px] text-primary">{n.tags.map((t) => `#${t}`).join(" ")}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Trash({ canEdit }: { canEdit: boolean }) {
  const trash = useNotes(true);
  const mut = useNoteMutations();

  if (trash.isPending) return <InlineSpinner />;
  if (trash.isError) return <ErrorAlert error={trash.error} />;
  if (trash.data.length === 0) return <p className="text-sm text-muted-foreground">휴지통이 비어 있습니다. 지운 메모는 {TRASH_DAYS}일 동안 여기에 남습니다.</p>;

  const daysLeft = (deletedAt: string) => Math.max(0, TRASH_DAYS - Math.floor((Date.now() - new Date(deletedAt).getTime()) / 86_400_000));
  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted-foreground">지운 지 {TRASH_DAYS}일이 지나면 영구 삭제됩니다.</p>
      <ul className="grid gap-1.5">
        {trash.data.map((n) => (
          <li key={n.id} className="flex items-center gap-2 rounded-xl border px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{noteTitle(n)}</p>
              <p className="text-[11px] text-muted-foreground">{daysLeft(n.deletedAt!)}일 남음</p>
            </div>
            {canEdit && (
              <>
                <Button size="xs" variant="outline" disabled={mut.restore.isPending} onClick={() => mut.restore.mutate(n.id)}>
                  복구
                </Button>
                <ConfirmButton size="xs" variant="ghost" title="영구 삭제할까요?" description={`"${noteTitle(n)}"는 되돌릴 수 없습니다.`} confirmLabel="영구 삭제" onConfirm={() => mut.destroy.mutateAsync(n.id)}>
                  영구 삭제
                </ConfirmButton>
              </>
            )}
          </li>
        ))}
      </ul>
      <ErrorAlert error={mut.restore.error ?? mut.destroy.error} />
    </div>
  );
}
