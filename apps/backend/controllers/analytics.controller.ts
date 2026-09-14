import type { Request, Response } from "express";
import { z } from "zod";
import type { OrganisationMember, Prisma } from "db/client";
import { prisma } from "../lib/prisma";
import { publicUser, publicUserSelect } from "../lib/selects";
import { getMembership, isOrgAdmin } from "../middleware/access";
import { OPEN_STATUSES, ticketKey } from "../domain/tickets";
import { goalWithProgress } from "./goal.controller";

const DAY = 24 * 60 * 60 * 1000;

/** Members only see tasks on boards they belong to; admins see all boards. */
function visibleBoards(m: OrganisationMember): Prisma.BoardWhereInput {
  return isOrgAdmin(m.role)
    ? { organisationId: m.organisationId }
    : { organisationId: m.organisationId, members: { some: { organisationMemberId: m.id } } };
}

export async function overview(req: Request, res: Response) {
  const membership = getMembership(req);
  const orgId = membership.organisationId;
  const admin = isOrgAdmin(membership.role);
  const now = new Date();
  const since30 = new Date(now.getTime() - 30 * DAY);
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const openTickets = { organisationId: orgId, status: { in: OPEN_STATUSES } };
  const boardScope = visibleBoards(membership);

  const [
    org,
    memberCount,
    teamCount,
    boardCount,
    ticketsOpen,
    ticketsBreached,
    ticketsUnassigned,
    ticketsResolved30,
    tasks,
    ticketLoad,
    taskLoad,
    members,
    goals,
  ] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({ where: { id: orgId }, select: { currency: true } }),
    prisma.organisationMember.count({ where: { organisationId: orgId } }),
    prisma.team.count({ where: { organisationId: orgId } }),
    prisma.board.count({ where: boardScope }),
    prisma.ticket.count({ where: openTickets }),
    prisma.ticket.count({ where: { ...openTickets, dueAt: { lt: now } } }),
    prisma.ticket.count({ where: { ...openTickets, assigneeId: null } }),
    prisma.ticket.count({ where: { organisationId: orgId, resolvedAt: { gte: since30 } } }),
    prisma.task.findMany({ where: { board: boardScope }, select: { completedAt: true, dueDate: true } }),
    prisma.ticket.groupBy({ by: ["assigneeId"], where: { ...openTickets, assigneeId: { not: null } }, _count: { _all: true } }),
    prisma.taskAssignee.groupBy({
      by: ["userId"],
      where: { task: { completedAt: null, board: { organisationId: orgId } } },
      _count: { _all: true },
    }),
    prisma.organisationMember.findMany({ where: { organisationId: orgId }, include: { user: publicUser } }),
    prisma.goal.findMany({ where: { organisationId: orgId, periodEnd: { gte: new Date(now.getTime() - 7 * DAY) } }, take: 50 }),
  ]);

  const goalProgress = await Promise.all(goals.map(goalWithProgress));
  const goalHealth: Record<string, number> = {};
  for (const g of goalProgress) goalHealth[g.progress.health] = (goalHealth[g.progress.health] ?? 0) + 1;

  let finance = null;
  if (admin) {
    const [monthSum, pending, joinRequests] = await Promise.all([
      prisma.expense.aggregate({ where: { organisationId: orgId, status: "APPROVED", date: { gte: startOfMonth } }, _sum: { amount: true } }),
      prisma.expense.aggregate({ where: { organisationId: orgId, status: "PENDING" }, _count: { _all: true }, _sum: { amount: true } }),
      prisma.invitation.count({ where: { organisationId: orgId, status: "AWAITING_APPROVAL" } }),
    ]);
    finance = {
      currency: org.currency,
      approvedThisMonth: Number(monthSum._sum.amount ?? 0),
      pendingExpenses: pending._count._all,
      pendingAmount: Number(pending._sum.amount ?? 0),
      pendingJoinRequests: joinRequests,
    };
  }

  const ticketsBy = new Map(ticketLoad.map((t) => [t.assigneeId, t._count._all]));
  const tasksBy = new Map(taskLoad.map((t) => [t.userId, t._count._all]));

  res.json({
    members: memberCount,
    teams: teamCount,
    boards: boardCount,
    tickets: { open: ticketsOpen, breached: ticketsBreached, unassigned: ticketsUnassigned, resolvedLast30Days: ticketsResolved30 },
    tasks: {
      total: tasks.length,
      completed: tasks.filter((t) => t.completedAt).length,
      overdue: tasks.filter((t) => !t.completedAt && t.dueDate && t.dueDate < now).length,
    },
    goals: { total: goalProgress.length, byHealth: goalHealth, items: goalProgress.slice(0, 6) },
    finance,
    workload: members
      .map((m) => ({ user: m.user, role: m.role, openTickets: ticketsBy.get(m.userId) ?? 0, openTasks: tasksBy.get(m.userId) ?? 0 }))
      .sort((a, b) => b.openTickets + b.openTasks - (a.openTickets + a.openTasks)),
  });
}

const activityQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) });

