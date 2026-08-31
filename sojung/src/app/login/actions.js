"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getLoginPasswordHash } from "@/lib/settings";
import { verifyPassword, SESSION_COOKIE } from "@/lib/auth";
import { setSessionCookie } from "@/lib/session";

export async function loginAction(formData) {
  const password = formData.get("password") || "";
  const hash = getLoginPasswordHash();

  if (!hash || !verifyPassword(password, hash)) {
    redirect("/login?error=1");
  }

  await setSessionCookie(hash);
  redirect("/");
}

export async function logoutAction() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  redirect("/login");
}
