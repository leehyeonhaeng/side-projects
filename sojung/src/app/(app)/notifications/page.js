import { Bell } from "lucide-react";
import {
  listNotifications,
  ensureDueSoonAndOverdueNotifications,
  ensureAssetReturnNotifications,
  ensureLowStockNotifications,
} from "@/lib/notifications";
import { markReadAction } from "@/app/(app)/notifications/actions";

// 방문할 때마다 임박/초과 알림을 다시 계산해서 DB에 반영하므로, 빌드 시점에
// 정적 생성되며 실행되지 않도록 강제로 동적 렌더링한다.
export const dynamic = "force-dynamic";

const TYPE_LABEL = {
  payment_matched: "입금 매칭",
  payment_unmatched: "매칭 실패",
  due_soon: "결제기한 임박",
  overdue: "결제기한 초과",
  return_due_soon: "수거 임박",
  return_overdue: "수거 지남",
  low_stock: "재고 부족",
};

const TYPE_COLOR = {
  payment_matched: "text-emerald-700 dark:text-emerald-400",
  payment_unmatched: "text-red-600 dark:text-red-400",
  due_soon: "text-amber-600 dark:text-amber-400",
  overdue: "text-red-600 dark:text-red-400",
  return_due_soon: "text-amber-600 dark:text-amber-400",
  return_overdue: "text-red-600 dark:text-red-400",
  low_stock: "text-amber-600 dark:text-amber-400",
};

export default async function NotificationsPage() {
  ensureDueSoonAndOverdueNotifications();
  ensureAssetReturnNotifications();
  ensureLowStockNotifications();
  const notifications = listNotifications();

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-10">
      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-500 text-white">
          <Bell size={18} />
        </span>
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          알림
        </h1>
      </div>

      <div className="flex flex-col gap-2">
        {notifications.length === 0 && (
          <p className="rounded-md border border-zinc-200 bg-white px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-500">
            알림이 없습니다.
          </p>
        )}
        {notifications.map((n) => {
          const markRead = markReadAction.bind(null, n.id);
          return (
            <div
              key={n.id}
              className={`flex items-center justify-between gap-4 rounded-md border px-4 py-3 text-sm ${
                n.is_read
                  ? "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
                  : "border-zinc-300 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900"
              }`}
            >
              <div>
                <span className={`mr-2 text-xs font-semibold ${TYPE_COLOR[n.type]}`}>
                  {TYPE_LABEL[n.type]}
                </span>
                <span className="text-black dark:text-zinc-50">{n.message}</span>
                <span className="ml-2 text-xs text-zinc-400 dark:text-zinc-600">
                  {n.created_at}
                </span>
              </div>
              {!n.is_read && (
                <form action={markRead}>
                  <button
                    type="submit"
                    className="whitespace-nowrap rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
                  >
                    읽음
                  </button>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
