import type { Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import type { AuthedRequest } from "../middleware/auth";

const goalSchema = z.object({
  title: z.string().min(1).max(200),
  targetAmount: z.number().positive(),
  category: z.string().max(60).nullable().optional(),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
});

async function withProgress(orgId: string, goal: {
  id: string; targetAmount: unknown; category: string | null; periodStart: Date; periodEnd: Date;
}) {
  const sum = await prisma.expense.aggregate({
    where: {
      organisationId: orgId,
      category: goal.category ?? undefined,
      date: { gte: goal.periodStart, lte: goal.periodEnd },
    },
    _sum: { amount: true },
  });
  const spent = Number(sum._sum.amount ?? 0);
  const target = Number(goal.targetAmount);
  return { spent, target, percent: target > 0 ? Math.min(100, (spent / target) * 100) : 0 };
}

export async function createGoal(req: AuthedRequest, res: Response) {
  const body = goalSchema.parse(req.body);
  const goal = await prisma.goal.create({
    data: { ...body, organisationId: req.params.orgId, createdById: req.user.id },
  });
  res.status(201).json({ ...goal, progress: await withProgress(req.params.orgId, goal) });
}

export async function listGoals(req: AuthedRequest, res: Response) {
  const goals = await prisma.goal.findMany({
    where: { organisationId: req.params.orgId },
    orderBy: { periodEnd: "desc" },
  });
  const withProgressList = await Promise.all(
    goals.map(async (g) => ({ ...g, progress: await withProgress(req.params.orgId, g) }))
  );
  res.json(withProgressList);
}

export async function deleteGoal(req: AuthedRequest, res: Response) {
  await prisma.goal.delete({ where: { id: req.params.goalId } });
  res.status(204).send();
}
