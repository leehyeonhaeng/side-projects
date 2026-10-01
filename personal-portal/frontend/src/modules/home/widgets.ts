import type { LucideIcon } from "lucide-react";
import { FootprintsIcon, ScaleIcon, UtensilsIcon } from "lucide-react";
import { type ModuleId, MODULE_BY_ID } from "@/modules/meta";

export type SizeKey = "1x1" | "2x1" | "2x2";

export type WidgetDef = {
  key: string;
  module: ModuleId;
  title: string;
  icon: LucideIcon;
  /** 크기별로 보여줄 내용 (DESIGN.md 6장 각 모듈의 홈 위젯) */
  sizes: Partial<Record<SizeKey, string>>;
};

const m = MODULE_BY_ID;

export const WIDGETS: WidgetDef[] = [
  { key: "calendar", module: "calendar", title: "일정", icon: m.calendar.icon, sizes: { "1x1": "오늘 일정 수", "2x1": "오늘 일정", "2x2": "이번 주 · 미니 달력" } },
  { key: "todo", module: "todo", title: "할 일", icon: m.todo.icon, sizes: { "1x1": "남은 개수", "2x1": "오늘 할 일 3개", "2x2": "오늘 + 지연 + 빠른 추가" } },
  { key: "meal", module: "health", title: "식단", icon: UtensilsIcon, sizes: { "1x1": "오늘 칼로리", "2x1": "게이지 + 탄단지", "2x2": "끼니 요약 + 빠른 입력" } },
  { key: "weight", module: "health", title: "체중", icon: ScaleIcon, sizes: { "1x1": "현재 체중", "2x1": "7일 추세", "2x2": "1개월 그래프 + 목표" } },
  { key: "exercise", module: "health", title: "운동", icon: FootprintsIcon, sizes: { "1x1": "이번 주 러닝 거리", "2x1": "오늘 할 훈련", "2x2": "주간 요약 + 진행률" } },
  { key: "boards", module: "boards", title: "작업 보드", icon: m.boards.icon, sizes: { "1x1": "진행 중 카드 수", "2x1": "내 담당 마감 임박", "2x2": "즐겨찾기 보드 요약" } },
  { key: "notes", module: "notes", title: "메모", icon: m.notes.icon, sizes: { "1x1": "빠른 메모", "2x1": "최근 메모 3개", "2x2": "고정 메모" } },
  { key: "ledger", module: "ledger", title: "가계부", icon: m.ledger.icon, sizes: { "1x1": "이번 달 지출", "2x1": "예산 게이지", "2x2": "카테고리 차트" } },
  { key: "hub", module: "hub", title: "스니펫·링크", icon: m.hub.icon, sizes: { "1x1": "검색창", "2x1": "즐겨찾기 링크", "2x2": "즐겨찾기 스니펫" } },
  { key: "checklists", module: "checklists", title: "체크리스트", icon: m.checklists.icon, sizes: { "1x1": "남은 항목 수", "2x1": "즐겨찾기 리스트" } },
];

export const WIDGET_BY_KEY = Object.fromEntries(WIDGETS.map((w) => [w.key, w])) as Record<string, WidgetDef>;

export const sizeKey = (w: number, h: number) => `${w}x${h}` as SizeKey;

const SIZE_ORDER: SizeKey[] = ["1x1", "2x1", "2x2"];

/** 크기 버튼: 위젯이 지원하는 다음 크기로 순환 */
export function nextSize(def: WidgetDef, w: number, h: number): { w: number; h: number } {
  const allowed = SIZE_ORDER.filter((s) => def.sizes[s]);
  const next = allowed[(allowed.indexOf(sizeKey(w, h)) + 1) % allowed.length] ?? "1x1";
  const [nw, nh] = next.split("x").map(Number) as [number, number];
  return { w: nw, h: nh };
}
