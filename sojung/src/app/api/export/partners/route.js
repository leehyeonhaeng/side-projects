import { listPartnersWithStatus } from "@/lib/partners";
import { toCsv, csvResponse } from "@/lib/csv";

const TYPE_LABEL = { supplier: "매입처", customer: "매출처", both: "매입처·매출처" };

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") || undefined;
  const partners = listPartnersWithStatus({ query: q });

  const csv = toCsv(partners, [
    { label: "상호", value: (r) => r.name },
    { label: "구분", value: (r) => TYPE_LABEL[r.type] || r.type },
    { label: "담당자", value: (r) => r.contact_name },
    { label: "연락처", value: (r) => r.phone },
    { label: "사업자번호", value: (r) => r.business_no },
    { label: "미수금(+)/미지급금(-)", value: (r) => r.balance },
    { label: "결제기한", value: (r) => r.dueStatus?.dueDate || "" },
  ]);

  return csvResponse(csv, "partners.csv");
}
