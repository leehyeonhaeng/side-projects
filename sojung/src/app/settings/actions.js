"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  updateCompanySettings,
  getLoginPasswordHash,
  setLoginPasswordHash,
  clearLoginPassword,
} from "@/lib/settings";
import { verifyPassword, hashPassword } from "@/lib/auth";

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

export async function setPasswordAction(formData) {
  const currentPassword = String(formData.get("currentPassword") || "");
  const newPassword = String(formData.get("newPassword") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");
  const existingHash = getLoginPasswordHash();

  if (existingHash && !verifyPassword(currentPassword, existingHash)) {
    redirect("/settings?pwError=current");
  }
  if (newPassword.length < 4) {
    redirect("/settings?pwError=short");
  }
  if (newPassword !== confirmPassword) {
    redirect("/settings?pwError=mismatch");
  }

  setLoginPasswordHash(hashPassword(newPassword));
  revalidatePath("/settings");
  redirect("/settings?pwSaved=1");
}

export async function removePasswordAction(formData) {
  const currentPassword = String(formData.get("currentPassword") || "");
  const existingHash = getLoginPasswordHash();

  if (existingHash && !verifyPassword(currentPassword, existingHash)) {
    redirect("/settings?pwError=current");
  }

  clearLoginPassword();
  revalidatePath("/settings");
  redirect("/settings?pwSaved=removed");
}
