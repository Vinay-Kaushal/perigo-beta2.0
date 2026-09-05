import type { Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import type { AuthedRequest } from "../middleware/auth";

export async function overview(req: AuthedRequest, res: Response) {
  const organisationId = req.params.orgId;

  const [totalBoards, totalMembers, tasks, statusGroups, priorityGroups] = await Promise.all([
    prisma.board.count({ where: { organisationId } }),
    prisma.organisationMember.count({ where: { organisationId } }),
    prisma.task.findMany({
      where: { board: { organisationId } },
      select: { id: true, completedAt: true, dueDate: true },
    }),
    prisma.task.groupBy({
      by: ["statusId"],
      where: { board: { organisationId } },
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ["priority"],
      where: { board: { organisationId } },
      _count: { _all: true },
    }),
  ]);

  const statuses = await prisma.taskStatus.findMany({
    where: { id: { in: statusGroups.map((g) => g.statusId) } },
  });
  const tasksByStatus = statusGroups.map((g) => ({
    statusId: g.statusId,
    name: statuses.find((s) => s.id === g.statusId)?.name ?? "Unknown",
    type: statuses.find((s) => s.id === g.statusId)?.type,
    count: g._count._all,
  }));
  const tasksByPriority = priorityGroups.map((g) => ({ priority: g.priority, count: g._count._all }));

  const now = new Date();
  const overdueCount = tasks.filter((t) => t.dueDate && t.dueDate < now && !t.completedAt).length;
  const completedCount = tasks.filter((t) => t.completedAt).length;

  const members = await prisma.organisationMember.findMany({
    where: { organisationId },
    include: { user: true },
  });
  const memberWorkload = await Promise.all(
    members.map(async (m) => {
      const [assigned, completed] = await Promise.all([
        prisma.taskAssignee.count({
          where: { userId: m.userId, task: { board: { organisationId } } },
        }),
        prisma.task.count({
          where: {
            board: { organisationId },
            completedAt: { not: null },
            assignees: { some: { userId: m.userId } },
          },
        }),
      ]);
      return { userId: m.userId, name: m.user.name, assigned, completed };
    })
  );

  res.json({
    totalBoards,
    totalMembers,
    totalTasks: tasks.length,
    completedCount,
    overdueCount,
    tasksByStatus,
    tasksByPriority,
    memberWorkload,
  });
}

const activityQuerySchema = z.object({ limit: z.coerce.number().min(1).max(200).default(50) });

export async function activity(req: AuthedRequest, res: Response) {
  const { limit } = activityQuerySchema.parse(req.query);

  const activities = await prisma.taskActivity.findMany({
    where: { task: { board: { organisationId: req.params.orgId } } },
    include: {
      user: true,
      task: { select: { id: true, title: true, board: { select: { id: true, name: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  res.json(activities);
}

const calendarQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/), // "2026-09"
});

export async function calendar(req: AuthedRequest, res: Response) {
  const { month } = calendarQuerySchema.parse(req.query);
  const [year, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, m - 1, 1));
  const end = new Date(Date.UTC(year, m, 1));

  const tasks = await prisma.task.findMany({
    where: {
      board: { organisationId: req.params.orgId },
      dueDate: { gte: start, lt: end },
    },
    select: {
      id: true,
      title: true,
      priority: true,
      dueDate: true,
      board: { select: { id: true, name: true } },
    },
    orderBy: { dueDate: "asc" },
  });

  res.json(tasks);
}

const reportQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
});

export async function reportPdf(req: AuthedRequest, res: Response) {
  const { from, to } = reportQuerySchema.parse(req.query);
  const organisationId = req.params.orgId;

  const [org, tasksInRange, expensesInRange, members] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({ where: { id: organisationId } }),
    prisma.task.findMany({
      where: { board: { organisationId }, createdAt: { gte: from, lte: to } },
      include: { assignees: { include: { user: true } }, status: true, board: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.expense.findMany({
      where: { organisationId, date: { gte: from, lte: to } },
      orderBy: { date: "asc" },
    }),
    prisma.organisationMember.findMany({ where: { organisationId }, include: { user: true } }),
  ]);

  const completed = tasksInRange.filter((t) => t.completedAt).length;
  const totalExpense = expensesInRange.reduce((sum, e) => sum + Number(e.amount), 0);

  // pdfkit builds the document as a stream — piped straight to the
  // response rather than buffered in memory, so this scales fine even for
  // a report with hundreds of rows.
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({ margin: 50 });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${org.slug}-report-${from.toISOString().slice(0, 10)}_${to
      .toISOString()
      .slice(0, 10)}.pdf"`
  );
  doc.pipe(res);

  doc.fontSize(18).text(`${org.name} — Report`, { align: "left" });
  doc
    .fontSize(10)
    .fillColor("#666")
    .text(`${from.toDateString()} — ${to.toDateString()}`)
    .moveDown(1.5);

  doc.fillColor("#000").fontSize(13).text("Summary").moveDown(0.5);
  doc
    .fontSize(10)
    .text(`Tasks created: ${tasksInRange.length}`)
    .text(`Tasks completed: ${completed}`)
    .text(`Members: ${members.length}`)
    .text(`Total expenses: $${totalExpense.toFixed(2)}`)
    .moveDown(1.5);

  doc.fontSize(13).text("Tasks").moveDown(0.5);
  if (tasksInRange.length === 0) {
    doc.fontSize(10).fillColor("#666").text("No tasks created in this period.").fillColor("#000");
  }
  tasksInRange.forEach((t) => {
    const assignees = t.assignees.map((a) => a.user.name).join(", ") || "Unassigned";
    doc
      .fontSize(10)
      .text(`• ${t.title}  [${t.board.name} / ${t.status.name}]`, { continued: false })
      .fontSize(8)
      .fillColor("#666")
      .text(`   Priority: ${t.priority}  ·  Assignees: ${assignees}  ·  Created: ${t.createdAt.toDateString()}`)
      .fillColor("#000");
  });
  doc.moveDown(1.5);

  doc.fontSize(13).text("Expenses").moveDown(0.5);
  if (expensesInRange.length === 0) {
    doc.fontSize(10).fillColor("#666").text("No expenses logged in this period.").fillColor("#000");
  }
  expensesInRange.forEach((e) => {
    doc
      .fontSize(10)
      .text(`• ${e.title} — $${Number(e.amount).toFixed(2)} (${e.category})  ${e.date.toDateString()}`);
  });

  doc.end();
}
