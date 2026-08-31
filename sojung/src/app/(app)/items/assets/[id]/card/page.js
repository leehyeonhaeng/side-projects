import Link from "next/link";
import { notFound } from "next/navigation";
import { getAsset } from "@/lib/assets";
import { getCompanySettings } from "@/lib/settings";
import PrintButton from "@/app/PrintButton";

export default async function AssetCardPage({ params }) {
  const { id } = await params;
  const asset = getAsset(Number(id));

  if (!asset) {
    notFound();
  }

  const company = getCompanySettings();

  return (
    <div className="mx-auto w-full max-w-lg px-6 pb-10 print:max-w-none print:px-0 print:py-0">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link
          href={`/items/${asset.item_id}`}
          className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        >
          ← {asset.item_name}
        </Link>
        <PrintButton />
      </div>

      <div className="rounded-md border border-zinc-300 bg-white p-8 text-center print:border-none print:p-0">
        <p className="text-xs font-medium tracking-wide text-zinc-500">자산 등록카드</p>
        <p className="mt-4 font-mono text-3xl font-bold tracking-widest text-black">
          {asset.asset_code}
        </p>

        <div className="mx-auto mt-6 max-w-xs border-t border-zinc-300 pt-6 text-left text-sm text-black">
          <div className="mb-2 flex justify-between">
            <span className="text-zinc-500">품목</span>
            <span className="font-medium">{asset.item_name}</span>
          </div>
          {asset.item_spec && (
            <div className="mb-2 flex justify-between">
              <span className="text-zinc-500">규격</span>
              <span className="font-medium">{asset.item_spec}</span>
            </div>
          )}
          <div className="mb-2 flex justify-between">
            <span className="text-zinc-500">등록일</span>
            <span className="font-medium">{asset.created_at?.slice(0, 10)}</span>
          </div>
        </div>

        <div className="mt-6 border-t border-zinc-300 pt-4 text-xs text-zinc-500">
          {company?.name || "(회사명 미설정)"}
          {company?.phone ? ` · ${company.phone}` : ""}
        </div>
      </div>
    </div>
  );
}
