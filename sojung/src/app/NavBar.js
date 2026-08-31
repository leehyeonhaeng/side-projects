import Link from "next/link";
import { countUnread } from "@/lib/notifications";
import { getLoginPasswordHash } from "@/lib/settings";
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

export default function NavBar({ active }) {
  const unread = countUnread();
  const hasPassword = !!getLoginPasswordHash();
  return (
    <div className="mb-2 flex items-center gap-4">
      {NAV_ITEMS.filter((item) => item.key !== active).map((item) => (
        <Link
          key={item.key}
          href={item.href}
          className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        >
          {item.label}
          {item.key === "notifications" && unread > 0 ? ` (${unread})` : ""}
        </Link>
      ))}
      {hasPassword && (
        <form action={logoutAction}>
          <button
            type="submit"
            className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
          >
            로그아웃
          </button>
        </form>
      )}
    </div>
  );
}
