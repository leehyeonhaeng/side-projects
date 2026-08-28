import Link from "next/link";
import { notFound } from "next/navigation";
import { getItemWithStock, listMovements } from "@/lib/inventory";
import { listPartners } from "@/lib/partners";
import { addMovementAction, deleteItemAction } from "@/app/items/actions";

const TYPE_LABEL = {
  in: "입고",
  out: "출고",
  adjust: "조정",
};

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

export default async function ItemDetailPage({ params, searchParams }) {
  const { id } = await params;
  const { error } = await searchParams;
  const item = getItemWithStock(Number(id));

  if (!item) {
    notFound();
  }

  const movements = listMovements(item.id);
  const partners = listPartners();
  const addMovement = addMovementAction.bind(null, item.id);
  const deleteItem = deleteItemAction.bind(null, item.id);
  const isLow = item.current_stock < item.min_stock;

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <Link
          href="/items"
          className="mb-4 inline-block text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        >
          ← 재고관리
        </Link>

        {error && (
          <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
              {item.name}
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {[item.spec, item.category, item.unit].filter(Boolean).join(" · ") ||
                "-"}
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href={`/items/${item.id}/edit`}
              className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              수정
            </Link>
            <form action={deleteItem}>
              <button
                type="submit"
                className="rounded-full border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
              >
                삭제
              </button>
            </form>
          </div>
        </div>

        <div className="mb-8 grid grid-cols-2 gap-4">
          <div className="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">현재 재고</p>
            <p
              className={`mt-1 text-xl font-semibold ${
                isLow
                  ? "text-red-600 dark:text-red-400"
                  : "text-black dark:text-zinc-50"
              }`}
            >
              {item.current_stock}
              {item.unit ? ` ${item.unit}` : ""}
              {isLow && (
                <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-400">
                  최소재고 미달
                </span>
              )}
            </p>
          </div>
          <div className="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">최소재고 기준</p>
            <p className="mt-1 text-xl font-semibold text-black dark:text-zinc-50">
              {item.min_stock}
              {item.unit ? ` ${item.unit}` : ""}
            </p>
          </div>
        </div>

        <section className="mb-8 rounded-md border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="mb-4 text-sm font-semibold text-black dark:text-zinc-50">
            입출고 등록
          </h2>
          <form
            action={addMovement}
            className="grid grid-cols-2 gap-3 sm:grid-cols-7"
          >
            <select
              name="type"
              defaultValue="in"
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            >
              <option value="in">입고</option>
              <option value="out">출고</option>
              <option value="adjust">조정</option>
            </select>
            <select
              name="partnerId"
              defaultValue=""
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            >
              <option value="">거래처 없음</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              name="quantity"
              step="any"
              placeholder="수량"
              required
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
            <input
              type="number"
              name="unitPrice"
              step="any"
              placeholder="단가(원)"
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
            <input
              type="date"
              name="movedAt"
              defaultValue={todayString()}
              required
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
            <input
              type="text"
              name="memo"
              placeholder="메모"
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
            <input
              type="date"
              name="dueDate"
              title="결제기한 (출고 시)"
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
            <button
              type="submit"
              className="col-span-2 rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 sm:col-span-7 sm:w-fit dark:bg-white dark:text-black dark:hover:bg-zinc-200"
            >
              등록
            </button>
          </form>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            조정은 실사 보정용으로, 수량에 증가는 양수, 감소는 음수를 입력하세요. 결제기한은
            출고(매출) 건에서만 사용합니다.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-black dark:text-zinc-50">
            입출고 이력
          </h2>
          <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-100 text-left text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                  <th className="px-4 py-3 font-medium">날짜</th>
                  <th className="px-4 py-3 font-medium">구분</th>
                  <th className="px-4 py-3 text-right font-medium">수량</th>
                  <th className="px-4 py-3 text-right font-medium">단가</th>
                  <th className="px-4 py-3 font-medium">거래처</th>
                  <th className="px-4 py-3 font-medium">메모</th>
                </tr>
              </thead>
              <tbody>
                {movements.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-zinc-500 dark:text-zinc-500"
                    >
                      입출고 이력이 없습니다.
                    </td>
                  </tr>
                )}
                {movements.map((m) => (
                  <tr
                    key={m.id}
                    className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-900"
                  >
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {m.moved_at}
                    </td>
                    <td className="px-4 py-3">{TYPE_LABEL[m.type]}</td>
                    <td className="px-4 py-3 text-right">{m.quantity}</td>
                    <td className="px-4 py-3 text-right text-zinc-600 dark:text-zinc-400">
                      {m.unit_price != null ? m.unit_price.toLocaleString() : "-"}
                    </td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {m.partner_id ? (
                        <Link
                          href={`/partners/${m.partner_id}`}
                          className="hover:underline"
                        >
                          {m.partner_name}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {m.memo || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
