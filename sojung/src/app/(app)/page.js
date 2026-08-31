import Link from "next/link";
import { countLowStockItems } from "@/lib/inventory";
import { getBalanceBreakdown } from "@/lib/partners";
import { listPayments } from "@/lib/payments";
import { listNotifications } from "@/lib/notifications";

export const dynamic = "force-dynamic";

const DIRECTION_LABEL = { in: "입금", out: "출금" };

function StatCard({ label, value, href, tone }) {
  const toneClass =
    tone === "warn"
      ? "text-amber-600 dark:text-amber-400"
      : tone === "danger"
        ? "text-red-600 dark:text-red-400"
        : "text-black dark:text-zinc-50";
  return (
    <Link
      href={href}
      className="flex flex-col gap-1 rounded-md border border-zinc-200 bg-white p-4 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900/50"
    >
      <span className="text-xs text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className={`text-xl font-semibold ${toneClass}`}>{value}</span>
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
      <h1 className="mb-6 text-2xl font-semibold text-black dark:text-zinc-50">
        대시보드
      </h1>

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="재고 부족 품목"
          value={`${lowStockCount}건`}
          href="/items"
          tone={lowStockCount > 0 ? "danger" : undefined}
        />
        <StatCard
          label="미수금 합계"
          value={`${breakdown.receivable.total.toLocaleString()}원`}
          href="/receivables?category=receivable"
        />
        <StatCard
          label="미지급금 합계"
          value={`${breakdown.payable.total.toLocaleString()}원`}
          href="/receivables?category=payable"
        />
        <StatCard
          label="결제기한 임박/초과"
          value={`${breakdown.dueSoonCount + breakdown.overdueCount}건`}
          href="/receivables"
          tone={breakdown.overdueCount > 0 ? "danger" : breakdown.dueSoonCount > 0 ? "warn" : undefined}
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
