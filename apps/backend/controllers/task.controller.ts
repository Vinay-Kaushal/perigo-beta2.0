import type { Request, Response } from "express";
import { z } from "zod";
import type { Board, Prisma } from "db/client";
import { prisma } from "../lib/prisma";
import { publicUser } from "../lib/selects";
import { badRequest, conflict, forbidden, notFound, param } from "../lib/http";
import { publishBoardEvent } from "../lib/eventBus";
import { currentUser } from "../middleware/auth";
import { getMembership, isOrgAdmin, resolveBoardAccess } from "../middleware/access";
import { notify } from "../services/notifications";
import { POSITION_GAP, betweenPosition, nextPosition } from "../utils/position";

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

const taskInclude = {
  assignees: { include: { user: publicUser } },
  status: true,
  _count: { select: { comments: true } },
} satisfies Prisma.TaskInclude;

function loadedTask(req: Request) {
  if (!req.task || !req.board) throw notFound("Task not found");
  return { task: req.task, board: req.board };
}

async function assertStatusOnBoard(statusId: string, boardId: string) {
  const status = await prisma.taskStatus.findFirst({ where: { id: statusId, boardId } });
  if (!status) throw badRequest("Column must belong to this board");
  return status;
}

/** Assignees must be able to see the board — otherwise they'd be assigned work they can't open. */
async function assertAssignable(userIds: string[], board: Board) {
  for (const userId of new Set(userIds)) {
    if (!(await resolveBoardAccess(userId, board.id))) {
      throw badRequest("Assignees must have access to this board");
    }
  }
}

const createTaskSchema = z.object({
  statusId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(10_000).optional(),
  priority: z.enum(PRIORITIES).default("MEDIUM"),
  dueDate: z.coerce.date().optional(),
  assigneeIds: z.array(z.string().uuid()).max(20).optional(),
});

export async function createTask(req: Request, res: Response) {
  const user = currentUser(req);
  const board = req.board!;
  const body = createTaskSchema.parse(req.body);

  await assertStatusOnBoard(body.statusId, board.id);
  if (body.assigneeIds?.length) await assertAssignable(body.assigneeIds, board);

  const last = await prisma.task.findFirst({ where: { statusId: body.statusId }, orderBy: { position: "desc" } });
  const assigneeIds = [...new Set(body.assigneeIds ?? [])];

  const task = await prisma.$transaction(async (tx) => {
    const created = await tx.task.create({
      data: {
        boardId: board.id,
        statusId: body.statusId,
        title: body.title,
        description: body.description,
        priority: body.priority,
        dueDate: body.dueDate,
        position: nextPosition(last?.position),
        assignees: assigneeIds.length ? { create: assigneeIds.map((userId) => ({ userId })) } : undefined,
      },
      include: taskInclude,
    });
    await tx.taskActivity.create({ data: { taskId: created.id, userId: user.id, type: "TASK_CREATED" } });
    return created;
  });

  await notify(assigneeIds, {
    type: "TASK_ASSIGNED",
    title: `${user.name} assigned you "${task.title}"`,
    body: board.name,
    link: `/boards/${board.id}?task=${task.id}`,
    organisationId: board.organisationId,
    actorId: user.id,
  });
  await publishBoardEvent(board.id, "TASK_CREATED", user.id, { id: task.id });
  res.status(201).json(task);
}

const listTasksQuerySchema = z.object({
  statusId: z.string().uuid().optional(),
  assigneeId: z.string().uuid().optional(),
  priority: z.enum(PRIORITIES).optional(),
});

export async function listTasks(req: Request, res: Response) {
  const board = req.board!;
  const query = listTasksQuerySchema.parse(req.query);
  const tasks = await prisma.task.findMany({
    where: {
      boardId: board.id,
      statusId: query.statusId,
      priority: query.priority,
      assignees: query.assigneeId ? { some: { userId: query.assigneeId } } : undefined,
    },
    include: taskInclude,
    orderBy: { position: "asc" },
  });
  res.json(tasks);
}

