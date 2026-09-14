import type { Request, Response } from "express";
import { z } from "zod";
import type { Invitation } from "db/client";
import { prisma } from "../lib/prisma";
import { env } from "../lib/env";
import { publicUser } from "../lib/selects";
import { conflict, forbidden, HttpError, notFound, param } from "../lib/http";
import { randomToken, sha256 } from "../lib/tokens";
import { invitationEmail, sendMail } from "../lib/mailer";
import { publishOrgEvent, publishUserEvent } from "../lib/eventBus";
import { currentUser, requireVerifiedEmail } from "../middleware/auth";
import { getMembership, isOrgAdmin } from "../middleware/access";
import { audit } from "../services/audit";
import { notify, orgAdminIds } from "../services/notifications";
import { emailSchema } from "./auth.controller";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LIVE_STATUSES = ["PENDING", "AWAITING_APPROVAL"] as const;

/** Never serialise tokenHash. */
function serialise(inv: Invitation & Record<string, unknown>) {
  const { tokenHash: _omit, ...rest } = inv;
  return rest;
}

function inviteUrl(token: string) {
  return `${env().FRONTEND_URL.replace(/\/$/, "")}/invitations/${token}`;
}

async function deliverInvite(inv: Invitation, token: string, inviterName: string) {
  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: inv.organisationId } });
  const url = inviteUrl(token);
  const emailed = await sendMail(
    invitationEmail({ to: inv.email, orgName: org.name, inviterName, role: inv.role, url, requiresApproval: org.requireJoinApproval })
  );
  return { url, emailed };
}

const inviteSchema = z.object({
  email: emailSchema,
  role: z.enum(["ADMIN", "MEMBER"]).default("MEMBER"),
  message: z.string().trim().max(500).optional(),
});

/**
 * Any member may invite (like GitHub/Figma), but only owners/admins may
 * invite admins. Ownership is never granted by invitation — it's transferred
 * through a role change. Re-inviting an email replaces its live invite.
 */
export async function createInvitation(req: Request, res: Response) {
  const user = currentUser(req);
  requireVerifiedEmail(req);
  const membership = getMembership(req);
  const orgId = membership.organisationId;
  const body = inviteSchema.parse(req.body);

  if (body.role === "ADMIN" && !isOrgAdmin(membership.role)) {
    throw forbidden("Only owners and admins can invite admins");
  }

  const alreadyMember = await prisma.organisationMember.findFirst({
    where: { organisationId: orgId, user: { email: body.email } },
  });
  if (alreadyMember) throw conflict("This person is already a member");

  const token = randomToken();
  const invitation = await prisma.$transaction(async (tx) => {
    const live = await tx.invitation.findFirst({
      where: { organisationId: orgId, email: body.email, status: { in: [...LIVE_STATUSES] } },
    });
    if (live?.status === "AWAITING_APPROVAL") {
      throw conflict("This person has already accepted an invitation and is awaiting approval");
    }
    if (live) await tx.invitation.update({ where: { id: live.id }, data: { status: "REVOKED" } });

    return tx.invitation.create({
      data: {
        organisationId: orgId,
        email: body.email,
        role: body.role,
        message: body.message,
        invitedById: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });
  });

  const { url, emailed } = await deliverInvite(invitation, token, user.name);
  await audit(req, { organisationId: orgId, action: "invitation.created", targetType: "invitation", targetId: invitation.id, metadata: { email: body.email, role: body.role } });

  // Existing users get an in-app heads-up too; acceptance still requires the emailed link.
  const invitee = await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } });
  if (invitee) {
    const org = await prisma.organisation.findUniqueOrThrow({ where: { id: orgId }, select: { name: true } });
    await notify([invitee.id], {
      type: "INVITATION_RECEIVED",
      title: `${user.name} invited you to join ${org.name}`,
      body: "Check your email for the invitation link.",
      actorId: user.id,
    });
  }

  res.status(201).json({ ...serialise(invitation), inviteUrl: url, emailed });
}

