"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createPayment, matchPayment, importBankStatement } from "@/lib/payments";

export async function createPaymentAction(formData) {
  const partnerIdRaw = formData.get("partnerId");
  const partnerId = partnerIdRaw ? Number(partnerIdRaw) : null;
  const direction = String(formData.get("direction") || "");
  const amount = Number(formData.get("amount"));
  const paidAt = String(formData.get("paidAt") || "");
  const memo = String(formData.get("memo") || "").trim();

  if (!partnerId) {
    redirect(`/payments?error=${encodeURIComponent("거래처를 선택해주세요.")}`);
  }
  if (!["in", "out"].includes(direction)) {
    redirect(`/payments?error=${encodeURIComponent("입금/출금 구분을 선택해주세요.")}`);
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    redirect(`/payments?error=${encodeURIComponent("금액을 올바르게 입력해주세요.")}`);
  }
  if (!paidAt) {
    redirect(`/payments?error=${encodeURIComponent("날짜를 입력해주세요.")}`);
  }

  createPayment({ partnerId, direction, amount, paidAt, memo });
  revalidatePath("/payments");
  revalidatePath(`/partners/${partnerId}`);
  redirect("/payments");
}

export async function matchPaymentAction(paymentId, formData) {
  const partnerIdRaw = formData.get("partnerId");
  const partnerId = partnerIdRaw ? Number(partnerIdRaw) : null;

  if (!partnerId) {
    redirect(`/payments?error=${encodeURIComponent("거래처를 선택해주세요.")}`);
  }

  matchPayment(paymentId, partnerId);
  revalidatePath("/payments");
  revalidatePath(`/partners/${partnerId}`);
  redirect("/payments");
}

export async function importBankStatementAction(formData) {
  const file = formData.get("file");

  if (!file || typeof file === "string" || file.size === 0) {
    redirect(`/payments/import?error=${encodeURIComponent("파일을 선택해주세요.")}`);
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let result;
  try {
    result = importBankStatement(buffer);
  } catch (error) {
    redirect(`/payments/import?error=${encodeURIComponent("파일을 읽는 중 오류가 발생했습니다: " + error.message)}`);
  }

  revalidatePath("/payments");
  revalidatePath("/notifications");
  redirect(
    `/payments/import?result=${encodeURIComponent(
      `매칭 ${result.matchedCount}건, 매칭 대기 ${result.unmatchedCount}건`
    )}`
  );
}
