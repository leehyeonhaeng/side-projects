import { type ReactNode, useState } from "react";
import { useSearchParams } from "react-router";
import { CheckIcon, CodeXmlIcon, CopyIcon, ExternalLinkIcon, FolderIcon, LinkIcon, PencilIcon, PlusIcon, SearchIcon, StarIcon } from "lucide-react";
import { type HubItem, type HubKind, copyText, langLabel, matchesHub, useCollections, useHubItems, useHubMutations } from "@/api/hub";
import { useMe } from "@/api/me";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./CodeBlock";
import { CollectionsDialog } from "./CollectionsDialog";
import { HubEditor } from "./HubEditor";

type KindFilter = "all" | HubKind;
const NO_COLLECTION = "__none__";

/** DESIGN.md 6.9 스니펫·링크 허브: 원탭 복사, 문법 강조, 태그·유형 필터, 검색, 즐겨찾기, 컬렉션 */
export function HubPage() {
  const me = useMe();
  const readOnly = me.data?.perms.hub !== "edit";
  const items = useHubItems();
  const collections = useCollections();
  const mut = useHubMutations();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [kind, setKind] = useState<KindFilter>("all");
  const [favOnly, setFavOnly] = useState(false);
  const [collection, setCollection] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ kind: HubKind; item: HubItem | null } | null>(null);
  const [managing, setManaging] = useState(false);

  const setQ = (value: string) => setParams(value ? { q: value } : {}, { replace: true });

  if (items.isPending || collections.isPending) return <main className="p-4"><InlineSpinner /></main>;
  if (items.isError || collections.isError) return <main className="p-4"><ErrorAlert error={items.error ?? collections.error} /></main>;

  const all = items.data;
  const tags = [...new Set(all.flatMap((i) => i.tags))].sort((a, b) => a.localeCompare(b));
  const shown = all
    .filter((i) => kind === "all" || i.kind === kind)
    .filter((i) => !favOnly || i.favorite)
    .filter((i) => collection === null || (collection === NO_COLLECTION ? !i.collectionId : i.collectionId === collection))
    .filter((i) => !tag || i.tags.includes(tag))
    .filter((i) => matchesHub(i, q.trim()))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite));
  const colName = (id?: string) => collections.data.find((c) => c.id === id)?.name;

  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <CodeXmlIcon className="size-5 text-primary" />
          스니펫·링크
        </h1>
        {!readOnly && (
          <div className="flex gap-1">
            <Button size="sm" onClick={() => setEditing({ kind: "snippet", item: null })}>
              <PlusIcon /> 스니펫
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing({ kind: "link", item: null })}>
              <PlusIcon /> 링크
            </Button>
          </div>
        )}
      </div>

      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="제목·코드·URL·설명·태그 검색" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 pl-8" />
      </div>

      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {(["all", "snippet", "link"] as const).map((k) => (
            <Chip key={k} on={kind === k} onClick={() => setKind(k)}>
              {{ all: "전체", snippet: "스니펫", link: "링크" }[k]}
            </Chip>
          ))}
          <Chip on={favOnly} onClick={() => setFavOnly(!favOnly)}>
            <StarIcon className={cn("size-3", favOnly && "fill-current")} /> 즐겨찾기
          </Chip>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <FolderIcon className="size-3.5 text-muted-foreground" />
          <Chip on={collection === null} onClick={() => setCollection(null)}>
            모든 컬렉션
          </Chip>
          {collections.data.map((c) => (
            <Chip key={c.id} on={collection === c.id} onClick={() => setCollection(collection === c.id ? null : c.id)}>
              {c.name}
            </Chip>
          ))}
          <Chip on={collection === NO_COLLECTION} onClick={() => setCollection(collection === NO_COLLECTION ? null : NO_COLLECTION)}>
            컬렉션 없음
          </Chip>
          {!readOnly && (
            <Button size="xs" variant="ghost" onClick={() => setManaging(true)}>
              관리
            </Button>
          )}
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map((t) => (
              <Chip key={t} on={tag === t} onClick={() => setTag(tag === t ? null : t)}>
                #{t}
              </Chip>
            ))}
          </div>
        )}
      </div>

      {all.length === 0 && <p className="text-sm text-muted-foreground">자주 쓰는 명령어나 문서 링크를 저장해 두고 한 번에 복사하세요.</p>}
      {all.length > 0 && shown.length === 0 && <p className="text-sm text-muted-foreground">조건에 맞는 항목이 없습니다.</p>}
      <ul className="grid gap-2">
        {shown.map((i) => (
          <ItemCard
            key={i.id}
            item={i}
            collectionName={colName(i.collectionId)}
            readOnly={readOnly}
            onFavorite={() => mut.patch.mutate({ id: i.id, favorite: !i.favorite })}
            onEdit={() => setEditing({ kind: i.kind, item: i })}
          />
        ))}
      </ul>
      <ErrorAlert error={mut.patch.error} />

      {editing && <HubEditor key={editing.item?.id ?? `new-${editing.kind}`} kind={editing.kind} item={editing.item} collections={collections.data} defaultCollection={collection && collection !== NO_COLLECTION ? collection : undefined} onClose={() => setEditing(null)} />}
      {managing && <CollectionsDialog collections={collections.data} counts={countBy(all)} onClose={() => setManaging(false)} />}
    </main>
  );
}

