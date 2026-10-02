import { useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { LABEL_COLORS, type Label, type LabelColor, labelClass, type useBoardMutations } from "@/api/boards";
import { ErrorAlert } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { newId } from "@/modules/home/layoutModel";

/** 보드 라벨 (이름 + 색상). 지운 라벨은 카드에서도 빠진다 */
export function LabelsDialog({ labels: initial, mut, onClose }: { labels: Label[]; mut: ReturnType<typeof useBoardMutations>; onClose: () => void }) {
  const [labels, setLabels] = useState<Label[]>(initial);
  const update = (id: string, patch: Partial<Label>) => setLabels(labels.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const nextColor = (): LabelColor => LABEL_COLORS.find((c) => !labels.some((l) => l.color === c.value))?.value ?? "gray";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>라벨</DialogTitle>
          <DialogDescription>라벨을 지우면 그 라벨이 붙은 카드에서도 빠집니다.</DialogDescription>
        </DialogHeader>
        <ul className="grid gap-2">
          {labels.map((l) => (
            <li key={l.id} className="grid gap-1.5 rounded-lg border p-2">
              <div className="flex items-center gap-1">
                <Input placeholder="이름 (선택)" maxLength={20} value={l.name} onChange={(e) => update(l.id, { name: e.target.value })} className="h-8" />
                <Button type="button" size="icon-sm" variant="ghost" aria-label="라벨 삭제" onClick={() => setLabels(labels.filter((x) => x.id !== l.id))}>
                  <XIcon />
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {LABEL_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    aria-label={c.value}
                    aria-pressed={l.color === c.value}
                    onClick={() => update(l.id, { color: c.value })}
                    className={cn("size-6 rounded-full ring-offset-2 ring-offset-background", labelClass(c.value), l.color === c.value && "ring-2 ring-foreground")}
                  />
                ))}
              </div>
            </li>
          ))}
        </ul>
        {labels.length < 20 && (
          <Button type="button" variant="outline" size="sm" onClick={() => setLabels([...labels, { id: newId(), name: "", color: nextColor() }])}>
            <PlusIcon /> 라벨 추가
          </Button>
        )}
        <ErrorAlert error={mut.patchBoard.error} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button type="button" disabled={mut.patchBoard.isPending} onClick={() => mut.patchBoard.mutate({ labels: labels.map((l) => ({ ...l, name: l.name.trim() })) }, { onSuccess: onClose })}>
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
