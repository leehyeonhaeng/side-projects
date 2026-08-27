import Link from "next/link";
import { notFound } from "next/navigation";
import { getPartner, listMovementsByPartner } from "@/lib/partners";
import { deletePartnerAction } from "@/app/partners/actions";
import { TYPE_OPTIONS } from "@/app/partners/PartnerForm";

const TYPE_LABEL = Object.fromEntries(TYPE_OPTIONS.map((o) => [o.value, o.label]));
const MOVEMENT_TYPE_LABEL = { in: "입고", out: "출고", adjust: "조정" };

export default async function PartnerDetailPage({ params, searchParams }) {
  const { id } = await params;
  const { error } = await searchParams;
  const partner = getPartner(Number(id));

  if (!partner) {
    notFound();
  }

  const movements = listMovementsByPartner(partner.id);
  const deletePartner = deletePartnerAction.bind(null, partner.id);

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <Link
          href="/partners"
          className="mb-4 inline-block text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        >
          ← 거래처관리
        </Link>

        {error && (
          <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
              {partner.name}
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {TYPE_LABEL[partner.type]}
              {partner.contact_name ? ` · ${partner.contact_name}` : ""}
              {partner.phone ? ` · ${partner.phone}` : ""}
            </p>
            {partner.business_no && (
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                사업자번호 {partner.business_no}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Link
              href={`/partners/${partner.id}/edit`}
              className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              수정
            </Link>
            <form action={deletePartner}>
              <button
                type="submit"
                className="rounded-full border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
              >
                삭제
              </button>
            </form>
          </div>
        </div>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-black dark:text-zinc-50">
            거래 내역
          </h2>
          <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-100 text-left text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                  <th className="px-4 py-3 font-medium">날짜</th>
                  <th className="px-4 py-3 font-medium">품목</th>
                  <th className="px-4 py-3 font-medium">구분</th>
                  <th className="px-4 py-3 text-right font-medium">수량</th>
                  <th className="px-4 py-3 text-right font-medium">단가</th>
                </tr>
              </thead>
              <tbody>
                {movements.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-8 text-center text-zinc-500 dark:text-zinc-500"
                    >
                      연결된 거래 내역이 없습니다.
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
                    <td className="px-4 py-3">
                      <Link
                        href={`/items/${m.item_id}`}
                        className="text-black hover:underline dark:text-zinc-50"
                      >
                        {m.item_name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{MOVEMENT_TYPE_LABEL[m.type]}</td>
                    <td className="px-4 py-3 text-right">
                      {m.quantity}
                      {m.item_unit ? ` ${m.item_unit}` : ""}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-600 dark:text-zinc-400">
                      {m.unit_price != null ? m.unit_price.toLocaleString() : "-"}
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
