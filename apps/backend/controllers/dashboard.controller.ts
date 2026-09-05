import type { Response } from "express";
import { prisma } from "../lib/prisma";
import type { AuthedRequest } from "../middleware/auth";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function myDashboard(req: AuthedRequest, res: Response) {
  const userId = req.user.id;

  const memberships = await prisma.organisationMember.findMany({
    where: { userId },
    include: { organisation: { include: { _count: { select: { boards: true, members: true } } } } },
  });
  const orgIds = memberships.map((m) => m.organisationId);
  const financialOrgIds = memberships
    .filter((m) => m.role === "OWNER" || m.role === "ADMIN")
    .map((m) => m.organisationId);
  const orgNameById = new Map(memberships.map((m) => [m.organisationId, m.organisation.name]));

  if (orgIds.length === 0) {
    return res.json({
      orgs: [],
      myTasks: { total: 0, overdueCount: 0, dueThisWeekCount: 0 },
      upcomingTasks: [],
      expensesThisMonth: 0,
      recentActivity: [],
    });
  }

  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * DAY_MS);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [myTasksRaw, expenseSum, recentActivity] = await Promise.all([
    prisma.task.findMany({
      where: { assignees: { some: { userId } }, board: { organisationId: { in: orgIds } } },
      select: {
        id: true,
        title: true,
        dueDate: true,
        priority: true,
        completedAt: true,
        board: { select: { id: true, name: true, organisationId: true } },
      },
    }),
    prisma.expense.aggregate({
      // Only orgs where this person is OWNER/ADMIN contribute to the total —
      // a plain MEMBER shouldn't see another org's spend just because
      // they're also a member elsewhere. Members with no financial orgs
      // simply see $0 here, which is correct, not a bug.
      where: { organisationId: { in: financialOrgIds }, date: { gte: startOfMonth, lte: now } },
      _sum: { amount: true },
    }),
    prisma.taskActivity.findMany({
      where: {
        task: { board: { organisationId: { in: orgIds } } },
        OR: [{ userId }, { task: { assignees: { some: { userId } } } }],
      },
      include: {
        user: true,
        task: { select: { id: true, title: true, board: { select: { id: true, name: true, organisationId: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  const openTasks = myTasksRaw.filter((t) => !t.completedAt);
  const overdueTasks = openTasks.filter((t) => t.dueDate && t.dueDate < now);
  const dueThisWeek = openTasks.filter((t) => t.dueDate && t.dueDate >= now && t.dueDate <= weekAhead);

  const overdueByOrg = new Map<string, number>();
  for (const t of overdueTasks) {
    const orgId = t.board.organisationId;
    overdueByOrg.set(orgId, (overdueByOrg.get(orgId) ?? 0) + 1);
  }

  const orgs = memberships.map((m) => ({
    id: m.organisationId,
    name: m.organisation.name,
    slug: m.organisation.slug,
    myRole: m.role,
    boardsCount: m.organisation._count.boards,
    membersCount: m.organisation._count.members,
    overdueCount: overdueByOrg.get(m.organisationId) ?? 0,
  }));

  const upcomingTasks = dueThisWeek
    .sort((a, b) => (a.dueDate!.getTime() ?? 0) - (b.dueDate!.getTime() ?? 0))
    .slice(0, 10)
    .map((t) => ({
      id: t.id,
      title: t.title,
      dueDate: t.dueDate,
      priority: t.priority,
      orgName: orgNameById.get(t.board.organisationId) ?? "",
      boardName: t.board.name,
      boardId: t.board.id,
    }));

  res.json({
    orgs,
    myTasks: { total: openTasks.length, overdueCount: overdueTasks.length, dueThisWeekCount: dueThisWeek.length },
    upcomingTasks,
    expensesThisMonth: Number(expenseSum._sum.amount ?? 0),
    recentActivity: recentActivity.map((a) => ({
      id: a.id,
      type: a.type,
      createdAt: a.createdAt,
      user: a.user,
      task: {
        id: a.task.id,
        title: a.task.title,
        board: { id: a.task.board.id, name: a.task.board.name },
        orgName: orgNameById.get(a.task.board.organisationId) ?? "",
      },
    })),
  });
}
