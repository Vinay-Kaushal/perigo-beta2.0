import type { Request, Response } from "express";
import { z } from "zod";
import type { Expense, Prisma } from "db/client";
import { prisma } from "../lib/prisma";
import { publicUser } from "../lib/selects";
import { badRequest, conflict, forbidden, notFound, param } from "../lib/http";
import { currentUser } from "../middleware/auth";
import { getMembership, isOrgAdmin } from "../middleware/access";
import { audit } from "../services/audit";
import { notify, orgAdminIds } from "../services/notifications";

const money = (n: number) => Math.round(n * 100) / 100;

const amountSchema = z
  .number()
  .positive("Amount must be greater than zero")
  .max(9_999_999_999.99)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, "At most 2 decimal places");

const expenseSchema = z.object({
  title: z.string().trim().min(1).max(200),
  amount: amountSchema,
  category: z.string().trim().min(1).max(60),
  date: z.coerce.date(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

const include = { createdBy: publicUser, reviewedBy: publicUser } satisfies Prisma.ExpenseInclude;

function serialise(e: Expense & Record<string, unknown>) {
  return { ...e, amount: Number(e.amount) };
}

async function loadExpense(req: Request) {
  const membership = getMembership(req);
  const expense = await prisma.expense.findFirst({
    where: { id: param(req, "expenseId"), organisationId: membership.organisationId },
  });
  // Members can't see other people's expenses — respond as if it doesn't exist.
  if (!expense || (!isOrgAdmin(membership.role) && expense.createdById !== membership.userId)) {
    throw notFound("Expense not found");
  }
  return { expense, membership };
}

export async function createExpense(req: Request, res: Response) {
  const user = currentUser(req);
  const membership = getMembership(req);
  const body = expenseSchema.parse(req.body);
  if (body.date.getTime() > Date.now() + 24 * 60 * 60 * 1000) throw badRequest("Expense date can't be in the future");

  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: membership.organisationId } });
  const expense = await prisma.expense.create({
    data: { ...body, currency: org.currency, organisationId: org.id, createdById: user.id, status: "PENDING" },
    include,
  });

  await notify(await orgAdminIds(org.id), {
    type: "EXPENSE_SUBMITTED",
    title: `${user.name} submitted an expense for approval`,
    body: `${body.title} — ${org.currency} ${body.amount.toFixed(2)}`,
    link: `/orgs/${org.id}/expenses?tab=approvals`,
    organisationId: org.id,
    actorId: user.id,
  });
  res.status(201).json(serialise(expense));
}

const listQuerySchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  category: z.string().max(60).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  mine: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/** Owners/admins see the whole org; members see only what they submitted. */
export async function listExpenses(req: Request, res: Response) {
  const membership = getMembership(req);
  const q = listQuerySchema.parse(req.query);
  const onlyMine = !isOrgAdmin(membership.role) || q.mine === "true";

  const where: Prisma.ExpenseWhereInput = {
    organisationId: membership.organisationId,
    createdById: onlyMine ? membership.userId : undefined,
    status: q.status,
    category: q.category,
    date: q.from || q.to ? { gte: q.from, lte: q.to } : undefined,
  };
  const [total, items] = await Promise.all([
    prisma.expense.count({ where }),
    prisma.expense.findMany({
      where,
      include,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  res.json({ items: items.map(serialise), total, page: q.page, pageSize: q.pageSize });
}

/** Submitters can edit until approved; editing a rejected expense resubmits it. */
export async function updateExpense(req: Request, res: Response) {
  const { expense, membership } = await loadExpense(req);
  const body = expenseSchema.partial().parse(req.body);

  if (expense.status === "APPROVED") throw conflict("Approved expenses can't be edited");
  if (expense.createdById !== membership.userId && !isOrgAdmin(membership.role)) throw forbidden();

  const updated = await prisma.expense.update({
    where: { id: expense.id },
    data: {
      ...body,
      ...(expense.status === "REJECTED" ? { status: "PENDING", reviewedById: null, reviewedAt: null, reviewNote: null } : {}),
    },
    include,
  });
  res.json(serialise(updated));
}

export async function deleteExpense(req: Request, res: Response) {
  const { expense, membership } = await loadExpense(req);
  const admin = isOrgAdmin(membership.role);
  if (!admin && expense.status === "APPROVED") throw conflict("Approved expenses can only be removed by an admin");

  await prisma.expense.delete({ where: { id: expense.id } });
  if (expense.status === "APPROVED") {
    await audit(req, { organisationId: expense.organisationId, action: "expense.deleted", targetType: "expense", targetId: expense.id, metadata: { title: expense.title, amount: Number(expense.amount) } });
  }
  res.status(204).send();
}

const reviewSchema = z.object({ note: z.string().trim().max(1000).optional() });

async function review(req: Request, res: Response, decision: "APPROVED" | "REJECTED") {
  const user = currentUser(req);
  const { expense, membership } = await loadExpense(req);
  const { note } = reviewSchema.parse(req.body ?? {});

  if (expense.status !== "PENDING") throw conflict(`This expense is already ${expense.status.toLowerCase()}`);
  // Separation of duties: admins can't sign off their own spend; owners are the final backstop.
  if (expense.createdById === user.id && membership.role !== "OWNER") {
    throw forbidden("You can't review your own expense");
  }
  if (decision === "REJECTED" && !note) throw badRequest("Give a reason when rejecting an expense");

  const updated = await prisma.expense.update({
    where: { id: expense.id },
    data: { status: decision, reviewedById: user.id, reviewedAt: new Date(), reviewNote: note ?? null },
    include,
  });

  await audit(req, {
    organisationId: expense.organisationId,
    action: decision === "APPROVED" ? "expense.approved" : "expense.rejected",
    targetType: "expense",
    targetId: expense.id,
    metadata: { title: expense.title, amount: Number(expense.amount), note },
  });
  await notify([expense.createdById], {
    type: decision === "APPROVED" ? "EXPENSE_APPROVED" : "EXPENSE_REJECTED",
    title: `${user.name} ${decision === "APPROVED" ? "approved" : "rejected"} your expense "${expense.title}"`,
    body: note ?? null,
    link: `/orgs/${expense.organisationId}/expenses`,
    organisationId: expense.organisationId,
    actorId: user.id,
  });
  res.json(serialise(updated));
}

export const approveExpense = (req: Request, res: Response) => review(req, res, "APPROVED");
export const rejectExpense = (req: Request, res: Response) => review(req, res, "REJECTED");

const summaryQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/** Approved spend by category and month, plus the pending queue. Scoped like listExpenses. */
export async function expenseSummary(req: Request, res: Response) {
  const membership = getMembership(req);
  const q = summaryQuerySchema.parse(req.query);
  const admin = isOrgAdmin(membership.role);
  const scope: Prisma.ExpenseWhereInput = {
    organisationId: membership.organisationId,
    ...(admin ? {} : { createdById: membership.userId }),
  };

  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const sixMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
  const range = q.from || q.to ? { gte: q.from, lte: q.to } : undefined;

  const [org, byCategory, pending, thisMonth, recent] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({ where: { id: membership.organisationId }, select: { currency: true } }),
    prisma.expense.groupBy({
      by: ["category"],
      where: { ...scope, status: "APPROVED", date: range },
      _sum: { amount: true },
      _count: { _all: true },
      orderBy: { _sum: { amount: "desc" } },
    }),
    prisma.expense.aggregate({ where: { ...scope, status: "PENDING" }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.expense.aggregate({ where: { ...scope, status: "APPROVED", date: { gte: startOfMonth } }, _sum: { amount: true } }),
    prisma.expense.findMany({
      where: { ...scope, status: "APPROVED", date: { gte: sixMonthsAgo } },
      select: { amount: true, date: true },
    }),
  ]);

  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + i, 1));
    return { month: d.toISOString().slice(0, 7), total: 0 };
  });
  const monthIndex = new Map(months.map((m, i) => [m.month, i]));
  for (const e of recent) {
    const i = monthIndex.get(e.date.toISOString().slice(0, 7));
    if (i !== undefined) months[i]!.total = money(months[i]!.total + Number(e.amount));
  }

  const categories = byCategory.map((g) => ({ category: g.category, total: Number(g._sum.amount ?? 0), count: g._count._all }));
  res.json({
    scope: admin ? "organisation" : "mine",
    currency: org.currency,
    total: money(categories.reduce((sum, c) => sum + c.total, 0)),
    thisMonth: Number(thisMonth._sum.amount ?? 0),
    pending: { count: pending._count._all, total: Number(pending._sum.amount ?? 0) },
    byCategory: categories,
    byMonth: months,
  });
}

export async function expenseCategories(req: Request, res: Response) {
  const membership = getMembership(req);
  const rows = await prisma.expense.findMany({
    where: { organisationId: membership.organisationId },
    distinct: ["category"],
    select: { category: true },
    orderBy: { category: "asc" },
    take: 100,
  });
  res.json(rows.map((r) => r.category));
}
