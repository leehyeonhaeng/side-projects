import { cookies } from "next/headers";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/auth";

export async function setSessionCookie(passwordHash) {
  const token = createSessionToken(passwordHash);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}
