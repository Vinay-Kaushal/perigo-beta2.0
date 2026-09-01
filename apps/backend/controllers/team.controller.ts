import { Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AuthedRequest } from "../middleware/auth";

const teamSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
});

export async function createTeam(req: AuthedRequest, res: Response) {
  const body = teamSchema.parse(req.body);
  const orgMembership = (req as any).membership;

  const team = await prisma.team.create({
    data: {
      ...body,
      organisationId: req.params.orgId,
      members: { create: { organisationMemberId: orgMembership.id } },
    },
    include: { members: true },
  });

  res.status(201).json(team);
}

export async function listTeams(req: AuthedRequest, res: Response) {
  const teams = await prisma.team.findMany({
    where: { organisationId: req.params.orgId },
    include: { _count: { select: { members: true, boards: true } } },
  });
  res.json(teams);
}

export async function getTeam(req: AuthedRequest, res: Response) {
  const team = await prisma.team.findUnique({
    where: { id: req.params.teamId },
    include: { members: { include: { organisationMember: { include: { user: true } } } }, boards: true },
  });
  if (!team) return res.status(404).json({ error: "Team not found" });
  res.json(team);
}

export async function updateTeam(req: AuthedRequest, res: Response) {
  const body = teamSchema.partial().parse(req.body);
  const team = await prisma.team.update({ where: { id: req.params.teamId }, data: body });
  res.json(team);
}

export async function deleteTeam(req: AuthedRequest, res: Response) {
  await prisma.team.delete({ where: { id: req.params.teamId } });
  res.status(204).send();
}

const addTeamMemberSchema = z.object({ organisationMemberId: z.string().uuid() });

export async function addTeamMember(req: AuthedRequest, res: Response) {
  const body = addTeamMemberSchema.parse(req.body);
  const member = await prisma.teamMember.create({
    data: { teamId: req.params.teamId, organisationMemberId: body.organisationMemberId },
    include: { organisationMember: { include: { user: true } } },
  });
  res.status(201).json(member);
}

export async function removeTeamMember(req: AuthedRequest, res: Response) {
  await prisma.teamMember.delete({ where: { id: req.params.memberId } });
  res.status(204).send();
}
