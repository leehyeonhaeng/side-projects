import Link from "next/link";
import { listPayments } from "@/lib/payments";
import { listPartners } from "@/lib/partners";
import { createPaymentAction, matchPaymentAction } from "@/app/payments/actions";

const DIRECTION_LABEL = { in: "입금", out: "출금" };

export default async function PaymentsPage({ searchParams }) {
  const { error, filter } = await searchParams;
  const matched = filter === "unmatched" ? false : filter === "matched" ? true : undefined;
  const payments = listPayments({ matched });
  const partners = listPartners();

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <div className="mx-auto w-full max-w-4xl px-6 py-10">
        <div className="mb-2 flex gap-4">
          <Link
            href="/items"
            className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
          >
            재고관리
          </Link>
          <Link
            href="/partners"
            className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
          >
            거래처관리
          </Link>
          <Link
            href="/notifications"
            className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
          >
            알림
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
            입출금관리
          </h1>
          <Link
            href="/payments/import"
            className="rounded-full bg-black px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            거래내역 파일 업로드
          </Link>
        </div>

        {error && (
          <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-400">
            {error}
          </p>
        )}

        <section className="mb-8 rounded-md border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="mb-4 text-sm font-semibold text-black dark:text-zinc-50">
            입출금 수동 등록
          </h2>
          <form
            action={createPaymentAction}
            className="grid grid-cols-2 gap-3 sm:grid-cols-5"
          >
            <select
              name="partnerId"
              defaultValue=""
              required
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            >
              <option value="" disabled>
                거래처 선택
              </option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              name="direction"
              defaultValue="in"
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            >
              <option value="in">입금</option>
              <option value="out">출금</option>
            </select>
            <input
              type="number"
              name="amount"
              placeholder="금액(원)"
              required
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
            <input
              type="date"
              name="paidAt"
              required
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
            <input
              type="text"
              name="memo"
              placeholder="메모"
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
            <button
              type="submit"
              className="col-span-2 rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 sm:col-span-5 sm:w-fit dark:bg-white dark:text-black dark:hover:bg-zinc-200"
            >
              등록
            </button>
          </form>
        </section>

        <div className="mb-4 flex gap-2 text-sm">
          <Link
            href="/payments"
            className={`rounded-full px-3 py-1 ${
              !filter
                ? "bg-black text-white dark:bg-white dark:text-black"
                : "border border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
            }`}
          >
            전체
          </Link>
          <Link
            href="/payments?filter=unmatched"
            className={`rounded-full px-3 py-1 ${
              filter === "unmatched"
                ? "bg-black text-white dark:bg-white dark:text-black"
                : "border border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
            }`}
          >
            매칭 대기
          </Link>
        </div>

        <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[680px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-100 text-left text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                <th className="px-4 py-3 font-medium">날짜</th>
                <th className="px-4 py-3 font-medium">구분</th>
                <th className="px-4 py-3 font-medium">거래처</th>
                <th className="px-4 py-3 text-right font-medium">금액</th>
                <th className="px-4 py-3 font-medium">출처</th>
                <th className="px-4 py-3 font-medium">영수증</th>
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-zinc-500 dark:text-zinc-500"
                  >
                    입출금 내역이 없습니다.
                  </td>
                </tr>
              )}
              {payments.map((p) => {
                const matchAction = matchPaymentAction.bind(null, p.id);
                return (
                  <tr
                    key={p.id}
                    className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-900"
                  >
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {p.paid_at}
                    </td>
                    <td className="px-4 py-3">{DIRECTION_LABEL[p.direction]}</td>
                    <td className="px-4 py-3">
                      {p.partner_id ? (
                        <Link
                          href={`/partners/${p.partner_id}`}
                          className="text-black hover:underline dark:text-zinc-50"
                        >
                          {p.partner_name}
                        </Link>
                      ) : (
                        <form action={matchAction} className="flex items-center gap-2">
                          <span className="text-xs text-red-600 dark:text-red-400">
                            {p.depositor_name || "미확인"} 매칭 대기
                          </span>
                          <select
                            name="partnerId"
                            defaultValue=""
                            required
                            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                          >
                            <option value="" disabled>
                              거래처 지정
                            </option>
                            {partners.map((pt) => (
                              <option key={pt.id} value={pt.id}>
                                {pt.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="submit"
                            className="rounded-md bg-black px-2 py-1 text-xs font-medium text-white dark:bg-white dark:text-black"
                          >
                            매칭
                          </button>
                        </form>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">{p.amount.toLocaleString()}</td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      {p.source === "bank_import" ? "파일 업로드" : "수동"}
                    </td>
                    <td className="px-4 py-3">
                      {p.partner_id && p.direction === "in" ? (
                        <Link
                          href={`/payments/${p.id}/receipt`}
                          className="text-black hover:underline dark:text-zinc-50"
                        >
                          발급
                        </Link>
                      ) : (
                        "-"
                      )}
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
