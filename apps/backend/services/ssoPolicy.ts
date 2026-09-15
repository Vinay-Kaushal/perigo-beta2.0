import { prisma } from "../lib/prisma";
import type { SessionContext } from "../lib/tokens";

export const emailDomain = (email: string) => email.slice(email.lastIndexOf("@") + 1).toLowerCase();

export interface DomainConnection {
  connectionId: string;
  organisationId: string;
  organisation: { name: string; slug: string };
  enforce: boolean;
}

/**
 * The enabled SSO connection that is authoritative for an email's domain: the
 * domain must be verified by the connection's organisation. A domain can only
 * be verified by one organisation, so there's at most one.
 */
export async function connectionForDomain(domain: string): Promise<DomainConnection | null> {
  const row = await prisma.orgDomain.findFirst({
    where: { domain, verifiedAt: { not: null }, organisation: { ssoConnection: { enabled: true } } },
    select: { organisation: { select: { id: true, name: true, slug: true, ssoConnection: { select: { id: true, enforce: true } } } } },
  });
  const conn = row?.organisation.ssoConnection;
  if (!row || !conn) return null;
  return {
    connectionId: conn.id,
    organisationId: row.organisation.id,
    organisation: { name: row.organisation.name, slug: row.organisation.slug },
    enforce: conn.enforce,
  };
}

// requireAuth consults this on every request, so enforcement lookups are cached briefly per domain.
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { value: DomainConnection | null; expires: number }>();

async function enforcedConnection(domain: string) {
  const hit = cache.get(domain);
  if (hit && hit.expires > Date.now()) return hit.value;
  const conn = await connectionForDomain(domain);
  const value = conn?.enforce ? conn : null;
  cache.set(domain, { value, expires: Date.now() + CACHE_TTL_MS });
  if (cache.size > 10_000) cache.delete(cache.keys().next().value!);
  return value;
}

/** Call after changing domains or SSO settings so this instance applies them immediately. */
export function invalidateSsoPolicyCache() {
  cache.clear();
}

/**
 * When a user's domain enforces SSO, sessions must come from that connection.
 * Owners of the enforcing organisation are exempt, so a broken identity
 * provider can never lock everyone out. Returns the requirement when this
 * session doesn't satisfy it.
 */
export async function unmetSsoRequirement(user: { id: string; email: string }, session: SessionContext): Promise<DomainConnection | null> {
  const conn = await enforcedConnection(emailDomain(user.email));
  if (!conn || session.sso === conn.connectionId) return null;
  const owner = await prisma.organisationMember.findFirst({
    where: { userId: user.id, organisationId: conn.organisationId, role: "OWNER" },
    select: { id: true },
  });
  return owner ? null : conn;
}
