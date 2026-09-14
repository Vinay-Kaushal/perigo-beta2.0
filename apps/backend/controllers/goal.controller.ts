import type { Request, Response } from "express";
import { z } from "zod";
import type { Goal } from "db/client";
import { prisma } from "../lib/prisma";
import { publicUser } from "../lib/selects";
import { badRequest, conflict, forbidden, notFound, param } from "../lib/http";
import { currentUser } from "../middleware/auth";
import { getMembership, isOrgAdmin } from "../middleware/access";
import { audit } from "../services/audit";
import { computeGoalProgress } from "../domain/goals";

const baseGoalSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  type: z.enum(["BUDGET", "METRIC", "TICKETS_RESOLVED"]).default("METRIC"),
  targetValue: z.number().positive().max(1e12),
  unit: z.string().trim().max(20).nullable().optional(),
  category: z.string().trim().max(60).nullable().optional(),
  ownerId: z.string().uuid().nullable().optional(),
  teamId: z.string().uuid().nullable().optional(),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
});

const createGoalSchema = baseGoalSchema.refine((g) => g.periodEnd > g.periodStart, {
  message: "End date must be after the start date",
  path: ["periodEnd"],
});

async function actualValue(goal: Goal): Promise<number> {
  const period = { gte: goal.periodStart, lte: goal.periodEnd };
  if (goal.type === "BUDGET") {
    const sum = await prisma.expense.aggregate({
      where: { organisationId: goal.organisationId, status: "APPROVED", category: goal.category ?? undefined, date: period },
      _sum: { amount: true },
    });
    return Number(sum._sum.amount ?? 0);
  }
  if (goal.type === "TICKETS_RESOLVED") {
    return prisma.ticket.count({
      where: {
        organisationId: goal.organisationId,
        resolvedAt: period,
        ...(goal.teamId ? { teamId: goal.teamId } : {}),
        ...(goal.ownerId && !goal.teamId ? { assigneeId: goal.ownerId } : {}),
      },
    });
  }
  return Number(goal.currentValue);
}

async function withProgress<T extends Goal>(goal: T) {
  const current = await actualValue(goal);
  const target = Number(goal.targetValue);
  return {
    ...goal,
    targetValue: target,
    currentValue: Number(goal.currentValue),
    progress: computeGoalProgress(goal, current, target),
  };
}

async function validateRefs(orgId: string, body: { ownerId?: string | null; teamId?: string | null }) {
  if (body.ownerId) {
    const m = await prisma.organisationMember.findUnique({ where: { userId_organisationId: { userId: body.ownerId, organisationId: orgId } } });
    if (!m) throw badRequest("Owner must be a member of this organisation");
  }
  if (body.teamId) {
    const t = await prisma.team.findFirst({ where: { id: body.teamId, organisationId: orgId } });
    if (!t) throw badRequest("Team must belong to this organisation");
  }
}

const goalInclude = { owner: publicUser, createdBy: publicUser, team: { select: { id: true, name: true } } } as const;

export async function createGoal(req: Request, res: Response) {
  const user = currentUser(req);
  const membership = getMembership(req);
  const body = createGoalSchema.parse(req.body);

  // Budgets expose org-wide spend, so they're an admin tool.
  if (body.type === "BUDGET" && !isOrgAdmin(membership.role)) throw forbidden("Only owners and admins can create budget goals");
  await validateRefs(membership.organisationId, body);

  const goal = await prisma.goal.create({
    data: { ...body, ownerId: body.ownerId ?? user.id, organisationId: membership.organisationId, createdById: user.id },
    include: goalInclude,
  });
  res.status(201).json(await withProgress(goal));
}

const listQuerySchema = z.object({
  type: z.enum(["BUDGET", "METRIC", "TICKETS_RESOLVED"]).optional(),
  owner: z.union([z.literal("me"), z.string().uuid()]).optional(),
  active: z.enum(["true", "false"]).optional(),
});

export async function listGoals(req: Request, res: Response) {
  const membership = getMembership(req);
  const q = listQuerySchema.parse(req.query);
  const now = new Date();
  const goals = await prisma.goal.findMany({
    where: {
      organisationId: membership.organisationId,
      type: q.type,
      ownerId: q.owner === "me" ? membership.userId : q.owner,
      ...(q.active === "true" ? { periodEnd: { gte: now } } : {}),
    },
    include: goalInclude,
    orderBy: [{ periodEnd: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  res.json(await Promise.all(goals.map(withProgress)));
}

async function loadGoal(req: Request) {
  const membership = getMembership(req);
  const goal = await prisma.goal.findFirst({ where: { id: param(req, "goalId"), organisationId: membership.organisationId } });
  if (!goal) throw notFound("Goal not found");
  const canManage = isOrgAdmin(membership.role) || goal.createdById === membership.userId || goal.ownerId === membership.userId;
  return { goal, membership, canManage };
}

export async function getGoal(req: Request, res: Response) {
  const { goal, canManage } = await loadGoal(req);
  const full = await prisma.goal.findUniqueOrThrow({
    where: { id: goal.id },
    include: { ...goalInclude, checkIns: { include: { user: publicUser }, orderBy: { createdAt: "desc" }, take: 50 } },
  });
  const withP = await withProgress(full);
  res.json({ ...withP, checkIns: full.checkIns.map((c) => ({ ...c, value: Number(c.value) })), canManage });
}

export async function updateGoal(req: Request, res: Response) {
  const { goal, membership, canManage } = await loadGoal(req);
  if (!canManage) throw forbidden("Only the goal's owner, creator, or an admin can edit it");
  const body = baseGoalSchema.omit({ type: true }).partial().parse(req.body);
  if ((body.periodEnd ?? goal.periodEnd) <= (body.periodStart ?? goal.periodStart)) {
    throw badRequest("End date must be after the start date");
  }
  await validateRefs(membership.organisationId, body);
  const updated = await prisma.goal.update({ where: { id: goal.id }, data: body, include: goalInclude });
  res.json(await withProgress(updated));
}

export async function deleteGoal(req: Request, res: Response) {
  const { goal, membership } = await loadGoal(req);
  if (!isOrgAdmin(membership.role) && goal.createdById !== membership.userId) {
    throw forbidden("Only the goal's creator or an admin can delete it");
  }
  await prisma.goal.delete({ where: { id: goal.id } });
  await audit(req, { organisationId: goal.organisationId, action: "goal.deleted", targetType: "goal", targetId: goal.id, metadata: { title: goal.title } });
  res.status(204).send();
}

const checkInSchema = z.object({
  value: z.number().min(0).max(1e12),
  note: z.string().trim().max(1000).optional(),
});

/** METRIC goals only — the others are measured automatically. */
export async function addCheckIn(req: Request, res: Response) {
  const user = currentUser(req);
  const { goal, canManage } = await loadGoal(req);
  if (!canManage) throw forbidden("Only the goal's owner, creator, or an admin can check in");
  if (goal.type !== "METRIC") throw conflict("This goal is tracked automatically");
  const body = checkInSchema.parse(req.body);

  const [checkIn, updated] = await prisma.$transaction([
    prisma.goalCheckIn.create({ data: { goalId: goal.id, userId: user.id, value: body.value, note: body.note }, include: { user: publicUser } }),
    prisma.goal.update({ where: { id: goal.id }, data: { currentValue: body.value }, include: goalInclude }),
  ]);
  res.status(201).json({ checkIn: { ...checkIn, value: Number(checkIn.value) }, goal: await withProgress(updated) });
}

export { withProgress as goalWithProgress };
