import { NextResponse, type NextRequest } from "next/server";

// UX-level routing only — the API enforces authentication on every request.
const AUTH_PAGES = ["/login", "/register", "/forgot-password"];
const PUBLIC_PREFIXES = ["/invitations/", "/verify-email", "/reset-password"];

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const token = req.cookies.get("perigo_session")?.value;
  const isAuthPage = AUTH_PAGES.includes(pathname);
  const isPublic = isAuthPage || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));

  if (!token && !isPublic) {
    const url = new URL("/login", req.url);
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  if (token && isAuthPage) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|jpg)$).*)"],
};