const listQuerySchema = z.object({
  status: z.enum(["PENDING", "AWAITING_APPROVAL", "ACCEPTED", "REJECTED", "REVOKED", "EXPIRED", "LIVE"]).default("LIVE"),
});

export async function listInvitations(req: Request, res: Response) {
  const membership = getMembership(req);
  const { status } = listQuerySchema.parse(req.query);

  // Lazily expire stale invites so lists never show dead links as pending.
  await prisma.invitation.updateMany({
    where: { organisationId: membership.organisationId, status: "PENDING", expiresAt: { lt: new Date() } },
    data: { status: "EXPIRED" },
  });

  const invitations = await prisma.invitation.findMany({
    where: {
      organisationId: membership.organisationId,
      status: status === "LIVE" ? { in: [...LIVE_STATUSES] } : status,
    },
    include: { invitedBy: publicUser, acceptedBy: publicUser, reviewedBy: publicUser },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json(invitations.map(serialise));
}

async function loadOrgInvitation(req: Request) {
  const membership = getMembership(req);
  const inv = await prisma.invitation.findFirst({
    where: { id: param(req, "invitationId"), organisationId: membership.organisationId },
  });
  if (!inv) throw notFound("Invitation not found");
  return { inv, membership };
}

/** Admins, or the member who sent it, may revoke a live invitation. */
export async function revokeInvitation(req: Request, res: Response) {
  const { inv, membership } = await loadOrgInvitation(req);
  if (!isOrgAdmin(membership.role) && inv.invitedById !== membership.userId) {
    throw forbidden("Only admins or the inviter can revoke this invitation");
  }
  if (!LIVE_STATUSES.includes(inv.status as (typeof LIVE_STATUSES)[number])) {
    throw conflict(`Invitation is already ${inv.status.toLowerCase()}`);
  }
  await prisma.invitation.update({ where: { id: inv.id }, data: { status: "REVOKED" } });
  await audit(req, { organisationId: inv.organisationId, action: "invitation.revoked", targetType: "invitation", targetId: inv.id, metadata: { email: inv.email } });
  res.status(204).send();
}

/** Issues a fresh token (old link stops working) and a new expiry. */
export async function resendInvitation(req: Request, res: Response) {
  const user = currentUser(req);
  const { inv, membership } = await loadOrgInvitation(req);
  if (!isOrgAdmin(membership.role) && inv.invitedById !== membership.userId) {
    throw forbidden("Only admins or the inviter can resend this invitation");
  }
  if (inv.status !== "PENDING" && inv.status !== "EXPIRED") {
    throw conflict("Only pending or expired invitations can be resent");
  }

  const token = randomToken();
  const updated = await prisma.invitation.update({
    where: { id: inv.id },
    data: { tokenHash: sha256(token), status: "PENDING", expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
  });
  const { url, emailed } = await deliverInvite(updated, token, user.name);
  await audit(req, { organisationId: inv.organisationId, action: "invitation.resent", targetType: "invitation", targetId: inv.id });
  res.json({ ...serialise(updated), inviteUrl: url, emailed });
}

export async function approveInvitation(req: Request, res: Response) {
  const user = currentUser(req);
  const { inv } = await loadOrgInvitation(req);
  if (inv.status !== "AWAITING_APPROVAL" || !inv.acceptedById) {
    throw conflict("Only invitations awaiting approval can be approved");
  }
  const joinerId = inv.acceptedById;

  const member = await prisma.$transaction(async (tx) => {
    const created = await tx.organisationMember.upsert({
      where: { userId_organisationId: { userId: joinerId, organisationId: inv.organisationId } },
      update: {},
      create: { userId: joinerId, organisationId: inv.organisationId, role: inv.role },
    });
    await tx.invitation.update({
      where: { id: inv.id },
      data: { status: "ACCEPTED", reviewedById: user.id, reviewedAt: new Date() },
    });
    return created;
  });

  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: inv.organisationId }, select: { id: true, name: true } });
  await audit(req, { organisationId: org.id, action: "invitation.approved", targetType: "user", targetId: joinerId, metadata: { email: inv.email, role: inv.role } });
  await notify([joinerId], {
    type: "JOIN_APPROVED",
    title: `You've been approved to join ${org.name}`,
    link: `/orgs/${org.id}`,
    organisationId: org.id,
    actorId: user.id,
  });
  await publishOrgEvent(org.id, "MEMBER_JOINED", user.id, { userId: joinerId });
  await publishUserEvent(joinerId, "ACCESS_CHANGED", user.id, { organisationId: org.id });
  res.json(member);
}

