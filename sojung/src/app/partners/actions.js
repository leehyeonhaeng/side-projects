"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createPartner,
  updatePartner,
  deletePartner,
} from "@/lib/partners";

function parsePartnerForm(formData) {
  const name = String(formData.get("name") || "").trim();
  const type = String(formData.get("type") || "");
  return {
    name,
    type,
    contactName: String(formData.get("contactName") || "").trim(),
    phone: String(formData.get("phone") || "").trim(),
    businessNo: String(formData.get("businessNo") || "").trim(),
    memo: String(formData.get("memo") || "").trim(),
  };
}

export async function createPartnerAction(formData) {
  const data = parsePartnerForm(formData);
  if (!data.name) {
    redirect(`/partners/new?error=${encodeURIComponent("거래처명을 입력해주세요.")}`);
  }
  if (!["supplier", "customer", "both"].includes(data.type)) {
    redirect(`/partners/new?error=${encodeURIComponent("구분을 선택해주세요.")}`);
  }

  const id = createPartner(data);
  revalidatePath("/partners");
  redirect(`/partners/${id}`);
}

export async function updatePartnerAction(id, formData) {
  const data = parsePartnerForm(formData);
  if (!data.name) {
    redirect(`/partners/${id}/edit?error=${encodeURIComponent("거래처명을 입력해주세요.")}`);
  }
  if (!["supplier", "customer", "both"].includes(data.type)) {
    redirect(`/partners/${id}/edit?error=${encodeURIComponent("구분을 선택해주세요.")}`);
  }

  updatePartner(id, data);
  revalidatePath("/partners");
  revalidatePath(`/partners/${id}`);
  redirect(`/partners/${id}`);
}

export async function deletePartnerAction(id) {
  try {
    deletePartner(id);
  } catch (error) {
    redirect(`/partners/${id}?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath("/partners");
  redirect("/partners");
}
