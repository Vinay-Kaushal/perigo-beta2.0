import type { CookieOptions, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "./env";

export const SESSION_COOKIE = "perigo_session";
/** Browsers must send this header on cookie-authenticated writes (see requireAuth). */
export const CSRF_HEADER = "x-csrf-protection";

function cookieOptions(): CookieOptions {
  const { COOKIE_DOMAIN, COOKIE_SECURE, NODE_ENV } = env();
  return {
    httpOnly: true, // never readable from JavaScript — an XSS can't exfiltrate the session
    secure: COOKIE_SECURE ? COOKIE_SECURE === "true" : NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}),
  };
}

export function setSessionCookie(res: Response, token: string) {
  const exp = (jwt.decode(token) as { exp?: number } | null)?.exp;
  const maxAge = exp ? Math.max(0, exp * 1000 - Date.now()) : undefined;
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

/** Minimal cookie-header parser — avoids a dependency for one cookie. */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
