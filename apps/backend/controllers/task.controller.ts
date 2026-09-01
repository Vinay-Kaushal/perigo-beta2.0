import type { Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import type { AuthedRequest } from "../middleware/auth";
import { publishBoardEvent } from "../lib/eventBus";
import { nextPosition, betweenPosition, needsRebalance, POSITION_GAP } from "../utils/position";

const createTaskSchema = z.object({
  statusId: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(10_000).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  dueDate: z.coerce.date().optional(),
  assigneeIds: z.array(z.string().uuid()).optional(),
});

export async function createTask(req: AuthedRequest, res: Response) {
  const body = createTaskSchema.parse(req.body);
  const boardId = req.params.boardId;

  if (!boardId) {
    return res.status(400).json({ error: "Board ID is required" });
  }

  const last = await prisma.task.findFirst({
    where: { statusId: body.statusId },
    orderBy: { position: "desc" },
  });

  const task = await prisma.$transaction(async (tx) => {
    const created = await tx.task.create({
      data: {
        boardId,
        statusId: body.statusId,
        title: body.title,
        description: body.description,
        priority: body.priority,
        dueDate: body.dueDate,
        position: nextPosition(last?.position ?? null),
        assignees: body.assigneeIds
          ? { create: body.assigneeIds.map((userId) => ({ userId })) }
          : undefined,
      },
      include: { assignees: { include: { user: true } }, status: true },
    });

    await tx.taskActivity.create({
      data: { taskId: created.id, userId: req.user.id, type: "TASK_CREATED" },
    });

    return created;
  });

  await publishBoardEvent(boardId, "TASK_CREATED", req.user.id, task);
  res.status(201).json(task);
}

const listTasksQuerySchema = z.object({
  statusId: z.string().uuid().optional(),
  assigneeId: z.string().uuid().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
});

export async function listTasks(req: AuthedRequest, res: Response) {
  const query = listTasksQuerySchema.parse(req.query);

  const tasks = await prisma.task.findMany({
    where: {
      boardId: req.params.boardId,
      statusId: query.statusId,
      priority: query.priority,
      assignees: query.assigneeId ? { some: { userId: query.assigneeId } } : undefined,
    },
    include: { assignees: { include: { user: true } }, status: true, _count: { select: { comments: true } } },
    orderBy: { position: "asc" },
  });

  res.json(tasks);
}

export async function getTask(req: AuthedRequest, res: Response) {
  const task = await prisma.task.findUnique({
    where: { id: req.params.taskId },
    include: {
      assignees: { include: { user: true } },
      status: true,
      comments: { include: { user: true }, orderBy: { createdAt: "asc" } },
      activities: { include: { user: true }, orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!task) return res.status(404).json({ error: "Task not found" });
  res.json(task);
}

const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(10_000).nullable().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  dueDate: z.coerce.date().nullable().optional(),
});

export async function updateTask(req: AuthedRequest, res: Response) {
  const body = updateTaskSchema.parse(req.body);

  const task = await prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({ where: { id: req.params.taskId }, data: body });
    await tx.taskActivity.create({
      data: {
        taskId: updated.id,
        userId: req.user.id,
        type: "TASK_UPDATED",
        metadata: body as any,
      },
    });
    return updated;
  });

  await publishBoardEvent(task.boardId, "TASK_UPDATED", req.user.id, task);
  res.json(task);
}

/**
 * The core Trello/Jira interaction: dragging a card to a new column and/or
 * a new spot within a column. Takes the *neighbours* the card was dropped
 * between rather than a raw index, which is what makes gap-based
 * positioning work and keeps concurrent drags from stomping each other.
 */
const moveTaskSchema = z.object({
  statusId: z.string().uuid(),
  beforeTaskId: z.string().uuid().nullable().optional(),
  afterTaskId: z.string().uuid().nullable().optional(),
});

