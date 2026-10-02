import { useState } from "react";
import { type Collection, useHubMutations } from "@/api/hub";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ErrorAlert } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/** 컬렉션 추가·이름 변경·삭제 (지우면 항목은 "컬렉션 없음"으로) */
export function CollectionsDialog({ collections, counts, onClose }: { collections: Collection[]; counts: Record<string, number>; onClose: () => void }) {
  const mut = useHubMutations();
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>컬렉션</DialogTitle>
          <DialogDescription>항목 하나는 컬렉션 하나에만 들어갑니다. 여러 분류는 태그를 쓰세요.</DialogDescription>
        </DialogHeader>
        <ul className="grid gap-1">
          {collections.map((c) => (
            <li key={c.id} className="flex items-center gap-1 rounded-lg border px-2 py-1">
              {renaming?.id === c.id ? (
                <form
                  className="flex flex-1 gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (renaming.name.trim()) mut.patchCollection.mutate({ id: c.id, name: renaming.name.trim() }, { onSuccess: () => setRenaming(null) });
                  }}
                >
                  <Input autoFocus maxLength={30} value={renaming.name} onChange={(e) => setRenaming({ id: c.id, name: e.target.value })} className="h-7" />
                  <Button type="submit" size="xs">
                    저장
                  </Button>
                </form>
              ) : (
                <button type="button" className="flex-1 text-left text-sm" onClick={() => setRenaming({ id: c.id, name: c.name })}>
                  {c.name} <span className="text-xs text-muted-foreground">{counts[c.id] ?? 0}개</span>
                </button>
              )}
              <ConfirmButton size="xs" variant="ghost" title="컬렉션을 삭제할까요?" description={`"${c.name}" — 안에 있던 ${counts[c.id] ?? 0}개는 지워지지 않고 "컬렉션 없음"이 됩니다.`} confirmLabel="삭제" onConfirm={() => mut.removeCollection.mutateAsync(c.id)}>
                삭제
              </ConfirmButton>
            </li>
          ))}
        </ul>
        <form
          className="flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) mut.createCollection.mutate(name.trim(), { onSuccess: () => setName("") });
          }}
        >
          <Input placeholder="새 컬렉션 (예: AWS, Git)" maxLength={30} value={name} onChange={(e) => setName(e.target.value)} className="h-8" />
          <Button type="submit" size="sm" variant="outline" className="h-8" disabled={!name.trim()}>
            추가
          </Button>
        </form>
        <ErrorAlert error={mut.createCollection.error ?? mut.patchCollection.error ?? mut.removeCollection.error} />
      </DialogContent>
    </Dialog>
  );
}
