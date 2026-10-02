import { useState } from "react";
import { useSaveTemplate } from "@/api/boards";
import { ErrorAlert } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/** 보드 템플릿: 이 보드의 컬럼 구성·라벨을 내 템플릿으로 저장 (카드는 저장하지 않음) */
export function SaveTemplateDialog({ boardId, defaultName, onClose }: { boardId: string; defaultName: string; onClose: () => void }) {
  const [name, setName] = useState(defaultName.slice(0, 40));
  const save = useSaveTemplate();

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>템플릿으로 저장</DialogTitle>
          <DialogDescription>컬럼 구성과 라벨만 저장합니다. 새 보드를 만들 때 고를 수 있습니다.</DialogDescription>
        </DialogHeader>
        <form
          id="template-form"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ name: name.trim(), boardId }, { onSuccess: onClose });
          }}
        >
          <Input autoFocus maxLength={40} value={name} onChange={(e) => setName(e.target.value)} aria-label="템플릿 이름" />
        </form>
        <ErrorAlert error={save.error} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" form="template-form" disabled={!name.trim() || save.isPending}>
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