export async function moveTask(req: AuthedRequest, res: Response) {
  const body = moveTaskSchema.parse(req.body);
  const taskId = req.params.taskId;
  if (!taskId) {
    return res.status(400).json({ error: "Task ID is required" });
  }

  const existing = await prisma.task.findUnique({ where: { id: taskId } });
  if (!existing) return res.status(404).json({ error: "Task not found" });

  const [before, after] = await Promise.all([
    body.beforeTaskId ? prisma.task.findUnique({ where: { id: body.beforeTaskId } }) : null,
    body.afterTaskId ? prisma.task.findUnique({ where: { id: body.afterTaskId } }) : null,
  ]);

  let position = betweenPosition(before?.position, after?.position);

  const task = await prisma.$transaction(async (tx) => {
    // Two cards dragged into the exact same gap repeatedly will eventually
    // collide on an Int position — detect it and fall back to a full
    // reindex of that column so drags never silently fail.
    if (before && after && needsRebalance(before.position, after.position)) {
      const siblings = await tx.task.findMany({
        where: { statusId: body.statusId },
        orderBy: { position: "asc" },
      });
      await Promise.all(
        siblings.map((s, i) =>
          tx.task.update({ where: { id: s.id }, data: { position: (i + 1) * POSITION_GAP } })
        )
      );
      position = (siblings.findIndex((s) => s.id === after.id) + 0.5) * POSITION_GAP;
    }

    const statusChanged = existing.statusId !== body.statusId;

    const updated = await tx.task.update({
      where: { id: taskId },
      data: {
        statusId: body.statusId,
        position,
      },
      include: { status: true, assignees: { include: { user: true } } },
    });

    if (statusChanged) {
      await tx.taskActivity.create({
        data: {
          taskId,
          userId: req.user.id,
          type: "TASK_STATUS_CHANGED",
          metadata: { from: existing.statusId, to: body.statusId },
        },
      });

      // Auto-stamp completedAt when a task lands in a COMPLETED-type column,
      // clear it if it's dragged back out. Cheap UX win, easy to rip out.
      if (updated.status.type === "COMPLETED" && !existing.completedAt) {
        await tx.task.update({ where: { id: taskId }, data: { completedAt: new Date() } });
      } else if (updated.status.type !== "COMPLETED" && existing.completedAt) {
        await tx.task.update({ where: { id: taskId }, data: { completedAt: null } });
      }
    }

    return updated;
  });

  await publishBoardEvent(task.boardId, "TASK_MOVED", req.user.id, {
    taskId: task.id,
    statusId: task.statusId,
    position: task.position,
  });

  res.json(task);
}

export async function deleteTask(req: AuthedRequest, res: Response) {
  const task = await prisma.task.delete({ where: { id: req.params.taskId } });
  await publishBoardEvent(task.boardId, "TASK_DELETED", req.user.id, { id: task.id });
  res.status(204).send();
}

const assigneeSchema = z.object({ userId: z.string().uuid() });

export async function addAssignee(req: AuthedRequest, res: Response) {
  const taskId = req.params.taskId;
  if (!taskId) {
    return res.status(400).json({ message: "Task ID is required." });
  }

  const body = assigneeSchema.parse(req.body);
  const assignee = await prisma.taskAssignee.create({
    data: { taskId, userId: body.userId },
    include: { user: true },
  });

  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
  await prisma.taskActivity.create({
    data: { taskId: task.id, userId: req.user.id, type: "TASK_ASSIGNED", metadata: { userId: body.userId } },
  });
  await publishBoardEvent(task.boardId, "TASK_ASSIGNEE_CHANGED", req.user.id, {
    taskId: task.id,
    assignee,
  });

  res.status(201).json(assignee);
}

export async function removeAssignee(req: AuthedRequest, res: Response) {
  const taskId = req.params.taskId;
  const userId = req.params.userId;

  if (!taskId || !userId) {
    return res.status(400).json({ message: "Task ID and user ID are required." });
  }

  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });

  await prisma.taskAssignee.delete({
    where: { taskId_userId: { taskId, userId } },
  });
  await prisma.taskActivity.create({
    data: {
      taskId: task.id,
      userId: req.user.id,
      type: "TASK_UNASSIGNED",
      metadata: { userId },
    },
  });
  await publishBoardEvent(task.boardId, "TASK_ASSIGNEE_CHANGED", req.user.id, {
    taskId: task.id,
    removedUserId: userId,
  });

  res.status(204).send();
}