const countBy = (items: HubItem[]) => items.reduce<Record<string, number>>((acc, i) => (i.collectionId ? { ...acc, [i.collectionId]: (acc[i.collectionId] ?? 0) + 1 } : acc), {});

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn("flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs", on ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
    >
      {children}
    </button>
  );
}

export function CopyButton({ text, label = "복사", className }: { text: string; label?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "done" | "fail">("idle");
  return (
    <Button
      size="sm"
      variant={state === "done" ? "secondary" : "outline"}
      className={className}
      onClick={async (e) => {
        e.stopPropagation();
        setState((await copyText(text)) ? "done" : "fail");
        setTimeout(() => setState("idle"), 1500);
      }}
    >
      {state === "done" ? <CheckIcon /> : <CopyIcon />}
      {state === "done" ? "복사됨" : state === "fail" ? "복사 실패" : label}
    </Button>
  );
}

function ItemCard({ item: i, collectionName, readOnly, onFavorite, onEdit }: { item: HubItem; collectionName?: string; readOnly: boolean; onFavorite: () => void; onEdit: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const long = (i.code?.split("\n").length ?? 0) > 8;

  return (
    <li className="grid gap-2 rounded-2xl border bg-card p-3">
      <div className="flex items-start gap-2">
        {i.kind === "link" ? <LinkIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> : <CodeXmlIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
        <div className="min-w-0 flex-1">
          {i.kind === "link" ? (
            <a href={i.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 font-medium hover:underline">
              <span className="truncate">{i.title}</span>
              <ExternalLinkIcon className="size-3 shrink-0 text-muted-foreground" />
            </a>
          ) : (
            <p className="truncate font-medium">{i.title}</p>
          )}
          <p className="truncate text-xs text-muted-foreground">
            {i.kind === "link" ? i.url : langLabel(i.lang)}
            {collectionName && ` · ${collectionName}`}
          </p>
        </div>
        <Button size="icon-sm" variant="ghost" disabled={readOnly} aria-label={i.favorite ? "즐겨찾기 해제" : "즐겨찾기"} aria-pressed={i.favorite} onClick={onFavorite}>
          <StarIcon className={cn(i.favorite && "fill-yellow-400 text-yellow-500")} />
        </Button>
        {!readOnly && (
          <Button size="icon-sm" variant="ghost" aria-label="수정" onClick={onEdit}>
            <PencilIcon />
          </Button>
        )}
      </div>

      {i.kind === "snippet" && i.code && (
        <div className="relative">
          <CodeBlock code={i.code} lang={i.lang ?? "plaintext"} className={cn(!expanded && long && "max-h-44 overflow-hidden")} />
          <CopyButton text={i.code} className="absolute top-1.5 right-1.5 h-7 bg-background/90" />
          {long && (
            <Button size="xs" variant="ghost" className="mt-1" onClick={() => setExpanded(!expanded)}>
              {expanded ? "접기" : "전체 보기"}
            </Button>
          )}
        </div>
      )}
      {i.kind === "link" && i.url && <CopyButton text={i.url} label="URL 복사" className="justify-self-start" />}
      {i.description && <p className="text-sm whitespace-pre-wrap text-muted-foreground">{i.description}</p>}
      {i.tags.length > 0 && <p className="text-[11px] text-primary">{i.tags.map((t) => `#${t}`).join(" ")}</p>}
    </li>
  );
}

