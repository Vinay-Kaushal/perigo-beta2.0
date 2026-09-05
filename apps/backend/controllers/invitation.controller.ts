import type { Response, Request } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import type { AuthedRequest } from "../middleware/auth";

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["OWNER", "ADMIN", "MEMBER"]).default("MEMBER"),
});

const INVITE_TTL_DAYS = 7;

export async function createInvitation(req: AuthedRequest, res: Response) {
  const body = inviteSchema.parse(req.body);
  const organisationId = req.params.orgId;

  const existingUser = await prisma.user.findUnique({ where: { email: body.email } });
  if (existingUser) {
    const alreadyMember = await prisma.organisationMember.findUnique({
      where: { userId_organisationId: { userId: existingUser.id, organisationId } },
    });
    if (alreadyMember) {
      return res.status(409).json({ error: "This person is already a member" });
    }
  }

  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

  // Revoke any stale pending invite to the same email first, so re-inviting
  // someone doesn't collide with the (org, email, status) unique constraint.
  await prisma.invitation.updateMany({
    where: { organisationId, email: body.email, status: "PENDING" },
    data: { status: "REVOKED" },
  });

  const invitation = await prisma.invitation.create({
    data: { organisationId, email: body.email, role: body.role, invitedById: req.user.id, expiresAt },
  });

  // No email provider wired up yet — hand back the link so the org owner
  // can copy/share it manually. Swap this for a real send once you pick
  // a provider (Resend etc.); the endpoint contract won't need to change.
  const inviteUrl = `${process.env.FRONTEND_URL ?? "http://localhost:3000"}/invitations/${invitation.token}`;

  res.status(201).json({ ...invitation, inviteUrl });
}

export async function listInvitations(req: AuthedRequest, res: Response) {
  const invitations = await prisma.invitation.findMany({
    where: { organisationId: req.params.orgId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
  res.json(invitations);
}

export async function revokeInvitation(req: AuthedRequest, res: Response) {
  await prisma.invitation.update({
    where: { id: req.params.invitationId },
    data: { status: "REVOKED" },
  });
  res.status(204).send();
}

// Not behind requireAuth on the GET (see routes) — someone previewing an
// invite link may not have an account/token yet.
export async function getInvitationByToken(req: Request, res: Response) {
  const invitation = await prisma.invitation.findUnique({
    where: { token: req.params.token },
    include: { organisation: true, invitedBy: true },
  });

  if (!invitation || invitation.status !== "PENDING" || invitation.expiresAt < new Date()) {
    return res.status(404).json({ error: "This invitation is invalid or has expired" });
  }

  res.json({
    organisationName: invitation.organisation.name,
    invitedByName: invitation.invitedBy.name,
    email: invitation.email,
    role: invitation.role,
  });
}

export async function acceptInvitation(req: AuthedRequest, res: Response) {
  const invitation = await prisma.invitation.findUnique({ where: { token: req.params.token } });

  if (!invitation || invitation.status !== "PENDING" || invitation.expiresAt < new Date()) {
    return res.status(404).json({ error: "This invitation is invalid or has expired" });
  }

  if (invitation.email.toLowerCase() !== req.user.email.toLowerCase()) {
    return res.status(403).json({ error: "This invitation was sent to a different email address" });
  }

  const member = await prisma.$transaction(async (tx) => {
    const created = await tx.organisationMember.upsert({
      where: {
        userId_organisationId: { userId: req.user.id, organisationId: invitation.organisationId },
      },
      update: {},
      create: { userId: req.user.id, organisationId: invitation.organisationId, role: invitation.role },
    });
    await tx.invitation.update({ where: { id: invitation.id }, data: { status: "ACCEPTED" } });
    return created;
  });

  res.status(201).json(member);
}
