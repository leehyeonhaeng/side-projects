"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  Users,
  ArrowLeftRight,
  Receipt,
  Bell,
  Settings,
} from "lucide-react";
import { logoutAction } from "@/app/login/actions";

export const NAV_ITEMS = [
  { key: "dashboard", href: "/", label: "대시보드", icon: LayoutDashboard, color: "indigo" },
  { key: "items", href: "/items", label: "재고관리", icon: Package, color: "blue" },
  { key: "partners", href: "/partners", label: "거래처관리", icon: Users, color: "violet" },
  { key: "payments", href: "/payments", label: "입출금관리", icon: ArrowLeftRight, color: "emerald" },
  { key: "receivables", href: "/receivables", label: "미수금·선납금", icon: Receipt, color: "amber" },
  { key: "notifications", href: "/notifications", label: "알림", icon: Bell, color: "rose" },
  { key: "settings", href: "/settings", label: "설정", icon: Settings, color: "zinc" },
];

// Tailwind은 클래스 문자열을 정적으로 스캔하므로, 색상별 클래스는
// 템플릿 문자열로 조립하지 않고 완전한 문자열을 그대로 나열해야 한다.
const ACTIVE_ITEM = {
  indigo: "bg-indigo-50 text-indigo-700",
  blue: "bg-blue-50 text-blue-700",
  violet: "bg-violet-50 text-violet-700",
  emerald: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-700",
  rose: "bg-rose-50 text-rose-700",
  zinc: "bg-zinc-100 text-zinc-900",
};

const ACTIVE_ICON = {
  indigo: "text-indigo-600",
  blue: "text-blue-600",
  violet: "text-violet-600",
  emerald: "text-emerald-600",
  amber: "text-amber-600",
  rose: "text-rose-600",
  zinc: "text-zinc-700",
};

function isActive(pathname, href) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export default function NavBarClient({ unread, hasPassword }) {
  const pathname = usePathname();

  return (
    <nav className="flex h-full flex-col">
      <div className="mb-6 flex items-center gap-2 px-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-black text-sm font-bold text-white">
          소
        </span>
        <span className="text-base font-semibold text-black">sojung</span>
      </div>

      <div className="flex flex-1 flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          const showBadge = item.key === "notifications" && unread > 0;
          return (
            <Link
              key={item.key}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? ACTIVE_ITEM[item.color]
                  : "text-zinc-600 hover:bg-zinc-100"
              }`}
            >
              <Icon size={18} className={active ? ACTIVE_ICON[item.color] : "text-zinc-400"} />
              <span className="flex-1">{item.label}</span>
              {showBadge && (
                <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-xs font-semibold text-rose-700">
                  {unread}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {hasPassword && (
        <form action={logoutAction} className="mt-4 px-2">
          <button
            type="submit"
            className="text-sm text-zinc-500 hover:text-zinc-800 hover:underline"
          >
            로그아웃
          </button>
        </form>
      )}
    </nav>
  );
}
