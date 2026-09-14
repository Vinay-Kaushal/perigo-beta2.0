import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { publicUser } from "../lib/selects";
import { currentUser } from "../middleware/auth";
import { isOrgAdmin } from "../middleware/access";
import { OPEN_STATUSES, isSlaBreached, ticketKey } from "../domain/tickets";
import { goalWithProgress } from "./goal.controller";

const DAY = 24 * 60 * 60 * 1000;
const PRIORITY_RANK = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;

/** The signed-in user's cross-organisation home screen. */
export async function myDashboard(req: Request, res: Response) {
  const user = currentUser(req);
  const now = new Date();
  const in24h = new Date(now.getTime() + DAY);
  const weekAhead = new Date(now.getTime() + 7 * DAY);
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const memberships = await prisma.organisationMember.findMany({
    where: { userId: user.id },
    include: { organisation: { include: { _count: { select: { members: true } } } } },
    orderBy: { joinedAt: "asc" },
  });
  const orgIds = memberships.map((m) => m.organisationId);
  const adminOrgIds = memberships.filter((m) => isOrgAdmin(m.role)).map((m) => m.organisationId);
  const orgById = new Map(memberships.map((m) => [m.organisationId, m.organisation]));
  const openTicket = { organisationId: { in: orgIds }, status: { in: OPEN_STATUSES } };
  // Members only see tasks on boards they belong to.
  const taskScope = {
    board: {
      OR: [
        { organisationId: { in: adminOrgIds } },
        { members: { some: { organisationMember: { userId: user.id } } } },
      ],
    },
  };

  const [
    assignedTickets,
    requestedOpen,
    openByOrg,
    myTasks,
    joinRequests,
    pendingExpenses,
    myExpenseSum,
    unreadNotifications,
    goals,
    myJoinRequests,
  ] = await Promise.all([
    prisma.ticket.findMany({
      where: { ...openTicket, assigneeId: user.id },
      include: { requester: publicUser },
      take: 200,
    }),
    prisma.ticket.count({ where: { ...openTicket, requesterId: user.id } }),
    prisma.ticket.groupBy({ by: ["organisationId"], where: openTicket, _count: { _all: true } }),
    prisma.task.findMany({
      where: { assignees: { some: { userId: user.id } }, completedAt: null, ...taskScope },
      select: { id: true, title: true, dueDate: true, priority: true, board: { select: { id: true, name: true, organisationId: true } } },
      take: 500,
    }),
    prisma.invitation.groupBy({
      by: ["organisationId"],
      where: { organisationId: { in: adminOrgIds }, status: "AWAITING_APPROVAL" },
      _count: { _all: true },
    }),
    prisma.expense.groupBy({
      by: ["organisationId"],
      where: { organisationId: { in: adminOrgIds }, status: "PENDING", createdById: { not: user.id } },
      _count: { _all: true },
    }),
    prisma.expense.aggregate({
      where: { createdById: user.id, status: "APPROVED", date: { gte: startOfMonth } },
      _sum: { amount: true },
    }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    prisma.goal.findMany({
      where: { organisationId: { in: orgIds }, ownerId: user.id, periodEnd: { gte: now } },
      orderBy: { periodEnd: "asc" },
      take: 6,
    }),
    prisma.invitation.findMany({
      where: { acceptedById: user.id, status: "AWAITING_APPROVAL" },
      include: { organisation: { select: { id: true, name: true } } },
    }),
  ]);

  const count = <T extends { organisationId: string; _count: { _all: number } }>(rows: T[]) =>
    new Map(rows.map((r) => [r.organisationId, r._count._all]));
  const openByOrgMap = count(openByOrg);
  const joinMap = count(joinRequests);
  const expenseMap = count(pendingExpenses);

  const sortedTickets = [...assignedTickets].sort(
    (a, b) =>
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity)
  );

  const overdueTasks = myTasks.filter((t) => t.dueDate && t.dueDate < now);
  const dueThisWeek = myTasks.filter((t) => t.dueDate && t.dueDate >= now && t.dueDate <= weekAhead);

  res.json({
    orgs: memberships.map((m) => ({
      id: m.organisationId,
      name: m.organisation.name,
      slug: m.organisation.slug,
      myRole: m.role,
      membersCount: m.organisation._count.members,
      openTickets: openByOrgMap.get(m.organisationId) ?? 0,
      pendingApprovals: isOrgAdmin(m.role) ? (joinMap.get(m.organisationId) ?? 0) + (expenseMap.get(m.organisationId) ?? 0) : 0,
    })),
    tickets: {
      assignedOpen: assignedTickets.length,
      breached: assignedTickets.filter((t) => isSlaBreached(t, now)).length,
      dueSoon: assignedTickets.filter((t) => t.dueAt && t.dueAt >= now && t.dueAt <= in24h).length,
      requestedOpen,
    },
    myTickets: sortedTickets.slice(0, 8).map((t) => {
      const org = orgById.get(t.organisationId)!;
      return {
        id: t.id,
        number: t.number,
        key: ticketKey(org.ticketPrefix, t.number),
        title: t.title,
        status: t.status,
        priority: t.priority,
        dueAt: t.dueAt,
        slaBreached: isSlaBreached(t, now),
        requester: t.requester,
        organisation: { id: org.id, name: org.name },
      };
    }),
    tasks: { open: myTasks.length, overdue: overdueTasks.length, dueThisWeek: dueThisWeek.length },
    upcomingTasks: [...overdueTasks, ...dueThisWeek]
      .sort((a, b) => a.dueDate!.getTime() - b.dueDate!.getTime())
      .slice(0, 8)
      .map((t) => ({
        id: t.id,
        title: t.title,
        dueDate: t.dueDate,
        priority: t.priority,
        overdue: t.dueDate! < now,
        board: { id: t.board.id, name: t.board.name },
        organisation: { id: t.board.organisationId, name: orgById.get(t.board.organisationId)?.name ?? "" },
      })),
    approvals: {
      joinRequests: joinRequests.reduce((n, r) => n + r._count._all, 0),
      expenses: pendingExpenses.reduce((n, r) => n + r._count._all, 0),
    },
    myExpensesThisMonth: Number(myExpenseSum._sum.amount ?? 0),
    unreadNotifications,
    goals: await Promise.all(goals.map(async (g) => ({ ...(await goalWithProgress(g)), organisation: { id: g.organisationId, name: orgById.get(g.organisationId)?.name ?? "" } }))),
    pendingJoinRequests: myJoinRequests.map((r) => ({ id: r.id, organisation: r.organisation, acceptedAt: r.acceptedAt })),
  });
}
