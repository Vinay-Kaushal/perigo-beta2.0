import type { Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import type { AuthedRequest } from "../middleware/auth";

const expenseSchema = z.object({
  title: z.string().min(1).max(200),
  amount: z.number().positive(),
  currency: z.string().min(1).max(8).default("USD"),
  category: z.string().min(1).max(60),
  date: z.coerce.date(),
  notes: z.string().max(2000).optional(),
});

export async function createExpense(req: AuthedRequest, res: Response) {
  const body = expenseSchema.parse(req.body);
  const expense = await prisma.expense.create({
    data: { ...body, organisationId: req.params.orgId, createdById: req.user.id },
    include: { createdBy: true },
  });
  res.status(201).json(expense);
}

const listQuerySchema = z.object({
  category: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export async function listExpenses(req: AuthedRequest, res: Response) {
  const query = listQuerySchema.parse(req.query);

  const expenses = await prisma.expense.findMany({
    where: {
      organisationId: req.params.orgId,
      category: query.category,
      date: query.from || query.to ? { gte: query.from, lte: query.to } : undefined,
    },
    include: { createdBy: true },
    orderBy: { date: "desc" },
  });
  res.json(expenses);
}

export async function updateExpense(req: AuthedRequest, res: Response) {
  const body = expenseSchema.partial().parse(req.body);
  const expense = await prisma.expense.update({
    where: { id: req.params.expenseId },
    data: body,
    include: { createdBy: true },
  });
  res.json(expense);
}

export async function deleteExpense(req: AuthedRequest, res: Response) {
  await prisma.expense.delete({ where: { id: req.params.expenseId } });
  res.status(204).send();
}

/** Totals by category + grand total — powers the dashboard's breakdown bar. */
export async function expenseSummary(req: AuthedRequest, res: Response) {
  const grouped = await prisma.expense.groupBy({
    by: ["category"],
    where: { organisationId: req.params.orgId },
    _sum: { amount: true },
    orderBy: { _sum: { amount: "desc" } },
  });

  const byCategory = grouped.map((g) => ({ category: g.category, total: g._sum.amount ?? 0 }));
  const total = byCategory.reduce((sum, c) => sum + Number(c.total), 0);

  res.json({ total, byCategory });
}
