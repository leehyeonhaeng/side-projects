import Link from "next/link";
import { listPartners } from "@/lib/partners";
import { TYPE_OPTIONS } from "@/app/partners/PartnerForm";
import { countUnread } from "@/lib/notifications";

const TYPE_LABEL = Object.fromEntries(TYPE_OPTIONS.map((o) => [o.value, o.label]));

export default async function PartnersPage({ searchParams }) {
  const { q } = await searchParams;
  const partners = listPartners({ query: q });
  const unread = countUnread();

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <div className="mb-2 flex gap-4">
          <Link
            href="/items"
            className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
          >
            재고관리
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
            거래처관리
          </h1>
          <Link
            href="/partners/new"
            className="rounded-full bg-black px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            거래처 등록
          </Link>
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

        <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-100 text-left text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                <th className="px-4 py-3 font-medium">상호</th>
                <th className="px-4 py-3 font-medium">구분</th>
                <th className="px-4 py-3 font-medium">담당자</th>
                <th className="px-4 py-3 font-medium">연락처</th>
                <th className="px-4 py-3 font-medium">사업자번호</th>
              </tr>
            </thead>
            <tbody>
              {partners.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-zinc-500 dark:text-zinc-500"
                  >
                    등록된 거래처가 없습니다.
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
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                    {partner.business_no || "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
