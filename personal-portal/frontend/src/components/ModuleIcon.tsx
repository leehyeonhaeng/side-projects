import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { MODULE_BY_ID, type ModuleId } from "@/modules/meta";

const SIZES = { sm: "size-7 rounded-lg [&_svg]:size-4", md: "size-9 rounded-xl [&_svg]:size-5", lg: "size-12 rounded-2xl [&_svg]:size-6" } as const;

/** 모듈 색 배지 안의 아이콘 (사이드바·하단 탭 메뉴·페이지 제목·홈 아이콘) */
export function ModuleIcon({ module, size = "md", icon, className }: { module: ModuleId; size?: keyof typeof SIZES; icon?: LucideIcon; className?: string }) {
  const meta = MODULE_BY_ID[module];
  const Icon = icon ?? meta.icon;
  return (
    <span className={cn("grid shrink-0 place-items-center", meta.tone, SIZES[size], className)} aria-hidden>
      <Icon />
    </span>
  );
}

/** 모듈 화면 제목: 색 배지 + 이름 */
export function PageTitle({ module, title, className }: { module: ModuleId; title?: string; className?: string }) {
  return (
    <h1 className={cn("flex items-center gap-2.5 text-xl font-bold tracking-tight", className)}>
      <ModuleIcon module={module} size="sm" />
      {title ?? MODULE_BY_ID[module].label}
    </h1>
  );
}
