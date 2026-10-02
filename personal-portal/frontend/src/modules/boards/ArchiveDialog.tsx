import { type BoardDetail, formatTime, useArchived, type useBoardMutations } from "@/api/boards";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** 보관함: 복구하면 원래 컬럼(없어졌으면 첫 컬럼) 맨 아래로 */
export function ArchiveDialog({ data, mut, onClose }: { data: BoardDetail; mut: ReturnType<typeof useBoardMutations>; onClose: () => void }) {
  const archived = useArchived(data.board.id);
  const canEdit = data.role !== "viewer";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>보관함</DialogTitle>
          <DialogDescription>보관한 카드는 보드와 진행률에서 빠집니다. 복구하면 원래 컬럼 맨 아래로 돌아갑니다.</DialogDescription>
        </DialogHeader>
        {archived.isPending ? (
          <InlineSpinner />
        ) : archived.data?.length ? (
          <ul className="grid gap-1">
            {archived.data.map((c) => (
              <li key={c.id} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{c.title}</p>
                  {c.archivedAt && <p className="text-xs text-muted-foreground">{formatTime(c.archivedAt)} 보관</p>}
                </div>
                {canEdit && (
                  <>
                    <Button size="xs" variant="outline" disabled={mut.patchCard.isPending} onClick={() => mut.patchCard.mutate({ id: c.id, patch: { archived: false } })}>
                      복구
                    </Button>
                    <ConfirmButton size="xs" variant="ghost" title="카드를 완전히 삭제할까요?" description={c.title} confirmLabel="삭제" onConfirm={() => mut.deleteCard.mutateAsync(c.id)}>
                      삭제
                    </ConfirmButton>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">보관한 카드가 없습니다.</p>
        )}
        <ErrorAlert error={archived.error ?? mut.patchCard.error ?? mut.deleteCard.error} />
      </DialogContent>
    </Dialog>
  );
}
