import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { publicUser } from "../lib/selects";
import { badRequest, conflict, forbidden, notFound, param } from "../lib/http";
import { publishOrgEvent, publishUserEvent } from "../lib/eventBus";
import { currentUser, requireVerifiedEmail } from "../middleware/auth";
import { getMembership } from "../middleware/access";
import { audit } from "../services/audit";
import { deleteObjects } from "../lib/storage";

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "Use lowercase letters, numbers and dashes");

const createOrgSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: slugSchema,
  description: z.string().trim().max(500).optional(),
});

export async function createOrganisation(req: Request, res: Response) {
  const user = currentUser(req);
  requireVerifiedEmail(req);
  const body = createOrgSchema.parse(req.body);

  if (await prisma.organisation.findUnique({ where: { slug: body.slug } })) {
    throw conflict("That URL slug is already taken");
  }

  const org = await prisma.organisation.create({
    data: { ...body, members: { create: { userId: user.id, role: "OWNER" } } },
  });

  await audit(req, { organisationId: org.id, action: "organisation.created", targetType: "organisation", targetId: org.id });
  res.status(201).json({ ...org, myRole: "OWNER" });
}

export async function listMyOrganisations(req: Request, res: Response) {
  const user = currentUser(req);
  const memberships = await prisma.organisationMember.findMany({
    where: { userId: user.id },
    include: { organisation: { include: { _count: { select: { members: true, boards: true, tickets: true } } } } },
    orderBy: { joinedAt: "asc" },
  });
  res.json(memberships.map((m) => ({ ...m.organisation, myRole: m.role })));
}

export async function getOrganisation(req: Request, res: Response) {
  const membership = getMembership(req);
  const org = await prisma.organisation.findUniqueOrThrow({
    where: { id: membership.organisationId },
    include: { _count: { select: { members: true, boards: true, teams: true, tickets: true } } },
  });
  res.json({ ...org, myRole: membership.role });
}

const updateOrgSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  requireJoinApproval: z.boolean().optional(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a 3-letter ISO currency code")
    .optional(),
  ticketPrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,6}$/, "Use 2–6 letters")
    .optional(),
});

export async function updateOrganisation(req: Request, res: Response) {
  const membership = getMembership(req);
  const body = updateOrgSchema.parse(req.body);

  const org = await prisma.organisation.update({ where: { id: membership.organisationId }, data: body });
  await audit(req, { organisationId: org.id, action: "organisation.updated", metadata: body });
  await publishOrgEvent(org.id, "ORG_UPDATED", req.user!.id, { id: org.id });
  res.json({ ...org, myRole: membership.role });
}

const deleteOrgSchema = z.object({ confirmSlug: z.string() });

/** Destructive and irreversible — the caller must echo the slug back as confirmation. */
export async function deleteOrganisation(req: Request, res: Response) {
  const membership = getMembership(req);
  const { confirmSlug } = deleteOrgSchema.parse(req.body ?? {});
  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: membership.organisationId } });
  if (confirmSlug !== org.slug) throw badRequest("Confirmation does not match the organisation slug");

  const members = await prisma.organisationMember.findMany({ where: { organisationId: org.id }, select: { userId: true } });
  const files = await prisma.ticketAttachment.findMany({ where: { ticket: { organisationId: org.id } }, select: { storageKey: true } });
  await prisma.organisation.delete({ where: { id: org.id } });
  await deleteObjects(files.map((f) => f.storageKey));
  await Promise.all(members.map((m) => publishUserEvent(m.userId, "ACCESS_REVOKED", req.user!.id, { organisationId: org.id })));
  res.status(204).send();
}

// ---------------------------------------------------------------- members

export async function listMembers(req: Request, res: Response) {
  const membership = getMembership(req);
  const members = await prisma.organisationMember.findMany({
    where: { organisationId: membership.organisationId },
    include: {
      user: publicUser,
      teams: { include: { team: { select: { id: true, name: true } } } },
    },
    orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
  });
  res.json(
    members.map((m) => ({
      id: m.id,
      userId: m.userId,
      organisationId: m.organisationId,
      role: m.role,
      joinedAt: m.joinedAt,
      user: m.user,
      teams: m.teams.map((t) => t.team),
    }))
  );
}

async function loadTargetMember(orgId: string, memberId: string) {
  const target = await prisma.organisationMember.findFirst({ where: { id: memberId, organisationId: orgId } });
  if (!target) throw notFound("Member not found");
  return target;
}

