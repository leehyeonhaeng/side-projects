import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { ArrowLeftIcon, PinIcon, XIcon } from "lucide-react";
import { ApiError } from "@/api/client";
import { useMe } from "@/api/me";
import { type Note, useNote, useNoteMutations } from "@/api/notes";
import { MarkdownView } from "@/components/MarkdownView";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatTime } from "@/lib/dates";
import { cn } from "@/lib/utils";

/** /notes/new 또는 /notes/:id. 새 메모는 첫 저장 후 주소만 바꾸고 편집 화면은 그대로 둔다 */
export function NoteEditorPage() {
  const { id = "new" } = useParams();
  const location = useLocation();
  const isNew = id === "new";
  const note = useNote(isNew ? undefined : id);
  // 방금 만든 메모로 주소를 바꾼 경우(state.created)는 같은 편집기를 유지한다
  const editorKey = (location.state as { created?: boolean } | null)?.created ? "new" : id;

  if (!isNew && editorKey !== "new") {
    if (note.isPending) return <main className="p-4"><InlineSpinner /></main>;
    if (note.isError) {
      return (
        <main className="mx-auto grid max-w-3xl justify-items-start gap-3 p-4">
          {note.error instanceof ApiError && note.error.status === 404 ? <p className="text-sm text-muted-foreground">메모가 없거나 휴지통에 있습니다.</p> : <ErrorAlert error={note.error} />}
          <Button variant="outline" size="sm" nativeButton={false} render={<Link to="/notes" />}>
            메모 목록
          </Button>
        </main>
      );
    }
  }
  return <NoteEditor key={editorKey} initial={isNew || editorKey === "new" ? null : note.data!} />;
}

type Draft = { title: string; body: string; tags: string[]; pinned: boolean };
const toDraft = (n: Note | null): Draft => ({ title: n?.title ?? "", body: n?.body ?? "", tags: n?.tags ?? [], pinned: n?.pinned ?? false });
const same = (a: Draft, b: Draft) => a.title === b.title && a.body === b.body && a.pinned === b.pinned && a.tags.join("\n") === b.tags.join("\n");

