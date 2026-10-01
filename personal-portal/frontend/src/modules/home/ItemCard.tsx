import { memo } from "react";
import { Link } from "react-router";
import { GripVerticalIcon } from "lucide-react";
import type { LayoutItem } from "@/api/preferences";
import { cn } from "@/lib/utils";
import { MODULE_BY_ID } from "@/modules/meta";
import { WIDGET_BY_KEY, sizeKey } from "./widgets";

type Props = {
  item: LayoutItem;
  editing: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
};

/** 홈 그리드의 아이콘·위젯 한 칸. 위젯 내용은 각 모듈 Phase에서 실제 데이터로 채운다. */
export const ItemCard = memo(function ItemCard({ item, editing, selected, onSelect }: Props) {
  const module = MODULE_BY_ID[item.module];
  const frame = cn(
    "relative flex h-full w-full flex-col overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-xs transition-shadow",
    editing && "cursor-pointer",
    selected && "ring-2 ring-primary",
  );

  const handle = editing && (
    <span
      className="drag-handle absolute top-1 left-1 z-10 grid size-6 cursor-grab touch-none place-items-center rounded-md bg-background/80 text-muted-foreground active:cursor-grabbing"
      aria-label="끌어서 이동"
    >
      <GripVerticalIcon className="size-4" />
    </span>
  );

  if (item.kind === "icon") {
    // 아이콘(바로가기)은 앱 아이콘처럼 배경 없이 그려서 위젯 카드와 구분한다
    const Icon = module.icon;
    const iconFrame = cn(
      "relative flex h-full w-full flex-col items-center justify-center gap-1 rounded-2xl p-1",
      editing && "cursor-pointer border border-dashed",
      selected && "ring-2 ring-primary",
    );
    const body = (
      <>
        <span className="grid aspect-square w-3/5 max-w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Icon className="size-1/2" />
        </span>
        <span className="line-clamp-2 text-center text-[11px] leading-tight">{module.label}</span>
      </>
    );
    return editing ? (
      <button type="button" className={iconFrame} onClick={() => onSelect(item.id)}>
        {handle}
        {body}
      </button>
    ) : (
      <Link to={module.path} className={cn(iconFrame, "hover:bg-muted/50")}>
        {body}
      </Link>
    );
  }

  const def = item.widget ? WIDGET_BY_KEY[item.widget] : undefined;
  const Icon = def?.icon ?? module.icon;
  const compact = item.w === 1;
  const content = (
    <>
      {handle}
      <div className={cn("flex items-center gap-1.5", compact && "flex-col justify-center text-center", editing && !compact && "pl-6")}>
        <Icon className="size-4 shrink-0 text-primary" />
        <span className="truncate text-sm font-medium">{def?.title ?? module.label}</span>
      </div>
      {!compact && <p className="mt-1 text-xs text-muted-foreground">{def?.sizes[sizeKey(item.w, item.h)]}</p>}
      <p className={cn("mt-auto text-[10px] text-muted-foreground", compact && "text-center")}>Phase {module.phase}</p>
    </>
  );

  return editing ? (
    <button type="button" className={cn(frame, "p-3 text-left")} onClick={() => onSelect(item.id)}>
      {content}
    </button>
  ) : (
    <Link to={module.path} className={cn(frame, "p-3 hover:shadow-md")}>
      {content}
    </Link>
  );
});