async function ownerCount(orgId: string) {
  return prisma.organisationMember.count({ where: { organisationId: orgId, role: "OWNER" } });
}

const updateRoleSchema = z.object({ role: z.enum(["OWNER", "ADMIN", "MEMBER"]) });

/** Owners only. The last owner can never be demoted — the org would become unmanageable. */
export async function updateMemberRole(req: Request, res: Response) {
  const membership = getMembership(req);
  const orgId = membership.organisationId;
  const { role } = updateRoleSchema.parse(req.body);
  const target = await loadTargetMember(orgId, param(req, "memberId"));

  if (target.role === role) return res.json(target);
  if (target.role === "OWNER" && (await ownerCount(orgId)) <= 1) {
    throw conflict("An organisation must keep at least one owner");
  }

  const updated = await prisma.organisationMember.update({ where: { id: target.id }, data: { role } });
  await audit(req, {
    organisationId: orgId,
    action: "member.role_changed",
    targetType: "user",
    targetId: target.userId,
    metadata: { from: target.role, to: role },
  });
  await publishOrgEvent(orgId, "MEMBER_UPDATED", req.user!.id, { userId: target.userId, role });
  // Demotions can shrink board visibility — let open sockets re-check access.
  await publishUserEvent(target.userId, "ACCESS_CHANGED", req.user!.id, { organisationId: orgId });
  res.json(updated);
}

/** Cleans up everything tying a departing member to live work in the org. */
async function detachMember(orgId: string, userId: string) {
  await prisma.$transaction([
    prisma.ticket.updateMany({
      where: { organisationId: orgId, assigneeId: userId, status: { in: ["NEW", "OPEN", "IN_PROGRESS", "ON_HOLD"] } },
      data: { assigneeId: null },
    }),
    prisma.ticketWatcher.deleteMany({ where: { userId, ticket: { organisationId: orgId } } }),
    prisma.taskAssignee.deleteMany({ where: { userId, task: { board: { organisationId: orgId } } } }),
    prisma.organisationMember.delete({ where: { userId_organisationId: { userId, organisationId: orgId } } }),
  ]);
}

/**
 * Owners can remove anyone except the last owner. Admins can remove
 * members only — not other admins or owners.
 */
export async function removeMember(req: Request, res: Response) {
  const membership = getMembership(req);
  const orgId = membership.organisationId;
  const target = await loadTargetMember(orgId, param(req, "memberId"));

  if (target.userId === membership.userId) throw badRequest("Use 'leave organisation' to remove yourself");
  if (membership.role === "ADMIN" && target.role !== "MEMBER") {
    throw forbidden("Admins can only remove members");
  }
  if (target.role === "OWNER" && (await ownerCount(orgId)) <= 1) {
    throw conflict("An organisation must keep at least one owner");
  }

  await detachMember(orgId, target.userId);
  await audit(req, { organisationId: orgId, action: "member.removed", targetType: "user", targetId: target.userId, metadata: { role: target.role } });
  await publishOrgEvent(orgId, "MEMBER_REMOVED", req.user!.id, { userId: target.userId });
  await publishUserEvent(target.userId, "ACCESS_REVOKED", req.user!.id, { organisationId: orgId });
  res.status(204).send();
}

export async function leaveOrganisation(req: Request, res: Response) {
  const membership = getMembership(req);
  const orgId = membership.organisationId;
  if (membership.role === "OWNER" && (await ownerCount(orgId)) <= 1) {
    throw conflict("Transfer ownership to someone else before leaving");
  }
  await detachMember(orgId, membership.userId);
  await audit(req, { organisationId: orgId, action: "member.left", targetType: "user", targetId: membership.userId });
  await publishOrgEvent(orgId, "MEMBER_REMOVED", membership.userId, { userId: membership.userId });
  await publishUserEvent(membership.userId, "ACCESS_REVOKED", membership.userId, { organisationId: orgId });
  res.status(204).send();
}

// ---------------------------------------------------------------- audit log

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().uuid().optional(),
  action: z.string().max(60).optional(),
});

export async function listAuditLogs(req: Request, res: Response) {
  const membership = getMembership(req);
  const q = auditQuerySchema.parse(req.query);
  const logs = await prisma.auditLog.findMany({
    where: { organisationId: membership.organisationId, action: q.action ? { startsWith: q.action } : undefined },
    include: { actor: publicUser },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: q.limit + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = logs.length > q.limit;
  const items = hasMore ? logs.slice(0, q.limit) : logs;
  res.json({ items, nextCursor: hasMore ? items[items.length - 1]!.id : null });
}
