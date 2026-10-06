import type { LucideIcon } from "lucide-react";
import {
  CalendarDaysIcon,
  CodeXmlIcon,
  HeartPulseIcon,
  ListChecksIcon,
  ListTodoIcon,
  SquareKanbanIcon,
  StickyNoteIcon,
  WalletIcon,
} from "lucide-react";

export type Level = "none" | "view" | "edit";

export type ModuleId = "calendar" | "todo" | "health" | "boards" | "notes" | "ledger" | "hub" | "checklists";

export type ModuleMeta = {
  id: ModuleId;
  label: string;
  description: string;
  path: string;
  icon: LucideIcon;
  phase: number;
  /** 모듈 색 (아이콘 배지·사이드바). Tailwind가 찾을 수 있게 클래스 전체를 적는다 */
  tone: string;
};

// DESIGN.md 5장(화면 구조)·11장(로드맵)
export const MODULES: ModuleMeta[] = [
  { id: "calendar", label: "캘린더", description: "일정, 반복, 공휴일", path: "/calendar", icon: CalendarDaysIcon, phase: 4, tone: "bg-rose-100 text-rose-600 dark:bg-rose-400/15 dark:text-rose-300" },
  { id: "todo", label: "할 일", description: "마감일, 우선순위, 반복", path: "/todo", icon: ListTodoIcon, phase: 4, tone: "bg-sky-100 text-sky-600 dark:bg-sky-400/15 dark:text-sky-300" },
  { id: "health", label: "식단·체중·운동", description: "AI 칼로리 추정, 기록", path: "/health", icon: HeartPulseIcon, phase: 5, tone: "bg-emerald-100 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-300" },
  { id: "boards", label: "작업 보드", description: "칸반, 멤버 초대", path: "/boards", icon: SquareKanbanIcon, phase: 6, tone: "bg-violet-100 text-violet-600 dark:bg-violet-400/15 dark:text-violet-300" },
  { id: "notes", label: "메모", description: "마크다운, 태그", path: "/notes", icon: StickyNoteIcon, phase: 7, tone: "bg-amber-100 text-amber-600 dark:bg-amber-400/15 dark:text-amber-300" },
  { id: "ledger", label: "가계부", description: "예산, 통계", path: "/ledger", icon: WalletIcon, phase: 7, tone: "bg-teal-100 text-teal-600 dark:bg-teal-400/15 dark:text-teal-300" },
  { id: "hub", label: "스니펫·링크", description: "원탭 복사", path: "/hub", icon: CodeXmlIcon, phase: 7, tone: "bg-indigo-100 text-indigo-600 dark:bg-indigo-400/15 dark:text-indigo-300" },
  { id: "checklists", label: "공용 체크리스트", description: "참여 계정 간 공유", path: "/checklists", icon: ListChecksIcon, phase: 8, tone: "bg-orange-100 text-orange-600 dark:bg-orange-400/15 dark:text-orange-300" },
];

export const MODULE_BY_ID = Object.fromEntries(MODULES.map((m) => [m.id, m])) as Record<ModuleId, ModuleMeta>;

export const LEVEL_LABEL: Record<Level, string> = { none: "없음", view: "열람", edit: "편집" };

/** 캘린더는 자기 일정만 다루므로 사용 가능/불가만 고른다 (DESIGN.md 4.2) */
export function levelOptions(module: ModuleId): { value: Level; label: string }[] {
  if (module === "calendar") {
    return [
      { value: "none", label: "불가" },
      { value: "edit", label: "사용" },
    ];
  }
  return (["none", "view", "edit"] as const).map((value) => ({ value, label: LEVEL_LABEL[value] }));
}
