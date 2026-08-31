import Link from "next/link";
import { listPartnersWithStatus, getBalanceBreakdown, BALANCE_CATEGORY_LABEL } from "@/lib/partners";
import { TYPE_OPTIONS } from "@/app/(app)/partners/PartnerForm";

const TYPE_LABEL = Object.fromEntries(TYPE_OPTIONS.map((o) => [o.value, o.label]));
const DUE_STATUS_LABEL = { due_soon: "결제기한 임박", overdue: "결제기한 초과" };

const CATEGORY_FILTERS = [
  { value: "", label: "전체" },
  { value: "receivable", label: "미수금" },
  { value: "advance_received", label: "선수금" },
  { value: "payable", label: "미지급금" },
  { value: "advance_paid", label: "선급금" },
];

// 잔액이 바뀔 때마다 다시 계산되므로 정적 생성되지 않도록 강제로 동적 렌더링한다.
export const dynamic = "force-dynamic";

function SummaryCard({ label, value }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <span className="text-xs text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="text-xl font-semibold text-black dark:text-zinc-50">
        {value.toLocaleString()}원
      </span>
    </div>
  );
}

export default async function ReceivablesPage({ searchParams }) {
  const { category } = await searchParams;
  const breakdown = getBalanceBreakdown();
  const partners = listPartnersWithStatus({ onlyOutstanding: true }).filter(
    (p) => !category || p.category === category
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pb-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          미수금·선납금 관리
        </h1>
        <a
          href={`/api/export/receivables${category ? `?category=${category}` : ""}`}
          className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          CSV 내보내기
        </a>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="미수금 합계" value={breakdown.receivable.total} />
        <SummaryCard label="선수금 합계" value={breakdown.advance_received.total} />
        <SummaryCard label="미지급금 합계" value={breakdown.payable.total} />
        <SummaryCard label="선급금 합계" value={breakdown.advance_paid.total} />
      </div>

      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {CATEGORY_FILTERS.map((f) => (
          <Link
            key={f.value}
            href={f.value ? `/receivables?category=${f.value}` : "/receivables"}
            className={`rounded-full px-3 py-1 ${
              (category || "") === f.value
                ? "bg-black text-white dark:bg-white dark:text-black"
                : "border border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-100 text-left text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
              <th className="px-4 py-3 font-medium">상호</th>
              <th className="px-4 py-3 font-medium">구분</th>
              <th className="px-4 py-3 font-medium">분류</th>
              <th className="px-4 py-3 text-right font-medium">금액</th>
              <th className="px-4 py-3 font-medium">결제기한</th>
            </tr>
          </thead>
          <tbody>
            {partners.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-zinc-500 dark:text-zinc-500"
                >
                  해당하는 미수금·선납금 내역이 없습니다.
                </td>
              </tr>
            )}
            {partners.map((partner) => (
              <tr
                key={partner.id}
                className="border-b border-zinc-100 last:border-b-0 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900/50"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/partners/${partner.id}`}
                    className="font-medium text-black hover:underline dark:text-zinc-50"
                  >
                    {partner.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                  {TYPE_LABEL[partner.type]}
                </td>
                <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                  {BALANCE_CATEGORY_LABEL[partner.category]}
                </td>
                <td className="px-4 py-3 text-right font-medium text-black dark:text-zinc-50">
                  {Math.abs(partner.balance).toLocaleString()}원
                </td>
                <td className="px-4 py-3">
                  {partner.dueStatus &&
                  (partner.dueStatus.status === "due_soon" ||
                    partner.dueStatus.status === "overdue") ? (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        partner.dueStatus.status === "overdue"
                          ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
                      }`}
                    >
                      {DUE_STATUS_LABEL[partner.dueStatus.status]} (
                      {partner.dueStatus.dueDate})
                    </span>
                  ) : (
                    "-"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
