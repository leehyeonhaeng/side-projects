import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { PlusIcon, StarIcon, UsersIcon, XIcon } from "lucide-react";
import { type BoardSummary, useBoards, useCreateBoard, useDeleteTemplate, useSetFavorite, useTemplates } from "@/api/boards";
import { useMe } from "@/api/me";
import { PageTitle } from "@/components/ModuleIcon";
import { ConfirmButton } from "@/components/ConfirmButton";
import { NativeSelect } from "@/components/NativeSelect";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ROLE_LABEL } from "@/components/SharedMembersDialog";
import { ProgressBar } from "./ProgressBar";

export { ROLE_LABEL } from "@/components/SharedMembersDialog";

/** DESIGN.md 5장 /boards: 내가 멤버인 보드 목록 (즐겨찾기 먼저) */
export function BoardsPage() {
  const me = useMe();
  const boards = useBoards();
  const templates = useTemplates();
  const create = useCreateBoard();
  const removeTemplate = useDeleteTemplate();
  const favorite = useSetFavorite();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const canCreate = me.data?.perms.boards === "edit";

  const sorted = [...(boards.data?.boards ?? [])].sort((a, b) => Number(b.favorite) - Number(a.favorite));

  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 md:p-6">
      <PageTitle module="boards" />

      {canCreate && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({ name: name.trim(), templateId: templateId || undefined }, { onSuccess: (b) => (setName(""), void navigate(`/boards/${b.id}`)) });
          }}
        >
          <Input placeholder="새 보드 이름" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} className="h-9 min-w-40 flex-1" />
          <NativeSelect value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="h-9" aria-label="템플릿">
            <option value="">기본 (할 일·진행 중·완료)</option>
            {templates.data?.map((t) => (
              <option key={t.id} value={t.id}>
                템플릿: {t.name}
              </option>
            ))}
          </NativeSelect>
          <Button type="submit" className="h-9" disabled={!name.trim() || create.isPending}>
            <PlusIcon /> 만들기
          </Button>
        </form>
      )}
      <ErrorAlert error={create.error ?? favorite.error} />

      {boards.isPending ? (
        <InlineSpinner />
      ) : boards.isError ? (
        <ErrorAlert error={boards.error} />
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">{canCreate ? "아직 보드가 없습니다. 위에서 만들어 보세요." : "초대받은 보드가 없습니다."}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {sorted.map((b) => (
            <BoardItem key={b.id} board={b} onFavorite={() => favorite.mutate({ id: b.id, favorite: !b.favorite })} />
          ))}
        </ul>
      )}

      {canCreate && (templates.data?.length ?? 0) > 0 && (
        <section className="grid gap-1">
          <h2 className="text-sm font-medium">내 템플릿</h2>
          <p className="text-xs text-muted-foreground">보드 화면의 "템플릿으로 저장"으로 컬럼 구성과 라벨을 저장합니다.</p>
          <ul className="flex flex-wrap gap-1">
            {templates.data?.map((t) => (
              <li key={t.id} className="flex items-center gap-1 rounded-full border py-0.5 pr-0.5 pl-2.5 text-xs">
                {t.name}
                <span className="text-muted-foreground">({t.columns.map((c) => c.name).join(" · ")})</span>
                <ConfirmButton size="icon-xs" variant="ghost" aria-label="템플릿 삭제" title="템플릿을 삭제할까요?" description={`"${t.name}" (이미 만든 보드에는 영향 없음)`} confirmLabel="삭제" onConfirm={() => removeTemplate.mutateAsync(t.id)}>
                  <XIcon />
                </ConfirmButton>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function BoardItem({ board: b, onFavorite }: { board: BoardSummary; onFavorite: () => void }) {
  return (
    <li className="relative">
      <Link to={`/boards/${b.id}`} className="grid gap-2 rounded-2xl border bg-card p-4 pr-11 transition-colors hover:bg-muted/50">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-medium">{b.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{ROLE_LABEL[b.role]}</span>
        </div>
        <ProgressBar progress={b.progress} />
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <UsersIcon className="size-3" /> {b.memberCount}명
          </span>
          <span>진행 중 {b.activeCount}</span>
        </span>
      </Link>
      <FavoriteButton on={b.favorite} onClick={onFavorite} className="absolute top-3 right-2" />
    </li>
  );
}

export function FavoriteButton({ on, onClick, className }: { on: boolean; onClick: () => void; className?: string }) {
  return (
    <Button variant="ghost" size="icon-sm" aria-label={on ? "즐겨찾기 해제" : "즐겨찾기"} aria-pressed={on} onClick={onClick} className={className}>
      <StarIcon className={cn(on && "fill-yellow-400 text-yellow-500")} />
    </Button>
  );
}