const rejectSchema = z.object({ reason: z.string().trim().max(500).optional() });

export async function rejectInvitation(req: Request, res: Response) {
  const user = currentUser(req);
  const { inv } = await loadOrgInvitation(req);
  const { reason } = rejectSchema.parse(req.body ?? {});
  if (inv.status !== "AWAITING_APPROVAL") throw conflict("Only invitations awaiting approval can be rejected");

  await prisma.invitation.update({
    where: { id: inv.id },
    data: { status: "REJECTED", reviewedById: user.id, reviewedAt: new Date() },
  });
  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: inv.organisationId }, select: { name: true } });
  await audit(req, { organisationId: inv.organisationId, action: "invitation.rejected", targetType: "invitation", targetId: inv.id, metadata: { email: inv.email, reason } });
  await notify([inv.acceptedById], {
    type: "JOIN_REJECTED",
    title: `Your request to join ${org.name} was declined`,
    body: reason ?? null,
    actorId: user.id,
  });
  res.status(204).send();
}

// ---------------------------------------------------------------- token-based (invitee side)

async function findLiveByToken(token: string) {
  if (token.length < 20 || token.length > 128) return null;
  const inv = await prisma.invitation.findUnique({
    where: { tokenHash: sha256(token) },
    include: { organisation: true, invitedBy: publicUser },
  });
  if (!inv) return null;
  if (inv.status === "PENDING" && inv.expiresAt < new Date()) {
    await prisma.invitation.update({ where: { id: inv.id }, data: { status: "EXPIRED" } });
    return { ...inv, status: "EXPIRED" as const };
  }
  return inv;
}

/** Public preview — no auth, so it reveals only what the link holder needs to decide. */
export async function previewInvitation(req: Request, res: Response) {
  const inv = await findLiveByToken(param(req, "token"));
  if (!inv) throw notFound("This invitation is invalid or has expired");

  res.json({
    organisationName: inv.organisation.name,
    invitedByName: inv.invitedBy.name,
    email: inv.email,
    role: inv.role,
    status: inv.status,
    message: inv.message,
    expiresAt: inv.expiresAt,
    requiresApproval: inv.organisation.requireJoinApproval,
  });
}

/**
 * Possession of the emailed token proves control of the inbox; the signed-in
 * account must also use that email, so a forwarded link can't be redeemed
 * by someone else.
 */