/** One feed across the service desk and boards, newest first. */
export async function activity(req: Request, res: Response) {
  const membership = getMembership(req);
  const { limit } = activityQuerySchema.parse(req.query);

  const [org, ticketEvents, taskEvents] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({ where: { id: membership.organisationId }, select: { ticketPrefix: true } }),
    prisma.ticketEvent.findMany({
      where: { ticket: { organisationId: membership.organisationId } },
      include: { actor: publicUser, ticket: { select: { id: true, number: true, title: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.taskActivity.findMany({
      where: { task: { board: visibleBoards(membership) } },
      include: { user: publicUser, task: { select: { id: true, title: true, board: { select: { id: true, name: true } } } } },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
  ]);

  const items = [
    ...ticketEvents.map((e) => ({
      id: e.id,
      source: "ticket" as const,
      type: e.type,
      createdAt: e.createdAt,
      actor: e.actor,
      metadata: e.metadata,
      subject: { id: e.ticket.id, key: ticketKey(org.ticketPrefix, e.ticket.number), number: e.ticket.number, title: e.ticket.title },
    })),
    ...taskEvents.map((a) => ({
      id: a.id,
      source: "task" as const,
      type: a.type,
      createdAt: a.createdAt,
      actor: a.user,
      metadata: a.metadata,
      subject: { id: a.task.id, title: a.task.title, board: a.task.board },
    })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);

  res.json(items);
}

const calendarQuerySchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });

export async function calendar(req: Request, res: Response) {
  const membership = getMembership(req);
  const { month } = calendarQuerySchema.parse(req.query);
  const [year, m] = month.split("-").map(Number) as [number, number];
  const start = new Date(Date.UTC(year, m - 1, 1));
  const end = new Date(Date.UTC(year, m, 1));

  const [org, tasks, tickets] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({ where: { id: membership.organisationId }, select: { ticketPrefix: true } }),
    prisma.task.findMany({
      where: { board: visibleBoards(membership), dueDate: { gte: start, lt: end } },
      select: { id: true, title: true, priority: true, dueDate: true, completedAt: true, board: { select: { id: true, name: true } } },
      orderBy: { dueDate: "asc" },
    }),
    prisma.ticket.findMany({
      where: { organisationId: membership.organisationId, status: { in: OPEN_STATUSES }, dueAt: { gte: start, lt: end } },
      select: { id: true, number: true, title: true, priority: true, dueAt: true, assignee: { select: publicUserSelect } },
      orderBy: { dueAt: "asc" },
    }),
  ]);

  res.json({
    tasks,
    tickets: tickets.map((t) => ({ ...t, key: ticketKey(org.ticketPrefix, t.number) })),
  });
}

const reportQuerySchema = z
  .object({ from: z.coerce.date(), to: z.coerce.date() })
  .refine((q) => q.to >= q.from, "`to` must be on or after `from`")
  .refine((q) => q.to.getTime() - q.from.getTime() <= 366 * DAY, "Reports can cover at most one year");

/** Owners/admins only (includes financials). Streamed straight to the response. */
export async function reportPdf(req: Request, res: Response) {
  const membership = getMembership(req);
  const { from, to } = reportQuerySchema.parse(req.query);
  const orgId = membership.organisationId;

  const [org, tickets, expenses, memberCount] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({ where: { id: orgId } }),
    prisma.ticket.findMany({
      where: { organisationId: orgId, createdAt: { gte: from, lte: to } },
      include: { assignee: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
      take: 2000,
    }),
    prisma.expense.findMany({
      where: { organisationId: orgId, status: "APPROVED", date: { gte: from, lte: to } },
      orderBy: { date: "asc" },
      take: 2000,
    }),
    prisma.organisationMember.count({ where: { organisationId: orgId } }),
  ]);

  const resolved = tickets.filter((t) => t.resolvedAt).length;
  const totalExpense = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const day = (d: Date) => d.toISOString().slice(0, 10);

  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({ margin: 50 });
  res.setHeader("Content-Type", "application/pdf");
  // slug is constrained to [a-z0-9-], so it's safe inside the header.
  res.setHeader("Content-Disposition", `attachment; filename="${org.slug}-report-${day(from)}_${day(to)}.pdf"`);
  doc.pipe(res);

  doc.fontSize(18).text(`${org.name} — Operations report`);
  doc.fontSize(10).fillColor("#666").text(`${day(from)} to ${day(to)}`).moveDown(1.5);

  doc.fillColor("#000").fontSize(13).text("Summary").moveDown(0.5);
  doc
    .fontSize(10)
    .text(`Tickets opened: ${tickets.length}`)
    .text(`Tickets resolved: ${resolved}`)
    .text(`Members: ${memberCount}`)
    .text(`Approved expenses: ${org.currency} ${totalExpense.toFixed(2)}`)
    .moveDown(1.5);

  doc.fontSize(13).text("Tickets").moveDown(0.5);
  if (tickets.length === 0) doc.fontSize(10).fillColor("#666").text("No tickets opened in this period.").fillColor("#000");
  for (const t of tickets) {
    doc
      .fontSize(10)
      .text(`${ticketKey(org.ticketPrefix, t.number)}  ${t.title}`)
      .fontSize(8)
      .fillColor("#666")
      .text(`   ${t.status} · ${t.priority} · ${t.assignee?.name ?? "Unassigned"} · opened ${day(t.createdAt)}`)
      .fillColor("#000");
  }
  doc.moveDown(1.5);

  doc.fontSize(13).text("Approved expenses").moveDown(0.5);
  if (expenses.length === 0) doc.fontSize(10).fillColor("#666").text("No approved expenses in this period.").fillColor("#000");
  for (const e of expenses) {
    doc.fontSize(10).text(`${day(e.date)}  ${e.title} — ${e.currency} ${Number(e.amount).toFixed(2)} (${e.category})`);
  }
  doc.end();
}
