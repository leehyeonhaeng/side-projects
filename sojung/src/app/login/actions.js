"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getLoginPasswordHash } from "@/lib/settings";
import { verifyPassword, createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/auth";

export async function loginAction(formData) {
  const password = formData.get("password") || "";
  const hash = getLoginPasswordHash();

  if (!hash || !verifyPassword(password, hash)) {
    redirect("/login?error=1");
  }

  const token = createSessionToken(hash);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  redirect("/");
}

export async function logoutAction() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  redirect("/login");
}
