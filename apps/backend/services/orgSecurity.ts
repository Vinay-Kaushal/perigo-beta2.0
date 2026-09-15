import { prisma } from "../lib/prisma";
import { HttpError } from "../lib/http";
import type { SessionContext } from "../lib/tokens";

export const orgPolicySelect = { id: true, name: true, slug: true, requireMfa: true, ssoConnection: { select: { id: true } } } as const;

export interface OrgPolicy {
  id: string;
  name: string;
  slug: string;
  requireMfa: boolean;
  ssoConnection: { id: string } | null;
}

interface PolicyUser {
  mfaEnabled: boolean;
  session: SessionContext;
}

/**
 * An org that requires 2FA only admits members whose account has it on — or
 * whose session came from the org's own identity provider, which enforces
 * its own MFA. Mirrored by the websocket service (apps/websocket/access.ts).
 */
export function blockedByMfaPolicy(user: PolicyUser, org: OrgPolicy) {
  if (!org.requireMfa || user.mfaEnabled) return false;
  return !(org.ssoConnection && user.session.sso === org.ssoConnection.id);
}

export function mfaRequiredError(org: OrgPolicy) {
  return new HttpError(403, `${org.name} requires two-factor authentication. Turn it on in your account security settings to continue.`, "MFA_REQUIRED", {
    organisation: { id: org.id, name: org.name, slug: org.slug },
  });
}

/** Organisations (of the given ids) whose content this session can't see because of their 2FA policy. */
export async function lockedOrganisationIds(user: PolicyUser, organisationIds: string[]): Promise<Set<string>> {
  if (user.mfaEnabled || organisationIds.length === 0) return new Set();
  const orgs = await prisma.organisation.findMany({ where: { id: { in: organisationIds }, requireMfa: true }, select: orgPolicySelect });
  return new Set(orgs.filter((o) => blockedByMfaPolicy(user, o)).map((o) => o.id));
}

/** Every organisation the user belongs to that this session is locked out of. */
export async function lockedOrganisationIdsForUser(user: PolicyUser & { id: string }): Promise<string[]> {
  if (user.mfaEnabled) return [];
  const orgs = await prisma.organisation.findMany({
    where: { requireMfa: true, members: { some: { userId: user.id } } },
    select: orgPolicySelect,
  });
  return orgs.filter((o) => blockedByMfaPolicy(user, o)).map((o) => o.id);
}
