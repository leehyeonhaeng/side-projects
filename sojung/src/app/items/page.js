import Link from "next/link";
import { listItemsWithStock } from "@/lib/inventory";
import { countUnread } from "@/lib/notifications";

export default async function ItemsPage({ searchParams }) {
  const { q } = await searchParams;
  const items = listItemsWithStock({ query: q });
  const unread = countUnread();

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <div className="mb-2 flex gap-4">
          <Link
            href="/partners"
            className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
          >
            거래처관리
          </Link>
          <Link
            href="/payments"
            className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
          >
            입출금관리
          </Link>
          <Link
            href="/notifications"
            className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
          >
            알림{unread > 0 ? ` (${unread})` : ""}
          </Link>
          <Link
            href="/settings"
            className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
          >
            설정
          </Link>
        </div>
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
            재고관리
          </h1>
          <Link
            href="/items/new"
            className="rounded-full bg-black px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            품목 등록
          </Link>
        </div>

        <form className="mb-6" method="get">
          <input
            type="text"
            name="q"
            defaultValue={q || ""}
            placeholder="품목명, 분류, 규격으로 검색"
            className="w-full max-w-sm rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </form>

        <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-100 text-left text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                <th className="px-4 py-3 font-medium">품목명</th>
                <th className="px-4 py-3 font-medium">규격</th>
                <th className="px-4 py-3 font-medium">분류</th>
                <th className="px-4 py-3 font-medium">단위</th>
                <th className="px-4 py-3 text-right font-medium">현재 재고</th>
                <th className="px-4 py-3 text-right font-medium">최소재고</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-zinc-500 dark:text-zinc-500"
                  >
                    등록된 품목이 없습니다.
                  </td>
                </tr>
              )}
              {items.map((item) => {
                const isLow = item.current_stock < item.min_stock;
                return (
                  <tr
                    key={item.id}
                    className="border-b border-zinc-100 last:border-b-0 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900/50"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/items/${item.id}`}
                        className="font-medium text-black hover:underline dark:text-zinc-50"
                      >
                        {item.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {item.spec || "-"}
                    </td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {item.category || "-"}
                    </td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {item.unit || "-"}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-medium ${
                        isLow
                          ? "text-red-600 dark:text-red-400"
                          : "text-black dark:text-zinc-50"
                      }`}
                    >
                      {item.current_stock}
                      {isLow && (
                        <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-400">
                          부족
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-600 dark:text-zinc-400">
                      {item.min_stock}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
