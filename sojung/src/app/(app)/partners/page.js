import Link from "next/link";
import { listPartnersWithStatus, BALANCE_CATEGORY_LABEL } from "@/lib/partners";
import { TYPE_OPTIONS } from "@/app/(app)/partners/PartnerForm";

const TYPE_LABEL = Object.fromEntries(TYPE_OPTIONS.map((o) => [o.value, o.label]));
const DUE_STATUS_LABEL = { due_soon: "결제기한 임박", overdue: "결제기한 초과" };

export default async function PartnersPage({ searchParams }) {
  const { q, filter } = await searchParams;
  const onlyOutstanding = filter === "outstanding";
  const partners = listPartnersWithStatus({ query: q, onlyOutstanding });

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pb-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          거래처관리
        </h1>
        <div className="flex items-center gap-2">
          <a
            href={`/api/export/partners${q ? `?q=${encodeURIComponent(q)}` : ""}`}
            className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            CSV 내보내기
          </a>
          <Link
            href="/partners/new"
            className="rounded-full bg-black px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            거래처 등록
          </Link>
        </div>
      </div>

      <form className="mb-6" method="get">
        <input
          type="text"
          name="q"
          defaultValue={q || ""}
          placeholder="상호, 담당자, 사업자번호로 검색"
          className="w-full max-w-sm rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </form>

      <div className="mb-4 flex gap-2 text-sm">
        <Link
          href={q ? `/partners?q=${encodeURIComponent(q)}` : "/partners"}
          className={`rounded-full px-3 py-1 ${
            !onlyOutstanding
              ? "bg-black text-white dark:bg-white dark:text-black"
              : "border border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
          }`}
        >
          전체
        </Link>
        <Link
          href={`/partners?filter=outstanding${q ? `&q=${encodeURIComponent(q)}` : ""}`}
          className={`rounded-full px-3 py-1 ${
            onlyOutstanding
              ? "bg-black text-white dark:bg-white dark:text-black"
              : "border border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
          }`}
        >
          미수금·미지급금 있음
        </Link>
      </div>

      <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-100 text-left text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
              <th className="px-4 py-3 font-medium">상호</th>
              <th className="px-4 py-3 font-medium">구분</th>
              <th className="px-4 py-3 font-medium">담당자</th>
              <th className="px-4 py-3 font-medium">연락처</th>
              <th className="px-4 py-3 text-right font-medium">미수금/미지급금</th>
              <th className="px-4 py-3 font-medium">결제기한</th>
            </tr>
          </thead>
          <tbody>
            {partners.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-zinc-500 dark:text-zinc-500"
                >
                  {onlyOutstanding
                    ? "미수금·미지급금이 있는 거래처가 없습니다."
                    : "등록된 거래처가 없습니다."}
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
                  {partner.contact_name || "-"}
                </td>
                <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                  {partner.phone || "-"}
                </td>
                <td className="px-4 py-3 text-right font-medium text-black dark:text-zinc-50">
                  {partner.balance !== 0 ? Math.abs(partner.balance).toLocaleString() : "-"}
                  {partner.balance !== 0 && (
                    <span className="ml-1 text-xs font-normal text-zinc-500 dark:text-zinc-400">
                      ({BALANCE_CATEGORY_LABEL[partner.category]})
                    </span>
                  )}
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
