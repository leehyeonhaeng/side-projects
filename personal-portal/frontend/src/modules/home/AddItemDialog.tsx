import { useState } from "react";
import type { Layout, LayoutItem } from "@/api/preferences";
import { NativeSelect } from "@/components/NativeSelect";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { type Level, MODULES, type ModuleId } from "@/modules/meta";
import { WIDGETS } from "./widgets";

type Candidate = Pick<LayoutItem, "kind" | "module" | "widget" | "w" | "h"> & { label: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layout: Layout;
  perms: Record<ModuleId, Level>;
  onAdd: (sectionId: string, candidate: Candidate) => void;
};

/** 아직 배치하지 않은 아이콘·위젯 목록. 숨긴 항목은 섹션의 "숨긴 항목"에서 다시 켠다. */
export function AddItemDialog({ open, onOpenChange, layout, perms, onAdd }: Props) {
  const [sectionId, setSectionId] = useState(layout.sections[0]?.id ?? "");
  const placed = layout.sections.flatMap((s) => s.items);
  const hasIcon = (m: ModuleId) => placed.some((i) => i.kind === "icon" && i.module === m);
  const hasWidget = (key: string) => placed.some((i) => i.kind === "widget" && i.widget === key);

  const icons: Candidate[] = MODULES.filter((m) => perms[m.id] !== "none" && !hasIcon(m.id)).map((m) => ({
    kind: "icon",
    module: m.id,
    w: 1,
    h: 1,
    label: m.label,
  }));
  const widgets: Candidate[] = WIDGETS.filter((w) => perms[w.module] !== "none" && !hasWidget(w.key)).map((w) => ({
    kind: "widget",
    module: w.module,
    widget: w.key,
    w: w.sizes["2x1"] ? 2 : 1,
    h: 1,
    label: w.title,
  }));

  const target = layout.sections.some((s) => s.id === sectionId) ? sectionId : (layout.sections[0]?.id ?? "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>항목 추가</DialogTitle>
          <DialogDescription>추가할 섹션을 고른 뒤 아이콘이나 위젯을 누르세요.</DialogDescription>
        </DialogHeader>
        <NativeSelect aria-label="추가할 섹션" value={target} onChange={(e) => setSectionId(e.target.value)}>
          {layout.sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </NativeSelect>
        {[
          { title: "위젯", list: widgets },
          { title: "아이콘 (바로가기)", list: icons },
        ].map(({ title, list }) => (
          <div key={title} className="grid gap-2">
            <p className="text-xs font-medium text-muted-foreground">{title}</p>
            {list.length === 0 ? (
              <p className="text-xs text-muted-foreground">추가할 수 있는 항목이 없습니다.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {list.map((c) => (
                  <Button key={`${c.kind}-${c.widget ?? c.module}`} size="sm" variant="outline" onClick={() => onAdd(target, c)}>
                    {c.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        ))}
      </DialogContent>
    </Dialog>
  );
}
