import ReactGridLayout, { type Layout as GridLayout, useContainerWidth, verticalCompactor } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import type { LayoutItem } from "@/api/preferences";
import { ItemCard } from "./ItemCard";
import { GRID_COLS } from "./layoutModel";

const GAP = 12;

type Props = {
  items: LayoutItem[];
  editing: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPositions: (positions: GridLayout) => void;
};

/** 섹션 하나 = 4칸 고정 그리드 (모든 기기에서 같은 배치, DESIGN 결정) */
export function SectionGrid({ items, editing, selectedId, onSelect, onPositions }: Props) {
  const { width, containerRef, mounted } = useContainerWidth();
  const cell = Math.max(48, (width - GAP * (GRID_COLS - 1)) / GRID_COLS);

  return (
    <div ref={containerRef}>
      {mounted && (
        <ReactGridLayout
          width={width}
          layout={items.map((i) => ({ i: i.id, x: i.x, y: i.y, w: i.w, h: i.h }))}
          gridConfig={{ cols: GRID_COLS, rowHeight: cell, margin: [GAP, GAP], containerPadding: [0, 0] }}
          dragConfig={{ enabled: editing, handle: ".drag-handle", bounded: true }}
          resizeConfig={{ enabled: false }}
          compactor={verticalCompactor}
          onLayoutChange={(layout) => editing && onPositions(layout)}
        >
          {items.map((item) => (
            <div key={item.id}>
              <ItemCard item={item} editing={editing} selected={selectedId === item.id} onSelect={onSelect} />
            </div>
          ))}
        </ReactGridLayout>
      )}
    </div>
  );
}
