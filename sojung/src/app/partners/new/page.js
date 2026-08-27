import Link from "next/link";
import PartnerForm from "@/app/partners/PartnerForm";
import { createPartnerAction } from "@/app/partners/actions";

export default async function NewPartnerPage({ searchParams }) {
  const { error } = await searchParams;

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <div className="mx-auto w-full max-w-lg px-6 py-10">
        <Link
          href="/partners"
          className="mb-4 inline-block text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        >
          ← 거래처관리
        </Link>
        <h1 className="mb-6 text-2xl font-semibold text-black dark:text-zinc-50">
          거래처 등록
        </h1>

        {error && (
          <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-400">
            {error}
          </p>
        )}

        <PartnerForm action={createPartnerAction} submitLabel="등록" />
      </div>
    </div>
  );
}
