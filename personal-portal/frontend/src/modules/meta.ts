export type Level = "none" | "view" | "edit";

export type ModuleId = "calendar" | "todo" | "health" | "boards" | "notes" | "ledger" | "hub" | "checklists";

export type ModuleMeta = { id: ModuleId; label: string; description: string; phase: number };

// DESIGN.md 5장·11장
export const MODULES: ModuleMeta[] = [
  { id: "calendar", label: "캘린더", description: "일정, 반복, 공휴일", phase: 4 },
  { id: "todo", label: "할 일", description: "마감일, 우선순위, 반복", phase: 4 },
  { id: "health", label: "식단·체중·운동", description: "AI 칼로리 추정, 기록", phase: 5 },
  { id: "boards", label: "작업 보드", description: "칸반, 멤버 초대", phase: 6 },
  { id: "notes", label: "메모", description: "마크다운, 태그", phase: 7 },
  { id: "ledger", label: "가계부", description: "예산, 통계", phase: 7 },
  { id: "hub", label: "스니펫·링크", description: "원탭 복사", phase: 7 },
  { id: "checklists", label: "공용 체크리스트", description: "참여 계정 간 공유", phase: 8 },
];

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
