import { prisma } from "db/client";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseChannel(channel: unknown): { scope: "board" | "org"; id: string } | null {
  if (typeof channel !== "string") return null;
  const [scope, id, ...rest] = channel.split(":");
  if (rest.length || !id || !UUID_RE.test(id)) return null;
  if (scope !== "board" && scope !== "org") return null;
  return { scope, id };
}

/** Same rules as the REST API (apps/backend/middleware/access.ts). */
export async function canAccessBoard(userId: string, boardId: string): Promise<boolean> {
  const board = await prisma.board.findUnique({ where: { id: boardId }, select: { organisationId: true } });
  if (!board) return false;
  const membership = await prisma.organisationMember.findUnique({
    where: { userId_organisationId: { userId, organisationId: board.organisationId } },
  });
  if (!membership) return false;
  if (membership.role === "OWNER" || membership.role === "ADMIN") return true;
  const boardMember = await prisma.boardMember.findUnique({
    where: { boardId_organisationMemberId: { boardId, organisationMemberId: membership.id } },
  });
  return Boolean(boardMember);
}

export async function canAccessOrg(userId: string, organisationId: string): Promise<boolean> {
  const membership = await prisma.organisationMember.findUnique({
    where: { userId_organisationId: { userId, organisationId } },
    select: { id: true },
  });
  return Boolean(membership);
}

export async function canAccessChannel(userId: string, channel: string): Promise<boolean> {
  const parsed = parseChannel(channel);
  if (!parsed) return false;
  return parsed.scope === "board" ? canAccessBoard(userId, parsed.id) : canAccessOrg(userId, parsed.id);
}
