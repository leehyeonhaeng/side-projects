import Link from "next/link";
import { notFound } from "next/navigation";
import { getPayment } from "@/lib/payments";
import { getCompanySettings } from "@/lib/settings";
import PrintButton from "@/app/payments/PrintButton";

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

export default async function PaymentReceiptPage({ params }) {
  const { id } = await params;
  const payment = getPayment(Number(id));

  if (!payment) {
    notFound();
  }

  const company = getCompanySettings();

  if (!payment.partner_id) {
    return (
      <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
        <div className="mx-auto w-full max-w-lg px-6 py-10">
          <Link
            href="/payments"
            className="mb-4 inline-block text-sm text-zinc-500 hover:underline dark:text-zinc-400"
          >
            ← 입출금관리
          </Link>
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-400">
            거래처가 매칭되지 않은 입출금 건은 영수증을 발급할 수 없습니다.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black print:bg-white">
      <div className="mx-auto w-full max-w-lg px-6 py-10 print:max-w-none print:px-0 print:py-0">
        <div className="mb-6 flex items-center justify-between print:hidden">
          <Link
            href="/payments"
            className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
          >
            ← 입출금관리
          </Link>
          <PrintButton />
        </div>

        <div className="rounded-md border border-zinc-300 bg-white p-8 print:border-none print:p-0">
          <h1 className="mb-8 text-center text-2xl font-semibold text-black">영수증</h1>

          <table className="mb-8 w-full text-sm">
            <tbody>
              <tr className="border-b border-zinc-200">
                <td className="py-2 font-medium text-zinc-500">받는 곳</td>
                <td className="py-2 text-black">{payment.partner_name}</td>
              </tr>
              <tr className="border-b border-zinc-200">
                <td className="py-2 font-medium text-zinc-500">입금일</td>
                <td className="py-2 text-black">{payment.paid_at}</td>
              </tr>
              <tr className="border-b border-zinc-200">
                <td className="py-2 font-medium text-zinc-500">금액</td>
                <td className="py-2 text-xl font-semibold text-black">
                  {payment.amount.toLocaleString()}원
                </td>
              </tr>
              {payment.memo && (
                <tr className="border-b border-zinc-200">
                  <td className="py-2 font-medium text-zinc-500">메모</td>
                  <td className="py-2 text-black">{payment.memo}</td>
                </tr>
              )}
              <tr>
                <td className="py-2 font-medium text-zinc-500">발급일</td>
                <td className="py-2 text-black">{todayString()}</td>
              </tr>
            </tbody>
          </table>

          <div className="border-t border-zinc-300 pt-6 text-right text-sm text-black">
            <p className="font-semibold">{company?.name || "(회사명 미설정)"}</p>
            {company?.business_no && <p>사업자번호 {company.business_no}</p>}
            {company?.address && <p>{company.address}</p>}
            {company?.phone && <p>{company.phone}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
