import type { Layout, LayoutItem, Section } from "@/api/preferences";
import type { Level, ModuleId } from "@/modules/meta";

export const GRID_COLS = 4;

export const newId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 12);

/** 권한이 있는 모듈의 항목만 화면에 보인다. 저장된 레이아웃에는 그대로 남아서 권한을 다시 받으면 돌아온다. */
export const isPermitted = (item: LayoutItem, perms: Record<ModuleId, Level>) => perms[item.module] !== "none";

/** 비어 있는 첫 칸(위→아래, 왼→오른쪽)을 찾는다 */
export function findSpot(items: Pick<LayoutItem, "x" | "y" | "w" | "h">[], w: number, h: number): { x: number; y: number } {
  const taken = (x: number, y: number) => items.some((i) => x < i.x + i.w && x + w > i.x && y < i.y + i.h && y + h > i.y);
  for (let y = 0; ; y++) {
    for (let x = 0; x + w <= GRID_COLS; x++) {
      if (!taken(x, y)) return { x, y };
    }
  }
}

type Seed = Omit<LayoutItem, "id" | "x" | "y">;

const icon = (module: ModuleId): Seed => ({ kind: "icon", module, w: 1, h: 1 });
const widget = (module: ModuleId, key: string, w: number, h: number): Seed => ({ kind: "widget", module, widget: key, w, h });

const DEFAULT_SECTIONS: { id: string; name: string; seeds: Seed[] }[] = [
  {
    id: "work",
    name: "업무",
    seeds: [widget("todo", "todo", 2, 2), widget("calendar", "calendar", 2, 1), icon("boards"), icon("notes"), icon("hub")],
  },
  {
    id: "life",
    name: "생활",
    seeds: [widget("health", "meal", 2, 1), widget("ledger", "ledger", 2, 1), icon("health"), icon("ledger"), icon("checklists")],
  },
];

/** 저장된 레이아웃이 없을 때: 권한 있는 모듈로 기본 레이아웃을 만든다 */
export function defaultLayout(perms: Record<ModuleId, Level>): Layout {
  const sections: Section[] = DEFAULT_SECTIONS.map(({ id, name, seeds }) => {
    const items: LayoutItem[] = [];
    for (const seed of seeds.filter((s) => perms[s.module] !== "none")) {
      items.push({ ...seed, id: newId(), ...findSpot(items, seed.w, seed.h) });
    }
    return { id, name, items };
  }).filter((s) => s.items.length > 0);
  return { version: 1, sections: sections.length > 0 ? sections : [{ id: "main", name: "홈", items: [] }] };
}

/** 그리드(react-grid-layout)가 바꾼 위치를 해당 섹션 항목에 반영한다. 화면에 없는 항목은 건드리지 않는다. */
export function applyPositions(section: Section, positions: readonly { i: string; x: number; y: number; w: number; h: number }[]): Section {
  const byId = new Map(positions.map((p) => [p.i, p]));
  return {
    ...section,
    items: section.items.map((item) => {
      const p = byId.get(item.id);
      return p ? { ...item, x: p.x, y: p.y, w: p.w, h: p.h } : item;
    }),
  };
}