export async function acceptInvitation(req: Request, res: Response) {
  const user = currentUser(req);
  const inv = await findLiveByToken(param(req, "token"));
  if (!inv) throw notFound("This invitation is invalid or has expired");
  if (inv.status !== "PENDING") {
    throw new HttpError(410, `This invitation is ${inv.status.toLowerCase().replace("_", " ")}`, "INVITATION_NOT_PENDING");
  }
  if (inv.email !== user.email.toLowerCase()) {
    throw forbidden(`This invitation was sent to ${inv.email}. Sign in with that account to accept it.`);
  }

  const orgId = inv.organisationId;
  // Redeeming a link that was emailed to this address proves the user controls the inbox.
  await prisma.user.updateMany({ where: { id: user.id, emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } });

  const existing = await prisma.organisationMember.findUnique({
    where: { userId_organisationId: { userId: user.id, organisationId: orgId } },
  });
  if (existing) {
    await prisma.invitation.update({ where: { id: inv.id }, data: { status: "ACCEPTED", acceptedById: user.id, acceptedAt: new Date() } });
    return res.json({ status: "ACCEPTED", organisationId: orgId });
  }

  // Approval is needed when the org demands it, or when a non-admin sent the invite.
  const inviter = await prisma.organisationMember.findUnique({
    where: { userId_organisationId: { userId: inv.invitedById, organisationId: orgId } },
  });
  const needsApproval = inv.organisation.requireJoinApproval || !inviter || !isOrgAdmin(inviter.role);

  if (needsApproval) {
    await prisma.invitation.update({
      where: { id: inv.id },
      data: { status: "AWAITING_APPROVAL", acceptedById: user.id, acceptedAt: new Date() },
    });
    await audit(req, { organisationId: orgId, action: "invitation.accepted", targetType: "invitation", targetId: inv.id, metadata: { email: inv.email } });
    await notify(await orgAdminIds(orgId), {
      type: "JOIN_REQUEST",
      title: `${user.name} is waiting to join ${inv.organisation.name}`,
      body: `${inv.email} accepted an invitation as ${inv.role.toLowerCase()}. Review the request.`,
      link: `/orgs/${orgId}/members?tab=requests`,
      organisationId: orgId,
      actorId: user.id,
    });
    await publishOrgEvent(orgId, "JOIN_REQUESTED", user.id, { invitationId: inv.id });
    return res.status(202).json({ status: "AWAITING_APPROVAL", organisationId: orgId });
  }

  await prisma.$transaction([
    prisma.organisationMember.create({ data: { userId: user.id, organisationId: orgId, role: inv.role } }),
    prisma.invitation.update({ where: { id: inv.id }, data: { status: "ACCEPTED", acceptedById: user.id, acceptedAt: new Date() } }),
  ]);
  await audit(req, { organisationId: orgId, action: "invitation.accepted", targetType: "user", targetId: user.id, metadata: { email: inv.email, role: inv.role, autoApproved: true } });
  await notify([inv.invitedById], {
    type: "INVITATION_ACCEPTED",
    title: `${user.name} joined ${inv.organisation.name}`,
    link: `/orgs/${orgId}/members`,
    organisationId: orgId,
    actorId: user.id,
  });
  await publishOrgEvent(orgId, "MEMBER_JOINED", user.id, { userId: user.id });
  res.status(201).json({ status: "ACCEPTED", organisationId: orgId });
}

export async function declineInvitation(req: Request, res: Response) {
  const user = currentUser(req);
  const inv = await findLiveByToken(param(req, "token"));
  if (!inv || inv.status !== "PENDING") throw notFound("This invitation is invalid or has expired");
  if (inv.email !== user.email.toLowerCase()) throw forbidden("This invitation was sent to a different email address");
  await prisma.invitation.update({ where: { id: inv.id }, data: { status: "REVOKED" } });
  await audit(req, { organisationId: inv.organisationId, action: "invitation.declined", targetType: "invitation", targetId: inv.id });
  res.status(204).send();
}

/** The signed-in user's own join requests (so they can see "awaiting approval"). */
export async function myJoinRequests(req: Request, res: Response) {
  const user = currentUser(req);
  const requests = await prisma.invitation.findMany({
    where: { acceptedById: user.id, status: { in: ["AWAITING_APPROVAL", "REJECTED"] } },
    include: { organisation: { select: { id: true, name: true } } },
    orderBy: { acceptedAt: "desc" },
    take: 20,
  });
  res.json(
    requests.map((r) => ({ id: r.id, status: r.status, role: r.role, acceptedAt: r.acceptedAt, reviewedAt: r.reviewedAt, organisation: r.organisation }))
  );
}
