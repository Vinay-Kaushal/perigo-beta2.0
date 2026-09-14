import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { publicUser } from "../lib/selects";
import { badRequest, notFound, param } from "../lib/http";
import { publishOrgEvent } from "../lib/eventBus";
import { getMembership } from "../middleware/access";
import { audit } from "../services/audit";

const teamSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
});

async function loadTeam(req: Request) {
  const membership = getMembership(req);
  const team = await prisma.team.findFirst({
    where: { id: param(req, "teamId"), organisationId: membership.organisationId },
  });
  if (!team) throw notFound("Team not found");
  return team;
}

export async function createTeam(req: Request, res: Response) {
  const membership = getMembership(req);
  const body = teamSchema.parse(req.body);
  const team = await prisma.team.create({
    data: { ...body, organisationId: membership.organisationId },
  });
  await audit(req, { organisationId: team.organisationId, action: "team.created", targetType: "team", targetId: team.id, metadata: { name: team.name } });
  await publishOrgEvent(team.organisationId, "TEAM_CHANGED", req.user!.id, { id: team.id });
  res.status(201).json(team);
}

export async function listTeams(req: Request, res: Response) {
  const membership = getMembership(req);
  const teams = await prisma.team.findMany({
    where: { organisationId: membership.organisationId },
    include: {
      members: { include: { organisationMember: { include: { user: publicUser } } } },
      _count: { select: { tickets: { where: { status: { in: ["NEW", "OPEN", "IN_PROGRESS", "ON_HOLD"] } } } } },
    },
    orderBy: { name: "asc" },
  });
  res.json(
    teams.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      organisationId: t.organisationId,
      createdAt: t.createdAt,
      openTickets: t._count.tickets,
      members: t.members.map((m) => ({ ...m.organisationMember.user, role: m.organisationMember.role })),
    }))
  );
}

export async function updateTeam(req: Request, res: Response) {
  const team = await loadTeam(req);
  const body = teamSchema.partial().parse(req.body);
  const updated = await prisma.team.update({ where: { id: team.id }, data: body });
  await publishOrgEvent(team.organisationId, "TEAM_CHANGED", req.user!.id, { id: team.id });
  res.json(updated);
}

export async function deleteTeam(req: Request, res: Response) {
  const team = await loadTeam(req);
  await prisma.team.delete({ where: { id: team.id } });
  await audit(req, { organisationId: team.organisationId, action: "team.deleted", targetType: "team", targetId: team.id, metadata: { name: team.name } });
  await publishOrgEvent(team.organisationId, "TEAM_CHANGED", req.user!.id, { id: team.id });
  res.status(204).send();
}

const addMemberSchema = z.object({ userId: z.string().uuid() });

export async function addTeamMember(req: Request, res: Response) {
  const team = await loadTeam(req);
  const { userId } = addMemberSchema.parse(req.body);

  const orgMember = await prisma.organisationMember.findUnique({
    where: { userId_organisationId: { userId, organisationId: team.organisationId } },
  });
  if (!orgMember) throw badRequest("That user is not a member of this organisation");

  await prisma.teamMember.upsert({
    where: { teamId_organisationMemberId: { teamId: team.id, organisationMemberId: orgMember.id } },
    update: {},
    create: { teamId: team.id, organisationMemberId: orgMember.id },
  });
  await audit(req, { organisationId: team.organisationId, action: "team.member_added", targetType: "user", targetId: userId, metadata: { teamId: team.id } });
  await publishOrgEvent(team.organisationId, "TEAM_CHANGED", req.user!.id, { id: team.id });
  res.status(201).json({ teamId: team.id, userId });
}

export async function removeTeamMember(req: Request, res: Response) {
  const team = await loadTeam(req);
  const userId = param(req, "userId");
  const result = await prisma.teamMember.deleteMany({
    where: { teamId: team.id, organisationMember: { userId, organisationId: team.organisationId } },
  });
  if (result.count === 0) throw notFound("That user is not in this team");
  await audit(req, { organisationId: team.organisationId, action: "team.member_removed", targetType: "user", targetId: userId, metadata: { teamId: team.id } });
  await publishOrgEvent(team.organisationId, "TEAM_CHANGED", req.user!.id, { id: team.id });
  res.status(204).send();
}
