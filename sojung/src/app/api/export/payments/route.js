import { listPayments } from "@/lib/payments";
import { toCsv, csvResponse } from "@/lib/csv";

const DIRECTION_LABEL = { in: "입금", out: "출금" };
const SOURCE_LABEL = { manual: "수동", bank_import: "파일 업로드" };

export async function GET() {
  const payments = listPayments();

  const csv = toCsv(payments, [
    { label: "날짜", value: (r) => r.paid_at },
    { label: "구분", value: (r) => DIRECTION_LABEL[r.direction] || r.direction },
    { label: "거래처", value: (r) => r.partner_name },
    { label: "금액", value: (r) => r.amount },
    { label: "입금자명", value: (r) => r.depositor_name },
    { label: "출처", value: (r) => SOURCE_LABEL[r.source] || r.source },
    { label: "메모", value: (r) => r.memo },
  ]);

  return csvResponse(csv, "payments.csv");
}