function NoteEditor({ initial }: { initial: Note | null }) {
  const me = useMe();
  const readOnly = me.data?.perms.notes !== "edit";
  const navigate = useNavigate();
  const mut = useNoteMutations();
  const createAsync = mut.create.mutateAsync;
  const patchAsync = mut.patch.mutateAsync;
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial));
  const [preview, setPreview] = useState(readOnly || (!!initial && !!initial.body));
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [savedAt, setSavedAt] = useState<string | null>(initial?.updatedAt ?? null);
  const [error, setError] = useState<unknown>(null);
  const [tagInput, setTagInput] = useState("");

  const idRef = useRef(initial?.id);
  const savedRef = useRef(toDraft(initial));
  const latest = useRef(draft);
  latest.current = draft;
  const inflight = useRef<Promise<void> | null>(null);
  const deleted = useRef(false);

  /** 마지막 저장본과 다르면 저장. 동시에 두 번 저장(특히 새 메모 두 번 생성)하지 않게 앞 저장을 기다린다 */
  const flush = useCallback(async (): Promise<void> => {
    if (readOnly || deleted.current) return;
    while (inflight.current) await inflight.current;
    const v = latest.current;
    if (same(v, savedRef.current)) return;
    if (!idRef.current && !v.title.trim() && !v.body.trim()) return;
    const run = (async () => {
      setStatus("saving");
      try {
        const saved = idRef.current ? await patchAsync({ id: idRef.current, ...v }) : await createAsync(v);
        if (!idRef.current) {
          idRef.current = saved.id;
          void navigate(`/notes/${saved.id}`, { replace: true, state: { created: true } });
        }
        savedRef.current = v;
        setSavedAt(saved.updatedAt);
        setStatus("saved");
        setError(null);
      } catch (e) {
        setStatus("error");
        setError(e);
      }
    })();
    inflight.current = run;
    await run;
    inflight.current = null;
  }, [createAsync, patchAsync, navigate, readOnly]);

  // 입력이 멈추고 1초 뒤 저장
  useEffect(() => {
    const t = setTimeout(() => void flush(), 1000);
    return () => clearTimeout(t);
  }, [draft, flush]);

  // 앱이 백그라운드로 가거나 화면을 떠날 때 저장
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && void flushRef.current();
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      void flushRef.current();
    };
  }, []);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const addTag = (raw: string) => {
    const tags = raw
      .split(/[,\s]+/)
      .map((t) => t.replace(/^#/, "").trim().slice(0, 30))
      .filter(Boolean);
    if (tags.length) set({ tags: [...new Set([...draft.tags, ...tags])].slice(0, 20) });
    setTagInput("");
  };

  const moveToTrash = async () => {
    if (idRef.current) {
      deleted.current = true;
      await mut.trash.mutateAsync(idRef.current);
    }
    void navigate("/notes");
  };

  const statusText = { idle: savedAt ? `${formatTime(savedAt)} 저장됨` : "", saving: "저장 중…", saved: savedAt ? `${formatTime(savedAt)} 저장됨` : "저장됨", error: "저장 실패" }[status];

  return (
    <main className="mx-auto grid max-w-3xl gap-3 p-4">
      <header className="flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" nativeButton={false} render={<Link to="/notes" aria-label="메모 목록" />}>
          <ArrowLeftIcon />
        </Button>
        <span className={cn("text-xs text-muted-foreground", status === "error" && "text-destructive")}>{readOnly ? "읽기 전용" : statusText}</span>
        <div className="ml-auto flex gap-1">
          {!readOnly && (
            <>
              <Button variant={draft.pinned ? "secondary" : "ghost"} size="sm" aria-pressed={draft.pinned} onClick={() => set({ pinned: !draft.pinned })}>
                <PinIcon className={cn(draft.pinned && "fill-current text-primary")} /> 고정
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setPreview(!preview)}>
                {preview ? "편집" : "미리보기"}
              </Button>
              <Button variant="ghost" size="sm" disabled={mut.trash.isPending} onClick={() => void moveToTrash()}>
                휴지통으로
              </Button>
            </>
          )}
        </div>
      </header>

      {readOnly ? (
        draft.title && <h1 className="text-xl font-semibold">{draft.title}</h1>
      ) : (
        <Input placeholder="제목 (비우면 첫 줄이 제목)" maxLength={200} value={draft.title} onChange={(e) => set({ title: e.target.value })} className="h-10 border-none px-0 text-lg font-semibold shadow-none focus-visible:ring-0 dark:bg-transparent" />
      )}

      <div className="flex flex-wrap items-center gap-1">
        {draft.tags.map((t) => (
          <span key={t} className="flex h-6 items-center gap-0.5 rounded-full bg-muted pr-1 pl-2 text-xs">
            #{t}
            {!readOnly && (
              <button type="button" aria-label={`${t} 태그 삭제`} className="rounded-full p-0.5 hover:bg-background" onClick={() => set({ tags: draft.tags.filter((x) => x !== t) })}>
                <XIcon className="size-3" />
              </button>
            )}
          </span>
        ))}
        {!readOnly && draft.tags.length < 20 && (
          <input
            placeholder="+ 태그"
            value={tagInput}
            onChange={(e) => (/[,\s]$/.test(e.target.value) ? addTag(e.target.value) : setTagInput(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag(tagInput);
              }
            }}
            onBlur={() => tagInput && addTag(tagInput)}
            className="h-6 w-24 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
        )}
      </div>

      {preview ? (
        draft.body ? (
          <MarkdownView text={draft.body} className="min-h-40 border-none bg-transparent p-0" />
        ) : (
          <p className="text-sm text-muted-foreground">내용 없음</p>
        )
      ) : (
        <Textarea
          autoFocus={!initial}
          placeholder="마크다운 사용 가능 (# 제목, - 목록, **굵게**, [링크](https://...))"
          maxLength={50000}
          value={draft.body}
          onChange={(e) => set({ body: e.target.value })}
          className="min-h-[60dvh] resize-y font-[inherit] leading-relaxed"
        />
      )}
      <ErrorAlert error={error ?? mut.trash.error} />
    </main>
  );
}
