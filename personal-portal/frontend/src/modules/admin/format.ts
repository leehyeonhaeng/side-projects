import type { UserStatus } from "@/api/admin";

export const STATUS_LABEL: Record<UserStatus, string> = { pending: "승인 대기", active: "활성", suspended: "정지" };

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
}

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
