import { listPartnersWithStatus, BALANCE_CATEGORY_LABEL } from "@/lib/partners";
import { toCsv, csvResponse } from "@/lib/csv";

const TYPE_LABEL = { supplier: "매입처", customer: "매출처", both: "매입처·매출처" };

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category") || undefined;
  const partners = listPartnersWithStatus({ onlyOutstanding: true }).filter(
    (p) => !category || p.category === category
  );

  const csv = toCsv(partners, [
    { label: "상호", value: (r) => r.name },
    { label: "구분", value: (r) => TYPE_LABEL[r.type] || r.type },
    { label: "분류", value: (r) => BALANCE_CATEGORY_LABEL[r.category] },
    { label: "금액", value: (r) => Math.abs(r.balance) },
    { label: "결제기한", value: (r) => r.dueStatus?.dueDate || "" },
  ]);

  return csvResponse(csv, "receivables.csv");
}