export async function getTask(req: Request, res: Response) {
  const { task } = loadedTask(req);
  const full = await prisma.task.findUniqueOrThrow({
    where: { id: task.id },
    include: {
      ...taskInclude,
      comments: { include: { user: publicUser }, orderBy: { createdAt: "asc" } },
      activities: { include: { user: publicUser }, orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  res.json(full);
}

const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(10_000).nullable().optional(),
  priority: z.enum(PRIORITIES).optional(),
  dueDate: z.coerce.date().nullable().optional(),
});

export async function updateTask(req: Request, res: Response) {
  const user = currentUser(req);
  const { task } = loadedTask(req);
  const body = updateTaskSchema.parse(req.body);

  const updated = await prisma.$transaction(async (tx) => {
    const t = await tx.task.update({ where: { id: task.id }, data: body, include: taskInclude });
    await tx.taskActivity.create({
      data: { taskId: task.id, userId: user.id, type: "TASK_UPDATED", metadata: { fields: Object.keys(body) } },
    });
    return t;
  });

  await publishBoardEvent(task.boardId, "TASK_UPDATED", user.id, { id: task.id });
  res.json(updated);
}

/**
 * Drag-and-drop: the client sends the target column and the neighbours the
 * card landed between. Neighbours must be in that column on this board.
 */
const moveTaskSchema = z.object({
  statusId: z.string().uuid(),
  beforeTaskId: z.string().uuid().nullable().optional(),
  afterTaskId: z.string().uuid().nullable().optional(),
});

export async function moveTask(req: Request, res: Response) {
  const user = currentUser(req);
  const { task, board } = loadedTask(req);
  const body = moveTaskSchema.parse(req.body);

  const target = await assertStatusOnBoard(body.statusId, board.id);

  // Approval gate: only owners/admins can land a card in APPROVED/REJECTED.
  if ((target.type === "APPROVED" || target.type === "REJECTED") && !isOrgAdmin(getMembership(req).role)) {
    throw forbidden("Only an owner or admin can approve or reject a task");
  }

  const neighbour = (id: string | null | undefined) =>
    id && id !== task.id ? prisma.task.findFirst({ where: { id, statusId: target.id } }) : Promise.resolve(null);
  const [before, after] = await Promise.all([neighbour(body.beforeTaskId), neighbour(body.afterTaskId)]);
  if ((body.beforeTaskId && body.beforeTaskId !== task.id && !before) || (body.afterTaskId && body.afterTaskId !== task.id && !after)) {
    throw conflict("The board changed while you were dragging — refresh and try again");
  }

  const statusChanged = task.statusId !== target.id;

  const updated = await prisma.$transaction(async (tx) => {
    let position = betweenPosition(before?.position, after?.position);
    if (position === null) {
      // No integer gap left between the neighbours — renumber the column once.
      const siblings = (await tx.task.findMany({ where: { statusId: target.id }, orderBy: { position: "asc" } })).filter(
        (s) => s.id !== task.id
      );
      const insertAt = before ? siblings.findIndex((s) => s.id === before.id) + 1 : 0;
      for (const [i, s] of siblings.entries()) {
        const slot = i < insertAt ? i + 1 : i + 2;
        await tx.task.update({ where: { id: s.id }, data: { position: slot * POSITION_GAP } });
      }
      position = (insertAt + 1) * POSITION_GAP;
    }

    const completedAt =
      target.type === "COMPLETED" ? (task.completedAt ?? new Date()) : statusChanged ? null : task.completedAt;

    const t = await tx.task.update({
      where: { id: task.id },
      data: { statusId: target.id, position, completedAt },
      include: taskInclude,
    });

    if (statusChanged) {
      await tx.taskActivity.create({
        data: { taskId: task.id, userId: user.id, type: "TASK_STATUS_CHANGED", metadata: { from: task.statusId, to: target.id, toName: target.name } },
      });
    }
    return t;
  });

  await publishBoardEvent(board.id, "TASK_MOVED", user.id, { id: task.id, statusId: updated.statusId, position: updated.position });
  res.json(updated);
}

export async function deleteTask(req: Request, res: Response) {
  const { task } = loadedTask(req);
  await prisma.task.delete({ where: { id: task.id } });
  await publishBoardEvent(task.boardId, "TASK_DELETED", req.user!.id, { id: task.id });
  res.status(204).send();
}

const assigneeSchema = z.object({ userId: z.string().uuid() });

export async function addAssignee(req: Request, res: Response) {
  const user = currentUser(req);
  const { task, board } = loadedTask(req);
  const { userId } = assigneeSchema.parse(req.body);
  await assertAssignable([userId], board);

  const assignee = await prisma.taskAssignee.upsert({
    where: { taskId_userId: { taskId: task.id, userId } },
    update: {},
    create: { taskId: task.id, userId },
    include: { user: publicUser },
  });
  await prisma.taskActivity.create({
    data: { taskId: task.id, userId: user.id, type: "TASK_ASSIGNED", metadata: { userId, name: assignee.user.name } },
  });
  await notify([userId], {
    type: "TASK_ASSIGNED",
    title: `${user.name} assigned you "${task.title}"`,
    body: board.name,
    link: `/boards/${board.id}?task=${task.id}`,
    organisationId: board.organisationId,
    actorId: user.id,
  });
  await publishBoardEvent(board.id, "TASK_ASSIGNEE_CHANGED", user.id, { id: task.id });
  res.status(201).json(assignee);
}

export async function removeAssignee(req: Request, res: Response) {
  const user = currentUser(req);
  const { task } = loadedTask(req);
  const userId = param(req, "userId");
  const result = await prisma.taskAssignee.deleteMany({ where: { taskId: task.id, userId } });
  if (result.count === 0) throw notFound("That user isn't assigned to this task");
  await prisma.taskActivity.create({ data: { taskId: task.id, userId: user.id, type: "TASK_UNASSIGNED", metadata: { userId } } });
  await publishBoardEvent(task.boardId, "TASK_ASSIGNEE_CHANGED", user.id, { id: task.id });
  res.status(204).send();
}

// ---- comments

const commentSchema = z.object({ content: z.string().trim().min(1).max(5000) });

export async function addComment(req: Request, res: Response) {
  const user = currentUser(req);
  const { task } = loadedTask(req);
  const { content } = commentSchema.parse(req.body);

  const comment = await prisma.$transaction(async (tx) => {
    const c = await tx.comment.create({ data: { taskId: task.id, userId: user.id, content }, include: { user: publicUser } });
    await tx.taskActivity.create({ data: { taskId: task.id, userId: user.id, type: "COMMENT_ADDED", metadata: { commentId: c.id } } });
    return c;
  });
  await publishBoardEvent(task.boardId, "COMMENT_ADDED", user.id, { id: comment.id, taskId: task.id });
  res.status(201).json(comment);
}

export async function listComments(req: Request, res: Response) {
  const { task } = loadedTask(req);
  const comments = await prisma.comment.findMany({
    where: { taskId: task.id },
    include: { user: publicUser },
    orderBy: { createdAt: "asc" },
  });
  res.json(comments);
}

async function loadComment(req: Request) {
  const { task } = loadedTask(req);
  const comment = await prisma.comment.findFirst({ where: { id: param(req, "commentId"), taskId: task.id } });
  if (!comment) throw notFound("Comment not found");
  return { task, comment };
}

export async function updateComment(req: Request, res: Response) {
  const user = currentUser(req);
  const { task, comment } = await loadComment(req);
  if (comment.userId !== user.id) throw forbidden("You can only edit your own comments");
  const { content } = commentSchema.parse(req.body);
  const updated = await prisma.comment.update({ where: { id: comment.id }, data: { content }, include: { user: publicUser } });
  await publishBoardEvent(task.boardId, "COMMENT_UPDATED", user.id, { id: comment.id, taskId: task.id });
  res.json(updated);
}

export async function deleteComment(req: Request, res: Response) {
  const user = currentUser(req);
  const { task, comment } = await loadComment(req);
  if (comment.userId !== user.id && !isOrgAdmin(getMembership(req).role)) {
    throw forbidden("You can only delete your own comments");
  }
  await prisma.comment.delete({ where: { id: comment.id } });
  await publishBoardEvent(task.boardId, "COMMENT_DELETED", user.id, { id: comment.id, taskId: task.id });
  res.status(204).send();
}
