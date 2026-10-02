import { useState } from "react";
import type { Column, useBoardMutations } from "@/api/boards";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ErrorAlert } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Props = { column: Column; cardCount: number; isOnly: boolean; mut: ReturnType<typeof useBoardMutations>; onClose: () => void };

/** 컬럼 이름·완료 컬럼 지정·삭제 (카드가 없을 때만) */
export function ColumnDialog({ column, cardCount, isOnly, mut, onClose }: Props) {
  const [name, setName] = useState(column.name);
  const [done, setDone] = useState(column.done);
  const deletable = cardCount === 0 && !isOnly;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>컬럼 설정</DialogTitle>
        </DialogHeader>
        <form
          id="column-form"
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            mut.patchColumn.mutate({ id: column.id, name: name.trim(), done }, { onSuccess: onClose });
          }}
        >
          <Input autoFocus maxLength={30} value={name} onChange={(e) => setName(e.target.value)} aria-label="컬럼 이름" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={done} onChange={(e) => setDone(e.target.checked)} />
            완료 컬럼 (이 컬럼의 카드를 완료로 계산)
          </label>
        </form>
        {!deletable && <p className="text-xs text-muted-foreground">{isOnly ? "보드에는 컬럼이 하나 이상 있어야 합니다." : `카드 ${cardCount}개를 옮기거나 지워야 컬럼을 삭제할 수 있습니다.`}</p>}
        <ErrorAlert error={mut.patchColumn.error ?? mut.deleteColumn.error} />
        <DialogFooter className="flex-row items-center">
          <ConfirmButton type="button" variant="ghost" className="mr-auto" disabled={!deletable} title="컬럼을 삭제할까요?" description={column.name} confirmLabel="삭제" onConfirm={() => mut.deleteColumn.mutateAsync(column.id).then(onClose)}>
            삭제
          </ConfirmButton>
          <Button type="submit" form="column-form" disabled={!name.trim() || mut.patchColumn.isPending}>
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
