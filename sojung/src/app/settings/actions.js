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
import { setSessionCookie } from "@/lib/session";

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

  const newHash = hashPassword(newPassword);
  setLoginPasswordHash(newHash);

  // 방금 저장한 해시로 세션을 다시 발급하지 않으면 기존 쿠키의 서명이
  // 새 해시와 맞지 않아 저장 직후 바로 로그인 화면으로 튕겨나간다.
  await setSessionCookie(newHash);

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
