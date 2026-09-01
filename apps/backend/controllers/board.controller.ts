import type { Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import  type { AuthedRequest } from "../middleware/auth";
import { publishBoardEvent } from "../lib/eventBus";
import { nextPosition, betweenPosition } from "../utils/position";

const DEFAULT_STATUSES: Array<{ name: string; type: string }> = [
  { name: "To Do", type: "TODO" },
  { name: "In Progress", type: "IN_PROGRESS" },
  { name: "In Review", type: "IN_REVIEW" },
  { name: "Done", type: "COMPLETED" },
];

const boardSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  teamId: z.string().uuid().optional(),
});

export async function createBoard(req: AuthedRequest, res: Response) {
  const body = boardSchema.parse(req.body);
  const orgMembership = (req as any).membership;

  const board = await prisma.board.create({
    data: {
      name: body.name,
      description: body.description,
      teamId: body.teamId,
      organisationId: req.params.orgId,
      members: { create: { organisationMemberId: orgMembership.id } },
      // Every board ships with a default swimlane set (Trello/Jira-style)
      // so the frontend never has to render an empty board with no columns.
      taskStatuses: {
        create: DEFAULT_STATUSES.map((s, i) => ({
          name: s.name,
          type: s.type as any,
          position: (i + 1) * 1000,
        })),
      },
    },
    include: { taskStatuses: { orderBy: { position: "asc" } } },
  });

  res.status(201).json(board);
}

export async function listBoards(req: AuthedRequest, res: Response) {
  const boards = await prisma.board.findMany({
    where: { organisationId: req.params.orgId },
    include: { _count: { select: { tasks: true, members: true } } },
  });
  res.json(boards);
}

export async function getBoard(req: AuthedRequest, res: Response) {
  const board = await prisma.board.findUnique({
    where: { id: req.params.boardId },
    include: {
      taskStatuses: { orderBy: { position: "asc" } },
      members: { include: { organisationMember: { include: { user: true } } } },
    },
  });
  if (!board) return res.status(404).json({ error: "Board not found" });
  res.json(board);
}

export async function updateBoard(req: AuthedRequest, res: Response) {
  const body = boardSchema.partial().parse(req.body);
  const board = await prisma.board.update({ where: { id: req.params.boardId }, data: body });

  await publishBoardEvent(board.id, "BOARD_UPDATED", req.user.id, board);
  res.json(board);
}

export async function deleteBoard(req: AuthedRequest, res: Response) {
  await prisma.board.delete({ where: { id: req.params.boardId } });
  res.status(204).send();
}

const addBoardMemberSchema = z.object({ organisationMemberId: z.string().uuid() });

export async function addBoardMember(req: AuthedRequest, res: Response) {
  const body = addBoardMemberSchema.parse(req.body);
  const member = await prisma.boardMember.create({
    data: { boardId: req.params.boardId, organisationMemberId: body.organisationMemberId },
    include: { organisationMember: { include: { user: true } } },
  });

  await publishBoardEvent(req.params.boardId as string, "MEMBER_ADDED", req.user.id, member);
  res.status(201).json(member);
}

export async function removeBoardMember(req: AuthedRequest, res: Response) {
  const member = await prisma.boardMember.delete({ where: { id: req.params.memberId } });
  await publishBoardEvent(req.params.boardId as string, "MEMBER_REMOVED", req.user.id, { id: member.id });
  res.status(204).send();
}

// ---- Task statuses (columns) ----

const statusSchema = z.object({
  name: z.string().min(1).max(60),
  type: z.enum([
    "TODO",
    "IN_PROGRESS",
    "IN_REVIEW",
    "BLOCKED",
    "COMPLETED",
    "APPROVED",
    "REJECTED",
  ]),
});

export async function createStatus(req: AuthedRequest, res: Response) {
  const body = statusSchema.parse(req.body);
  const last = await prisma.taskStatus.findFirst({
    where: { boardId: req.params.boardId },
    orderBy: { position: "desc" },
  });

  const status = await prisma.taskStatus.create({
    data: { ...body, boardId: req.params.boardId, position: nextPosition(last?.position ?? null) },
  });

  await publishBoardEvent(status.boardId, "STATUS_CREATED", req.user.id, status);
  res.status(201).json(status);
}

export async function updateStatus(req: AuthedRequest, res: Response) {
  const body = statusSchema.partial().parse(req.body);
  const status = await prisma.taskStatus.update({ where: { id: req.params.statusId }, data: body });

  await publishBoardEvent(status.boardId, "STATUS_UPDATED", req.user.id, status);
  res.json(status);
}

const reorderStatusSchema = z.object({
  beforeId: z.string().uuid().nullable().optional(),
  afterId: z.string().uuid().nullable().optional(),
});

export async function reorderStatus(req: AuthedRequest, res: Response) {
  const body = reorderStatusSchema.parse(req.body);

  const [before, after] = await Promise.all([
    body.beforeId ? prisma.taskStatus.findUnique({ where: { id: body.beforeId } }) : null,
    body.afterId ? prisma.taskStatus.findUnique({ where: { id: body.afterId } }) : null,
  ]);

  const position = betweenPosition(before?.position, after?.position);
  const status = await prisma.taskStatus.update({
    where: { id: req.params.statusId },
    data: { position },
  });

  await publishBoardEvent(status.boardId, "STATUS_REORDERED", req.user.id, status);
  res.json(status);
}

export async function deleteStatus(req: AuthedRequest, res: Response) {
  // Restrict-on-delete relation on Task.status means Prisma will throw
  // (caught by errorHandler as P2003/known-request-error) if tasks still
  // reference this status — force the client to move/delete tasks first.
  const status = await prisma.taskStatus.delete({ where: { id: req.params.statusId } });
  await publishBoardEvent(status.boardId, "STATUS_DELETED", req.user.id, { id: status.id });
  res.status(204).send();
}
