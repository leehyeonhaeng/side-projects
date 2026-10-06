import { memo } from "react";
import { Link, useNavigate } from "react-router";
import { GripVerticalIcon } from "lucide-react";
import type { LayoutItem } from "@/api/preferences";
import { cn } from "@/lib/utils";
import { MODULE_BY_ID } from "@/modules/meta";
import { WidgetBody } from "./WidgetBody";
import { WIDGET_BY_KEY } from "./widgets";

type Props = {
  item: LayoutItem;
  editing: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
};

/** 홈 그리드의 아이콘·위젯 한 칸. 위젯 내용은 각 모듈 Phase에서 실제 데이터로 채운다. */
export const ItemCard = memo(function ItemCard({ item, editing, selected, onSelect }: Props) {
  const navigate = useNavigate();
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
        <span className={cn("grid aspect-square w-3/5 max-w-14 place-items-center rounded-2xl shadow-sm", module.tone)}>
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
  const header = (
    <div className={cn("flex items-center gap-1.5", compact && "flex-col justify-center text-center", editing && !compact && "pl-6")}>
      <span className={cn("grid size-6 shrink-0 place-items-center rounded-lg", module.tone)}>
        <Icon className="size-3.5" />
      </span>
      <span className="truncate text-sm font-medium">{def?.title ?? module.label}</span>
    </div>
  );

  if (editing) {
    return (
      <button type="button" className={cn(frame, "p-2.5 text-left sm:p-3")} onClick={() => onSelect(item.id)}>
        {handle}
        {header}
        {/* 편집 중에는 위젯 안 버튼·입력이 눌리지 않게 */}
        <div className="pointer-events-none flex min-h-0 flex-1 flex-col">
          <WidgetBody item={item} />
        </div>
      </button>
    );
  }

  // 위젯 어디를 눌러도 모듈 화면으로 간다. 안쪽 체크 버튼·입력창은 WidgetBody에서 클릭 전파를 막는다
  // (<a> 안에 버튼·입력을 넣을 수 없어서 링크 대신 role="link")
  return (
    <div
      role="link"
      tabIndex={0}
      aria-label={`${def?.title ?? module.label} 열기`}
      className={cn(frame, "cursor-pointer p-2.5 hover:shadow-md sm:p-3 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none")}
      onClick={() => navigate(module.path)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) navigate(module.path);
      }}
    >
      {header}
      <div className="flex min-h-0 flex-1 flex-col">
        <WidgetBody item={item} />
      </div>
    </div>
  );
});
