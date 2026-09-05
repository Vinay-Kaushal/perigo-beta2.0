import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/register"];

export function middleware(req: NextRequest) {
  const token = req.cookies.get("perigo_token")?.value;
  const isPublic = PUBLIC_PATHS.includes(req.nextUrl.pathname);

  if (!token && !isPublic) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (token && isPublic) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
}

export const config = {
  // Skip static assets and Next internals; everything else goes through
  // the auth check above.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
