import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { env } from "../lib/env";
import { encryptSecret, decryptSecret } from "../lib/crypto";
import { HttpError, conflict, notFound, param } from "../lib/http";
import { lookupTxt } from "../lib/dnsTxt";
import { randomToken } from "../lib/tokens";
import { publishUserEvent } from "../lib/eventBus";
import { currentUser } from "../middleware/auth";
import { getMembership } from "../middleware/access";
import { audit } from "../services/audit";
import { invalidateSsoPolicyCache } from "../services/ssoPolicy";
import { beginSso, callbackUrl, clearSsoConfigCache, discover, SsoError } from "../services/sso";
import { frontendUrl } from "./auth.controller";
import { setStateCookie } from "./sso.controller";

const TXT_PREFIX = "_perigo-challenge";
const MAX_DOMAINS = 20;

const verificationRecord = (domain: string, token: string) => ({ type: "TXT", name: `${TXT_PREFIX}.${domain}`, value: `perigo-domain-verification=${token}` });

async function load(organisationId: string) {
  const [org, domains, conn, members] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({ where: { id: organisationId }, select: { requireMfa: true } }),
    prisma.orgDomain.findMany({ where: { organisationId }, orderBy: { createdAt: "asc" } }),
    prisma.ssoConnection.findUnique({ where: { organisationId }, include: { _count: { select: { identities: true } } } }),
    prisma.organisationMember.findMany({ where: { organisationId }, select: { user: { select: { id: true, name: true, email: true, mfaEnabledAt: true } } } }),
  ]);
  const withoutMfa = members.filter((m) => !m.user.mfaEnabledAt).map((m) => ({ id: m.user.id, name: m.user.name, email: m.user.email }));
  return {
    requireMfa: org.requireMfa,
    mfa: { members: members.length, withoutMfa },
    domains: domains.map((d) => ({ id: d.id, domain: d.domain, verifiedAt: d.verifiedAt, record: verificationRecord(d.domain, d.verificationToken) })),
    sso: conn
      ? {
          issuer: conn.issuer,
          clientId: conn.clientId,
          hasClientSecret: !!conn.clientSecret,
          enabled: conn.enabled,
          enforce: conn.enforce,
          autoProvision: conn.autoProvision,
          testedAt: conn.testedAt,
          linkedAccounts: conn._count.identities,
          updatedAt: conn.updatedAt,
        }
      : null,
    callbackUrl: callbackUrl(),
    domainVerification: env().SSO_DOMAIN_VERIFICATION,
  };
}

export async function getSecurity(req: Request, res: Response) {
  res.json(await load(getMembership(req).organisationId));
}

const policySchema = z.object({ requireMfa: z.boolean() });

export async function updateSecurityPolicy(req: Request, res: Response) {
  const orgId = getMembership(req).organisationId;
  const me = currentUser(req);
  const { requireMfa } = policySchema.parse(req.body);

  // Nobody can impose a requirement that would lock themselves out.
  if (requireMfa && !me.mfaEnabled) {
    throw new HttpError(409, "Turn on two-factor authentication for your own account first", "MFA_NOT_ENABLED");
  }
  const before = await prisma.organisation.findUniqueOrThrow({ where: { id: orgId }, select: { requireMfa: true } });
  await prisma.organisation.update({ where: { id: orgId }, data: { requireMfa } });

  if (before.requireMfa !== requireMfa) {
    await audit(req, { organisationId: orgId, action: requireMfa ? "security.mfa_required" : "security.mfa_optional" });
    // Live sockets of members without 2FA re-check their access immediately.
    const affected = await prisma.organisationMember.findMany({ where: { organisationId: orgId, user: { mfaEnabledAt: null } }, select: { userId: true } });
    await Promise.all(affected.map((m) => publishUserEvent(m.userId, "ACCESS_CHANGED", me.id, { organisationId: orgId })));
  }
  res.json(await load(orgId));
}

// ---------------------------------------------------------------- domains

const domainSchema = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .max(253)
    .regex(/^(?!-)(?:[a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/, "Enter a domain like example.com"),
});

export async function addDomain(req: Request, res: Response) {
  const orgId = getMembership(req).organisationId;
  const { domain } = domainSchema.parse(req.body);
  if ((await prisma.orgDomain.count({ where: { organisationId: orgId } })) >= MAX_DOMAINS) throw conflict(`An organisation can claim at most ${MAX_DOMAINS} domains`);
  const row = await prisma.orgDomain.create({ data: { organisationId: orgId, domain, verificationToken: randomToken(24) } });
  await audit(req, { organisationId: orgId, action: "domain.added", targetType: "domain", targetId: row.id, metadata: { domain } });
  res.status(201).json(await load(orgId));
}

export async function verifyDomain(req: Request, res: Response) {
  const orgId = getMembership(req).organisationId;
  const row = await prisma.orgDomain.findFirst({ where: { id: param(req, "domainId"), organisationId: orgId } });
  if (!row) throw notFound("Domain not found");
  if (row.verifiedAt) return res.json(await load(orgId));

  if (env().SSO_DOMAIN_VERIFICATION === "dns") {
    const record = verificationRecord(row.domain, row.verificationToken);
    const values = await lookupTxt(record.name);
    if (!values.includes(record.value)) {
      throw new HttpError(422, `We couldn't find the TXT record on ${record.name} yet. DNS changes can take a while to appear — try again shortly.`, "DOMAIN_NOT_VERIFIED");
    }
  }

  // One organisation per verified domain: the check and the update share a transaction.
  await prisma.$transaction(
    async (tx) => {
      const taken = await tx.orgDomain.findFirst({ where: { domain: row.domain, verifiedAt: { not: null }, organisationId: { not: orgId } } });
      if (taken) throw conflict(`${row.domain} is already verified by another organisation`);
      await tx.orgDomain.update({ where: { id: row.id }, data: { verifiedAt: new Date() } });
    },
    { isolationLevel: "Serializable" }
  );
  invalidateSsoPolicyCache();
  await audit(req, { organisationId: orgId, action: "domain.verified", targetType: "domain", targetId: row.id, metadata: { domain: row.domain } });
  res.json(await load(orgId));
}

