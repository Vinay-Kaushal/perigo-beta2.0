import type { Request, Response } from "express";
import { timingSafeEqual } from "crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { Prisma, type SsoConnection } from "db/client";
import { prisma } from "../lib/prisma";
import { env } from "../lib/env";
import { randomToken } from "../lib/tokens";
import { cookieOptions, readCookie } from "../lib/session";
import { publishOrgEvent, publishUserEvent } from "../lib/eventBus";
import { audit } from "../services/audit";
import { connectionForDomain, emailDomain } from "../services/ssoPolicy";
import { beginSso, completeSso, SSO_STATE_COOKIE, SSO_STATE_TTL_SEC, SsoError, takeSsoState, type SsoClaims, type SsoState } from "../services/sso";
import { emailSchema, frontendUrl, session } from "./auth.controller";

/** Only same-app relative paths — never an open redirect. */
export function safeNextPath(value: unknown) {
  return typeof value === "string" && /^\/(?![/\\])/.test(value) && value.length <= 500 && !/[\r\n]/.test(value) ? value : "/dashboard";
}

const stateCookieOptions = () => ({ ...cookieOptions(), path: "/auth/sso", maxAge: SSO_STATE_TTL_SEC * 1000 });

/** Binds the flow to this browser, so an attacker can't complete it in a victim's browser with their own account (login CSRF). */
export function setStateCookie(res: Response, state: string) {
  res.cookie(SSO_STATE_COOKIE, state, stateCookieOptions());
}

const loginError = (res: Response, code: string) => res.redirect(302, frontendUrl(`/login?sso_error=${encodeURIComponent(code)}`));

const startSchema = z.object({ email: emailSchema, next: z.string().max(500).optional() });

/** GET /auth/sso/start?email= — a top-level navigation from the login page, redirected to the identity provider. */
export async function startSso(req: Request, res: Response) {
  const parsed = startSchema.safeParse(req.query);
  if (!parsed.success) return loginError(res, "invalid_email");
  const { email, next } = parsed.data;

  const domainConn = await connectionForDomain(emailDomain(email));
  if (!domainConn) return loginError(res, "not_configured");
  const conn = await prisma.ssoConnection.findUniqueOrThrow({ where: { id: domainConn.connectionId } });

  try {
    const { url, state } = await beginSso(conn, { mode: "login", next: safeNextPath(next), loginHint: email });
    setStateCookie(res, state);
    res.redirect(302, url);
  } catch (err) {
    console.error(`[sso] couldn't start sign-in for connection ${conn.id}`, err);
    loginError(res, "provider_unavailable");
  }
}

function statesMatch(a: string | undefined, b: string) {
  if (!a || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** GET /auth/sso/callback — the identity provider sends the browser back here. */
export async function ssoCallback(req: Request, res: Response) {
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const cookieState = readCookie(req, SSO_STATE_COOKIE);
  res.clearCookie(SSO_STATE_COOKIE, { ...cookieOptions(), path: "/auth/sso" });

  const saved = state ? await takeSsoState(state) : null;
  if (!saved) return loginError(res, "expired");

  const conn = await prisma.ssoConnection.findUnique({ where: { id: saved.connectionId } });
  const fail = (code: string) =>
    saved.mode === "test" && conn
      ? res.redirect(302, frontendUrl(`/orgs/${conn.organisationId}/settings?sso_test=failed&reason=${encodeURIComponent(code)}#sso`))
      : loginError(res, code);

  if (!statesMatch(cookieState, state)) return fail("state_mismatch");
  if (!conn || (saved.mode === "login" && !conn.enabled)) return fail("not_configured");

  let claims: SsoClaims;
  try {
    const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?") + 1) : "";
    claims = await completeSso(conn, state, saved, query);
  } catch (err) {
    console.error(`[sso] callback failed for connection ${conn.id}`, err);
    return fail(err instanceof SsoError ? err.code.toLowerCase() : "provider_error");
  }

  return saved.mode === "test" ? finishTest(req, res, conn, saved, claims) : finishLogin(req, res, conn, saved, claims, fail);
}

async function finishTest(req: Request, res: Response, conn: SsoConnection, saved: SsoState, claims: SsoClaims) {
  const settings = (query: string) => frontendUrl(`/orgs/${conn.organisationId}/settings?${query}#sso`);
  const owner = saved.userId
    ? await prisma.organisationMember.findFirst({ where: { userId: saved.userId, organisationId: conn.organisationId, role: "OWNER" } })
    : null;
  if (!owner) return res.redirect(302, settings("sso_test=failed&reason=not_owner"));

  await prisma.ssoConnection.update({ where: { id: conn.id }, data: { testedAt: new Date() } });
  await audit(req, { organisationId: conn.organisationId, action: "sso.tested", actorId: owner.userId, metadata: { email: claims.email } });
  res.redirect(302, settings(`sso_test=ok&email=${encodeURIComponent(claims.email)}`));
}

async function finishLogin(req: Request, res: Response, conn: SsoConnection, saved: SsoState, claims: SsoClaims, fail: (code: string) => void) {
  // The identity provider is only trusted for email domains its organisation has proven it owns.
  const domain = await prisma.orgDomain.findFirst({
    where: { organisationId: conn.organisationId, domain: emailDomain(claims.email), verifiedAt: { not: null } },
  });
  if (!domain) return fail("domain_not_verified");

  const identity = await prisma.ssoIdentity.findUnique({
    where: { connectionId_subject: { connectionId: conn.id, subject: claims.subject } },
    include: { user: true },
  });
  let user = identity?.user ?? (await prisma.user.findUnique({ where: { email: claims.email } }));

  if (!user) {
    if (!conn.autoProvision) return fail("no_account");
    try {
      user = await prisma.user.create({
        data: {
          email: claims.email,
          name: claims.name ?? claims.email.split("@")[0]!,
          // Matches no password: SSO-provisioned accounts sign in through their identity provider.
          passwordHash: await bcrypt.hash(randomToken(32), env().BCRYPT_ROUNDS),
          emailVerifiedAt: new Date(),
        },
      });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
      user = await prisma.user.findUniqueOrThrow({ where: { email: claims.email } });
    }
  }

  await prisma.ssoIdentity.upsert({
    where: { connectionId_subject: { connectionId: conn.id, subject: claims.subject } },
    update: { email: claims.email, lastLoginAt: new Date() },
    create: { connectionId: conn.id, subject: claims.subject, userId: user.id, email: claims.email },
  });

  const member = await prisma.organisationMember.findUnique({
    where: { userId_organisationId: { userId: user.id, organisationId: conn.organisationId } },
  });
  if (!member && conn.autoProvision) {
    await prisma.organisationMember.create({ data: { userId: user.id, organisationId: conn.organisationId, role: "MEMBER" } });
    await audit(req, { organisationId: conn.organisationId, action: "sso.member_provisioned", actorId: user.id, targetType: "user", targetId: user.id, metadata: { email: user.email } });
    await publishOrgEvent(conn.organisationId, "MEMBER_JOINED", user.id, { userId: user.id });
    await publishUserEvent(user.id, "ACCESS_CHANGED", user.id, { organisationId: conn.organisationId });
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), emailVerifiedAt: user.emailVerifiedAt ?? new Date() },
  });
  session(res, updated, { amr: ["sso"], sso: conn.id });
  res.redirect(302, frontendUrl(saved.next));
}
