import Link from "next/link";
import {
  LayoutDashboard,
  Package,
  PackagePlus,
  UserPlus,
  Wallet,
  FileUp,
  CircleDollarSign,
  Receipt,
  Clock,
  Bell,
} from "lucide-react";
import { countLowStockItems } from "@/lib/inventory";
import { getBalanceBreakdown } from "@/lib/partners";
import { listPayments } from "@/lib/payments";
import { listNotifications } from "@/lib/notifications";

export const dynamic = "force-dynamic";

const DIRECTION_LABEL = { in: "입금", out: "출금" };

// Tailwind이 클래스 문자열을 정적으로 스캔하므로 색상 클래스는 완전한
// 문자열로 나열한다(템플릿 리터럴로 조립하면 스캔에서 누락된다).
const ICON_BG = {
  indigo: "bg-indigo-500",
  blue: "bg-blue-500",
  violet: "bg-violet-500",
  emerald: "bg-emerald-500",
  teal: "bg-teal-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
};

function QuickAction({ href, icon: Icon, label, color }) {
  return (
    <Link href={href} className="group flex flex-col items-center gap-2">
      <span
        className={`flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-sm transition-transform group-hover:scale-105 ${ICON_BG[color]}`}
      >
        <Icon size={24} />
      </span>
      <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
        {label}
      </span>
    </Link>
  );
}

function StatCard({ label, value, href, tone, icon: Icon, color }) {
  const toneClass =
    tone === "warn"
      ? "text-amber-600 dark:text-amber-400"
      : tone === "danger"
        ? "text-red-600 dark:text-red-400"
        : "text-black dark:text-zinc-50";
  return (
    <Link
      href={href}
      className="flex flex-col gap-3 rounded-md border border-zinc-200 bg-white p-4 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900/50"
    >
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-lg text-white ${ICON_BG[color]}`}
      >
        <Icon size={16} />
      </span>
      <span className="flex flex-col gap-1">
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{label}</span>
        <span className={`text-xl font-semibold ${toneClass}`}>{value}</span>
      </span>
    </Link>
  );
}

export default async function DashboardPage() {
  const lowStockCount = countLowStockItems();
  const breakdown = getBalanceBreakdown();
  const recentPayments = listPayments().slice(0, 5);
  const recentNotifications = listNotifications().slice(0, 5);

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pb-10">
      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500 text-white">
          <LayoutDashboard size={18} />
        </span>
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          대시보드
        </h1>
      </div>

      <div className="mb-8 flex flex-wrap gap-x-8 gap-y-4 rounded-md border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <QuickAction href="/items/new" icon={PackagePlus} label="품목 등록" color="blue" />
        <QuickAction href="/partners/new" icon={UserPlus} label="거래처 등록" color="violet" />
        <QuickAction href="/payments" icon={Wallet} label="입출금 등록" color="emerald" />
        <QuickAction href="/payments/import" icon={FileUp} label="거래내역 업로드" color="teal" />
        <QuickAction href="/receivables" icon={CircleDollarSign} label="미수금 확인" color="amber" />
        <QuickAction href="/notifications" icon={Bell} label="알림 확인" color="rose" />
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="재고 부족 품목"
          value={`${lowStockCount}건`}
          href="/items"
          tone={lowStockCount > 0 ? "danger" : undefined}
          icon={Package}
          color="blue"
        />
        <StatCard
          label="미수금 합계"
          value={`${breakdown.receivable.total.toLocaleString()}원`}
          href="/receivables?category=receivable"
          icon={CircleDollarSign}
          color="emerald"
        />
        <StatCard
          label="미지급금 합계"
          value={`${breakdown.payable.total.toLocaleString()}원`}
          href="/receivables?category=payable"
          icon={Receipt}
          color="amber"
        />
        <StatCard
          label="결제기한 임박/초과"
          value={`${breakdown.dueSoonCount + breakdown.overdueCount}건`}
          href="/receivables"
          tone={breakdown.overdueCount > 0 ? "danger" : breakdown.dueSoonCount > 0 ? "warn" : undefined}
          icon={Clock}
          color="rose"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-black dark:text-zinc-50">
              최근 입출금
            </h2>
            <Link
              href="/payments"
              className="text-xs text-zinc-500 hover:underline dark:text-zinc-400"
            >
              전체 보기
            </Link>
          </div>
          <div className="rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            {recentPayments.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-zinc-500 dark:text-zinc-500">
                입출금 내역이 없습니다.
              </p>
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {recentPayments.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between px-4 py-3 text-sm"
                  >
                    <span className="text-zinc-600 dark:text-zinc-400">
                      {p.paid_at} · {DIRECTION_LABEL[p.direction]} ·{" "}
                      {p.partner_name || "미매칭"}
                    </span>
                    <span className="font-medium text-black dark:text-zinc-50">
                      {p.amount.toLocaleString()}원
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-black dark:text-zinc-50">
              최근 알림
            </h2>
            <Link
              href="/notifications"
              className="text-xs text-zinc-500 hover:underline dark:text-zinc-400"
            >
              전체 보기
            </Link>
          </div>
          <div className="rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            {recentNotifications.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-zinc-500 dark:text-zinc-500">
                알림이 없습니다.
              </p>
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {recentNotifications.map((n) => (
                  <li key={n.id} className="px-4 py-3 text-sm">
                    <span
                      className={
                        n.is_read
                          ? "text-zinc-500 dark:text-zinc-500"
                          : "text-black dark:text-zinc-50"
                      }
                    >
                      {n.message}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
