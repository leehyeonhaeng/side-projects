import Link from "next/link";
import { importBankStatementAction } from "@/app/payments/actions";

export default async function ImportPaymentsPage({ searchParams }) {
  const { error, result } = await searchParams;

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <div className="mx-auto w-full max-w-lg px-6 py-10">
        <Link
          href="/payments"
          className="mb-4 inline-block text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        >
          ← 입출금관리
        </Link>
        <h1 className="mb-2 text-2xl font-semibold text-black dark:text-zinc-50">
          거래내역 파일 업로드
        </h1>
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          은행 앱/웹에서 내려받은 거래내역 CSV 파일을 업로드하면, 입금자명을 거래처와
          자동으로 대조해서 등록합니다. 일치하는 거래처를 찾지 못한 건은 입출금관리
          목록의 &quot;매칭 대기&quot;에서 수동으로 지정할 수 있습니다.
        </p>

        {error && (
          <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-400">
            {error}
          </p>
        )}
        {result && (
          <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
            업로드 완료: {result}
          </p>
        )}

        <form action={importBankStatementAction} className="flex flex-col gap-4">
          <input
            type="file"
            name="file"
            accept=".csv,text/csv"
            required
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          <button
            type="submit"
            className="mt-2 w-fit rounded-full bg-black px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            업로드
          </button>
        </form>
      </div>
    </div>
  );
}
