import { prisma } from "db/client";
import type { AuthedUser } from "./types";

type Viewer = Pick<AuthedUser, "userId" | "ssoConnectionId">;

/**
 * Org 2FA policy, same rule as the REST API (apps/backend/services/orgSecurity.ts):
 * members need 2FA on their account unless this session came from the org's SSO.
 * The account's 2FA state is read live, so turning it on takes effect without reconnecting.
 */
async function passesOrgPolicy(viewer: Viewer, organisationId: string) {
  const org = await prisma.organisation.findUnique({
    where: { id: organisationId },
    select: { requireMfa: true, ssoConnection: { select: { id: true } } },
  });
  if (!org) return false;
  if (!org.requireMfa) return true;
  if (org.ssoConnection && viewer.ssoConnectionId === org.ssoConnection.id) return true;
  const user = await prisma.user.findUnique({ where: { id: viewer.userId }, select: { mfaEnabledAt: true } });
  return !!user?.mfaEnabledAt;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseChannel(channel: unknown): { scope: "board" | "org"; id: string } | null {
  if (typeof channel !== "string") return null;
  const [scope, id, ...rest] = channel.split(":");
  if (rest.length || !id || !UUID_RE.test(id)) return null;
  if (scope !== "board" && scope !== "org") return null;
  return { scope, id };
}

/** Same rules as the REST API (apps/backend/middleware/access.ts). */
export async function canAccessBoard(viewer: Viewer, boardId: string): Promise<boolean> {
  const { userId } = viewer;
  const board = await prisma.board.findUnique({ where: { id: boardId }, select: { organisationId: true } });
  if (!board) return false;
  const membership = await prisma.organisationMember.findUnique({
    where: { userId_organisationId: { userId, organisationId: board.organisationId } },
  });
  if (!membership) return false;
  if (!(await passesOrgPolicy(viewer, board.organisationId))) return false;
  if (membership.role === "OWNER" || membership.role === "ADMIN") return true;
  const boardMember = await prisma.boardMember.findUnique({
    where: { boardId_organisationMemberId: { boardId, organisationMemberId: membership.id } },
  });
  return Boolean(boardMember);
}

export async function canAccessOrg(viewer: Viewer, organisationId: string): Promise<boolean> {
  const membership = await prisma.organisationMember.findUnique({
    where: { userId_organisationId: { userId: viewer.userId, organisationId } },
    select: { id: true },
  });
  return Boolean(membership) && (await passesOrgPolicy(viewer, organisationId));
}

export async function canAccessChannel(viewer: Viewer, channel: string): Promise<boolean> {
  const parsed = parseChannel(channel);
  if (!parsed) return false;
  return parsed.scope === "board" ? canAccessBoard(viewer, parsed.id) : canAccessOrg(viewer, parsed.id);
}
