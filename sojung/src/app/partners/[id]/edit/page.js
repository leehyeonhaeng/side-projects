import Link from "next/link";
import { notFound } from "next/navigation";
import PartnerForm from "@/app/partners/PartnerForm";
import { updatePartnerAction } from "@/app/partners/actions";
import { getPartner } from "@/lib/partners";

export default async function EditPartnerPage({ params, searchParams }) {
  const { id } = await params;
  const { error } = await searchParams;
  const partner = getPartner(Number(id));

  if (!partner) {
    notFound();
  }

  const action = updatePartnerAction.bind(null, partner.id);

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <div className="mx-auto w-full max-w-lg px-6 py-10">
        <Link
          href={`/partners/${partner.id}`}
          className="mb-4 inline-block text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        >
          ← {partner.name}
        </Link>
        <h1 className="mb-6 text-2xl font-semibold text-black dark:text-zinc-50">
          거래처 수정
        </h1>

        {error && (
          <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-400">
            {error}
          </p>
        )}

        <PartnerForm action={action} partner={partner} submitLabel="저장" />
      </div>
    </div>
  );
}
