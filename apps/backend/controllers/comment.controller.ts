import type { Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import type { AuthedRequest } from "../middleware/auth";
import { publishBoardEvent } from "../lib/eventBus";

const commentSchema = z.object({ content: z.string().min(1).max(5000) });

export async function addComment(req: AuthedRequest, res: Response) {
  const body = commentSchema.parse(req.body);
  const taskId = req.params.taskId;

  const [comment, task] = await prisma.$transaction([
    prisma.comment.create({
      data: { taskId, userId: req.user.id, content: body.content },
      include: { user: true },
    }),
    prisma.task.findUniqueOrThrow({ where: { id: taskId } }),
  ]);

  await prisma.taskActivity.create({
    data: { taskId, userId: req.user.id, type: "COMMENT_ADDED", metadata: { commentId: comment.id } },
  });

  await publishBoardEvent(task.boardId, "COMMENT_ADDED", req.user.id, comment);
  res.status(201).json(comment);
}

export async function listComments(req: AuthedRequest, res: Response) {
  const comments = await prisma.comment.findMany({
    where: { taskId: req.params.taskId },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });
  res.json(comments);
}

export async function updateComment(req: AuthedRequest, res: Response) {
  const body = commentSchema.parse(req.body);

  const existing = await prisma.comment.findUniqueOrThrow({ where: { id: req.params.commentId } });
  if (existing.userId !== req.user.id) {
    return res.status(403).json({ error: "You can only edit your own comments" });
  }

  const comment = await prisma.comment.update({
    where: { id: req.params.commentId },
    data: { content: body.content },
    include: { user: true },
  });

  const task = await prisma.task.findUniqueOrThrow({ where: { id: comment.taskId } });
  await publishBoardEvent(task.boardId, "COMMENT_UPDATED", req.user.id, comment);
  res.json(comment);
}

export async function deleteComment(req: AuthedRequest, res: Response) {
  const existing = await prisma.comment.findUniqueOrThrow({ where: { id: req.params.commentId } });
  if (existing.userId !== req.user.id) {
    return res.status(403).json({ error: "You can only delete your own comments" });
  }

  const comment = await prisma.comment.delete({ where: { id: req.params.commentId } });
  const task = await prisma.task.findUniqueOrThrow({ where: { id: comment.taskId } });

  await publishBoardEvent(task.boardId, "COMMENT_DELETED", req.user.id, { id: comment.id, taskId: task.id });
  res.status(204).send();
}
