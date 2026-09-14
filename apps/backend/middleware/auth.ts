import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { verifyAccessToken } from "../lib/tokens";
import { HttpError } from "../lib/http";
import { CSRF_HEADER, SESSION_COOKIE, readCookie } from "../lib/session";
import { env } from "../lib/env";
import { hitLimit } from "./rateLimit";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Credentialed requests skip the anonymous per-IP limit, so bad or revoked
 * credentials are counted per IP here — garbage tokens can't be used to flood.
 */
async function rejectCredentials(req: Request, res: Response, message: string) {
  if (await hitLimit("bad-auth", req.ip ?? "unknown", 60, env().RATE_LIMIT_BAD_AUTH_MAX)) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ error: "Too many requests, please try again later", code: "RATE_LIMITED" });
  }
  return res.status(401).json({ error: message, code: "UNAUTHENTICATED" });
}

/**
 * Accepts either a bearer token (API clients) or the httpOnly session cookie
 * (browsers). Cookie-authenticated writes must carry the X-CSRF-Protection
 * header: a cross-site form can't set custom headers, and a cross-origin
 * fetch that tries is stopped by the CORS preflight allowlist.
 *
 * The token's version must match the user's current tokenVersion, so a
 * password change or "sign out everywhere" revokes every session at once.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const bearer = header?.startsWith("Bearer ") ? header.slice(7).trim() : undefined;
  const cookie = bearer ? undefined : readCookie(req, SESSION_COOKIE);
  const token = bearer ?? cookie;
  if (!token) return res.status(401).json({ error: "Not signed in", code: "UNAUTHENTICATED" });

  if (cookie && !SAFE_METHODS.has(req.method) && req.headers[CSRF_HEADER] !== "1") {
    return res.status(403).json({ error: "Missing CSRF protection header", code: "CSRF" });
  }

  let claims;
  try {
    claims = verifyAccessToken(token);
  } catch {
    return rejectCredentials(req, res, "Invalid or expired session");
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: claims.sub },
      select: { id: true, email: true, name: true, tokenVersion: true, emailVerifiedAt: true },
    });
    if (!user || user.tokenVersion !== claims.tv) {
      return rejectCredentials(req, res, "Session is no longer valid");
    }
    req.user = { id: user.id, email: user.email, name: user.name, emailVerified: !!user.emailVerifiedAt };
    next();
  } catch (err) {
    next(err);
  }
}

/** For handlers mounted behind requireAuth. */
export function currentUser(req: Request) {
  if (!req.user) throw new HttpError(401, "Not authenticated", "UNAUTHENTICATED");
  return req.user;
}

/** Outward-facing actions (creating orgs, inviting people) need a verified email address. */
export function requireVerifiedEmail(req: Request) {
  if (!currentUser(req).emailVerified) {
    throw new HttpError(403, "Verify your email address first — check your inbox for the link", "EMAIL_NOT_VERIFIED");
  }
}
