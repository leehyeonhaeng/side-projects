import { useState } from "react";
import { type BoardDetail, useCandidates, type useBoardMutations } from "@/api/boards";
import { ConfirmButton } from "@/components/ConfirmButton";
import { NativeSelect } from "@/components/NativeSelect";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ROLE_LABEL } from "./BoardsPage";

type Role = "editor" | "viewer";

/** 보드 멤버 (DESIGN.md 6.6). 승인된 계정 중 보드 권한이 있는 계정을 골라 바로 추가. 관리는 소유자만 */
export function MembersDialog({ data, mut, onClose }: { data: BoardDetail; mut: ReturnType<typeof useBoardMutations>; onClose: () => void }) {
  const isOwner = data.role === "owner";
  const candidates = useCandidates(data.board.id, isOwner);
  const [pick, setPick] = useState("");
  const [role, setRole] = useState<Role>("editor");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>멤버</DialogTitle>
          <DialogDescription>편집자는 카드·컬럼·라벨을 바꿀 수 있고, 열람자는 보기만 합니다. 계정의 보드 권한이 열람이면 편집자여도 보기만 됩니다.</DialogDescription>
        </DialogHeader>

        <ul className="grid gap-1">
          {data.members.map((m) => (
            <li key={m.sub} className="flex items-center gap-2 rounded-lg border px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{m.name || m.email}</p>
                <p className="truncate text-xs text-muted-foreground">{m.email}</p>
              </div>
              {isOwner && m.role !== "owner" ? (
                <>
                  <NativeSelect value={m.role} onChange={(e) => mut.patchMember.mutate({ sub: m.sub, role: e.target.value as Role })}>
                    <option value="editor">편집자</option>
                    <option value="viewer">열람자</option>
                  </NativeSelect>
                  <ConfirmButton size="xs" variant="ghost" title="멤버를 내보낼까요?" description={`${m.name || m.email} — 담당인 카드는 담당자가 비워집니다.`} confirmLabel="내보내기" onConfirm={() => mut.removeMember.mutateAsync(m.sub)}>
                    내보내기
                  </ConfirmButton>
                </>
              ) : (
                <span className="text-xs text-muted-foreground">{ROLE_LABEL[m.role]}</span>
              )}
            </li>
          ))}
        </ul>

        {isOwner && (
          <div className="grid gap-2 border-t pt-3">
            <p className="text-xs text-muted-foreground">초대</p>
            {candidates.isPending ? (
              <InlineSpinner />
            ) : candidates.data?.length ? (
              <form
                className="flex flex-wrap gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (pick) mut.addMember.mutate({ sub: pick, role }, { onSuccess: () => (setPick(""), void candidates.refetch()) });
                }}
              >
                <NativeSelect value={pick} onChange={(e) => setPick(e.target.value)} className="min-w-0 flex-1">
                  <option value="">계정 선택</option>
                  {candidates.data.map((c) => (
                    <option key={c.sub} value={c.sub}>
                      {c.name ? `${c.name} (${c.email})` : c.email}
                    </option>
                  ))}
                </NativeSelect>
                <NativeSelect value={role} onChange={(e) => setRole(e.target.value as Role)}>
                  <option value="editor">편집자</option>
                  <option value="viewer">열람자</option>
                </NativeSelect>
                <Button type="submit" size="sm" className="h-8" disabled={!pick || mut.addMember.isPending}>
                  추가
                </Button>
              </form>
            ) : (
              <p className="text-xs text-muted-foreground">초대할 수 있는 계정이 없습니다. (보드 권한이 있는 승인된 계정만 초대 가능)</p>
            )}
          </div>
        )}
        <ErrorAlert error={candidates.error ?? mut.addMember.error ?? mut.patchMember.error ?? mut.removeMember.error} />
      </DialogContent>
    </Dialog>
  );
}
