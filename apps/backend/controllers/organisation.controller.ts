import type { Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import type { AuthedRequest } from "../middleware/auth";

const createOrgSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric with dashes"),
  description: z.string().max(500).optional(),
});

export async function createOrganisation(req: AuthedRequest, res: Response) {
  const body = createOrgSchema.parse(req.body);

  const org = await prisma.organisation.create({
    data: {
      ...body,
      members: {
        create: { userId: req.user.id, role: "OWNER" },
      },
    },
    include: { members: true },
  });

  res.status(201).json(org);
}

export async function listMyOrganisations(req: AuthedRequest, res: Response) {
  const memberships = await prisma.organisationMember.findMany({
    where: { userId: req.user.id },
    include: { organisation: true },
  });

  res.json(memberships.map((m: { organisation: any; role: any; }) => ({ ...m.organisation, myRole: m.role })));
}

export async function getOrganisation(req: AuthedRequest, res: Response) {
  const org = await prisma.organisation.findUnique({
    where: { id: req.params.orgId },
    include: {
      members: { include: { user: true } },
      teams: true,
      boards: true,
    },
  });
  if (!org) return res.status(404).json({ error: "Organisation not found" });
  res.json(org);
}

const updateOrgSchema = createOrgSchema.partial();

export async function updateOrganisation(req: AuthedRequest, res: Response) {
  const body = updateOrgSchema.parse(req.body);
  const org = await prisma.organisation.update({
    where: { id: req.params.orgId },
    data: body,
  });
  res.json(org);
}

export async function deleteOrganisation(req: AuthedRequest, res: Response) {
  await prisma.organisation.delete({ where: { id: req.params.orgId } });
  res.status(204).send();
}

const addMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["OWNER", "ADMIN", "MEMBER"]).default("MEMBER"),
});

export async function addOrganisationMember(req: AuthedRequest, res: Response) {
  const body = addMemberSchema.parse(req.body);
  const member = await prisma.organisationMember.create({
    data: { organisationId: req.params.orgId, userId: body.userId, role: body.role },
    include: { user: true },
  });
  res.status(201).json(member);
}

const updateRoleSchema = z.object({ role: z.enum(["OWNER", "ADMIN", "MEMBER"]) });

export async function updateMemberRole(req: AuthedRequest, res: Response) {
  const body = updateRoleSchema.parse(req.body);
  const member = await prisma.organisationMember.update({
    where: { id: req.params.memberId },
    data: { role: body.role },
  });
  res.json(member);
}

export async function removeOrganisationMember(req: AuthedRequest, res: Response) {
  await prisma.organisationMember.delete({ where: { id: req.params.memberId } });
  res.status(204).send();
}
