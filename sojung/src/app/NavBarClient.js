"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/login/actions";

const NAV_ITEMS = [
  { key: "dashboard", href: "/", label: "대시보드" },
  { key: "items", href: "/items", label: "재고관리" },
  { key: "partners", href: "/partners", label: "거래처관리" },
  { key: "payments", href: "/payments", label: "입출금관리" },
  { key: "receivables", href: "/receivables", label: "미수금·선납금" },
  { key: "notifications", href: "/notifications", label: "알림" },
  { key: "settings", href: "/settings", label: "설정" },
];

function isActive(pathname, href) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export default function NavBarClient({ unread, hasPassword }) {
  const pathname = usePathname();

  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-zinc-200 pb-4 dark:border-zinc-800">
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.key}
            href={item.href}
            className={`whitespace-nowrap text-sm hover:underline ${
              active
                ? "font-semibold text-black dark:text-zinc-50"
                : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            {item.label}
            {item.key === "notifications" && unread > 0 ? ` (${unread})` : ""}
          </Link>
        );
      })}
      {hasPassword && (
        <form action={logoutAction} className="ml-auto">
          <button
            type="submit"
            className="whitespace-nowrap text-sm text-zinc-500 hover:underline dark:text-zinc-400"
          >
            로그아웃
          </button>
        </form>
      )}
    </div>
  );
}
