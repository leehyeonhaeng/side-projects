import { NextResponse } from "next/server";
import { getLoginPasswordHash } from "@/lib/settings";
import { isSessionTokenValid, SESSION_COOKIE } from "@/lib/auth";

export function proxy(request) {
  const passwordHash = getLoginPasswordHash();
  if (!passwordHash) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (isSessionTokenValid(token, passwordHash)) {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
