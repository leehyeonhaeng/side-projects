import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { PlusIcon, SquareKanbanIcon, UsersIcon } from "lucide-react";
import { type BoardRole, useBoards, useCreateBoard } from "@/api/boards";
import { useMe } from "@/api/me";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProgressBar } from "./ProgressBar";

export const ROLE_LABEL: Record<BoardRole, string> = { owner: "소유자", editor: "편집자", viewer: "열람자" };

/** DESIGN.md 5장 /boards: 내가 멤버인 보드 목록 */
export function BoardsPage() {
  const me = useMe();
  const boards = useBoards();
  const create = useCreateBoard();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const canCreate = me.data?.perms.boards === "edit";

  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4">
      <h1 className="flex items-center gap-2 text-xl font-semibold">
        <SquareKanbanIcon className="size-5 text-primary" />
        작업 보드
      </h1>

      {canCreate && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(name.trim(), { onSuccess: (b) => (setName(""), void navigate(`/boards/${b.id}`)) });
          }}
        >
          <Input placeholder="새 보드 이름" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
          <Button type="submit" disabled={!name.trim() || create.isPending}>
            <PlusIcon /> 만들기
          </Button>
        </form>
      )}
      <ErrorAlert error={create.error} />

      {boards.isPending ? (
        <InlineSpinner />
      ) : boards.isError ? (
        <ErrorAlert error={boards.error} />
      ) : boards.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{canCreate ? "아직 보드가 없습니다. 위에서 만들어 보세요." : "초대받은 보드가 없습니다."}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {boards.data.map((b) => (
            <li key={b.id}>
              <Link to={`/boards/${b.id}`} className="grid gap-2 rounded-2xl border bg-card p-4 transition-colors hover:bg-muted/50">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{b.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{ROLE_LABEL[b.role]}</span>
                </div>
                <ProgressBar progress={b.progress} />
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <UsersIcon className="size-3" /> {b.memberCount}명
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