export async function removeDomain(req: Request, res: Response) {
  const orgId = getMembership(req).organisationId;
  const row = await prisma.orgDomain.findFirst({ where: { id: param(req, "domainId"), organisationId: orgId } });
  if (!row) throw notFound("Domain not found");
  await prisma.$transaction(async (tx) => {
    await tx.orgDomain.delete({ where: { id: row.id } });
    // Enforcement without a verified domain would apply to nobody; switch it off explicitly.
    if (!(await tx.orgDomain.count({ where: { organisationId: orgId, verifiedAt: { not: null } } }))) {
      await tx.ssoConnection.updateMany({ where: { organisationId: orgId }, data: { enforce: false } });
    }
  });
  invalidateSsoPolicyCache();
  await audit(req, { organisationId: orgId, action: "domain.removed", targetType: "domain", targetId: row.id, metadata: { domain: row.domain } });
  res.json(await load(orgId));
}

// ---------------------------------------------------------------- SSO connection

const issuerSchema = z
  .string()
  .trim()
  .url("Enter the issuer URL, e.g. https://your-tenant.okta.com")
  .max(500)
  .refine((v) => /^https:\/\//i.test(v) || (env().SSO_ALLOW_HTTP_ISSUERS === "true" && /^http:\/\//i.test(v)), "The issuer must use https://");

const ssoSchema = z.object({
  issuer: issuerSchema,
  clientId: z.string().trim().min(1).max(255),
  /** Omit to keep the stored secret. */
  clientSecret: z.string().min(1).max(1000).optional(),
  enabled: z.boolean(),
  enforce: z.boolean(),
  autoProvision: z.boolean(),
});

export async function upsertSso(req: Request, res: Response) {
  const orgId = getMembership(req).organisationId;
  const body = ssoSchema.parse(req.body);
  const existing = await prisma.ssoConnection.findUnique({ where: { organisationId: orgId } });
  if (!existing && !body.clientSecret) throw new HttpError(400, "Enter the client secret from your identity provider", "BAD_REQUEST");

  const secret = body.clientSecret ?? decryptSecret(existing!.clientSecret);
  const credentialsChanged = !existing || existing.issuer !== body.issuer || existing.clientId !== body.clientId || body.clientSecret !== undefined;

  if (credentialsChanged) {
    try {
      await discover(body.issuer, body.clientId, secret);
    } catch (err) {
      throw new HttpError(422, err instanceof SsoError ? err.message : "Couldn't reach the identity provider", "SSO_DISCOVERY_FAILED");
    }
  }

  const testedAt = credentialsChanged ? null : existing!.testedAt;
  if (body.enforce) {
    if (!body.enabled) throw conflict("Turn SSO on before enforcing it");
    if (!testedAt) throw conflict("Test the connection successfully before enforcing SSO");
    if (!(await prisma.orgDomain.count({ where: { organisationId: orgId, verifiedAt: { not: null } } }))) throw conflict("Verify at least one domain before enforcing SSO");
  }

  const data = {
    issuer: body.issuer,
    clientId: body.clientId,
    clientSecret: body.clientSecret ? encryptSecret(body.clientSecret) : existing!.clientSecret,
    enabled: body.enabled,
    enforce: body.enforce,
    autoProvision: body.autoProvision,
    testedAt,
  };
  await prisma.ssoConnection.upsert({ where: { organisationId: orgId }, update: data, create: { organisationId: orgId, ...data } });
  invalidateSsoPolicyCache();
  clearSsoConfigCache();

  await audit(req, {
    organisationId: orgId,
    action: existing ? "sso.updated" : "sso.created",
    // Never the secret — only whether it changed.
    metadata: { issuer: body.issuer, clientId: body.clientId, secretChanged: body.clientSecret !== undefined, enabled: body.enabled, enforce: body.enforce, autoProvision: body.autoProvision },
  });
  res.json(await load(orgId));
}

export async function deleteSso(req: Request, res: Response) {
  const orgId = getMembership(req).organisationId;
  const removed = await prisma.ssoConnection.deleteMany({ where: { organisationId: orgId } });
  if (!removed.count) throw notFound("SSO isn't set up");
  invalidateSsoPolicyCache();
  clearSsoConfigCache();
  await audit(req, { organisationId: orgId, action: "sso.deleted" });
  res.json(await load(orgId));
}

/** GET — a browser navigation that runs a sign-in against the IdP without changing anyone's session. */
export async function testSso(req: Request, res: Response) {
  const orgId = getMembership(req).organisationId;
  const settings = (query: string) => frontendUrl(`/orgs/${orgId}/settings?${query}#sso`);
  const conn = await prisma.ssoConnection.findUnique({ where: { organisationId: orgId } });
  if (!conn) return res.redirect(302, settings("sso_test=failed&reason=not_configured"));
  try {
    const { url, state } = await beginSso(conn, { mode: "test", next: "/", userId: currentUser(req).id });
    setStateCookie(res, state);
    res.redirect(302, url);
  } catch (err) {
    console.error(`[sso] couldn't start a test for connection ${conn.id}`, err);
    res.redirect(302, settings("sso_test=failed&reason=provider_unavailable"));
  }
}
