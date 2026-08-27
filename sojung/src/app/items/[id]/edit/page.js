import Link from "next/link";
import { notFound } from "next/navigation";
import ItemForm from "@/app/items/ItemForm";
import { updateItemAction } from "@/app/items/actions";
import { getItemWithStock } from "@/lib/inventory";

export default async function EditItemPage({ params, searchParams }) {
  const { id } = await params;
  const { error } = await searchParams;
  const item = getItemWithStock(Number(id));

  if (!item) {
    notFound();
  }

  const action = updateItemAction.bind(null, item.id);

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <div className="mx-auto w-full max-w-lg px-6 py-10">
        <Link
          href={`/items/${item.id}`}
          className="mb-4 inline-block text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        >
          ← {item.name}
        </Link>
        <h1 className="mb-6 text-2xl font-semibold text-black dark:text-zinc-50">
          품목 수정
        </h1>

        {error && (
          <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-400">
            {error}
          </p>
        )}

        <ItemForm action={action} item={item} submitLabel="저장" />
      </div>
    </div>
  );
}
