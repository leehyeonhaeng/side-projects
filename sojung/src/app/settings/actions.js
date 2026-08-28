"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { updateCompanySettings } from "@/lib/settings";

export async function updateSettingsAction(formData) {
  updateCompanySettings({
    name: String(formData.get("name") || "").trim(),
    businessNo: String(formData.get("businessNo") || "").trim(),
    address: String(formData.get("address") || "").trim(),
    phone: String(formData.get("phone") || "").trim(),
  });
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}
