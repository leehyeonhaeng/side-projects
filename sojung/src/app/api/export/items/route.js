import { listItemsWithStock } from "@/lib/inventory";
import { toCsv, csvResponse } from "@/lib/csv";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") || undefined;
  const items = listItemsWithStock({ query: q });

  const csv = toCsv(items, [
    { label: "품목명", value: (r) => r.name },
    { label: "규격", value: (r) => r.spec },
    { label: "분류", value: (r) => r.category },
    { label: "단위", value: (r) => r.unit },
    { label: "현재 재고", value: (r) => r.current_stock },
    { label: "최소재고", value: (r) => r.min_stock },
  ]);

  return csvResponse(csv, "items.csv");
}
