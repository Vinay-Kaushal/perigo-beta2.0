import type { Request, Response } from "express";
import { z } from "zod";
import type { TaskStatusType } from "db/client";
import { prisma } from "../lib/prisma";
import { publicUser } from "../lib/selects";
import { badRequest, conflict, forbidden, notFound, param } from "../lib/http";
import { publishBoardEvent, publishUserEvent } from "../lib/eventBus";
import { currentUser } from "../middleware/auth";
import { getMembership, isOrgAdmin } from "../middleware/access";
import { audit } from "../services/audit";
import { POSITION_GAP, betweenPosition, nextPosition } from "../utils/position";

const DEFAULT_STATUSES: Array<{ name: string; type: TaskStatusType }> = [
  { name: "To Do", type: "TODO" },
  { name: "In Progress", type: "IN_PROGRESS" },
  { name: "In Review", type: "IN_REVIEW" },
  { name: "Done", type: "COMPLETED" },
];

const STATUS_TYPES = ["TODO", "IN_PROGRESS", "IN_REVIEW", "BLOCKED", "COMPLETED", "APPROVED", "REJECTED"] as const;

function board(req: Request) {
  if (!req.board) throw notFound("Board not found");
  return req.board;
}

function requireBoardAdmin(req: Request) {
  if (!isOrgAdmin(getMembership(req).role)) throw forbidden("Only owners and admins can manage boards");
}

const boardSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  teamId: z.string().uuid().nullable().optional(),
});

async function assertTeamInOrg(orgId: string, teamId: string | null | undefined) {
  if (!teamId) return;
  const team = await prisma.team.findFirst({ where: { id: teamId, organisationId: orgId } });
  if (!team) throw badRequest("Team must belong to this organisation");
}

export async function createBoard(req: Request, res: Response) {
  const membership = getMembership(req);
  const body = boardSchema.parse(req.body);
  await assertTeamInOrg(membership.organisationId, body.teamId);

  const created = await prisma.board.create({
    data: {
      name: body.name,
      description: body.description,
      teamId: body.teamId,
      organisationId: membership.organisationId,
      members: { create: { organisationMemberId: membership.id } },
      taskStatuses: {
        create: DEFAULT_STATUSES.map((s, i) => ({ name: s.name, type: s.type, position: (i + 1) * POSITION_GAP })),
      },
    },
    include: { taskStatuses: { orderBy: { position: "asc" } } },
  });
  res.status(201).json(created);
}

/** Admins see every board; members only the boards they've been added to. */
export async function listBoards(req: Request, res: Response) {
  const membership = getMembership(req);
  const boards = await prisma.board.findMany({
    where: {
      organisationId: membership.organisationId,
      ...(isOrgAdmin(membership.role) ? {} : { members: { some: { organisationMemberId: membership.id } } }),
    },
    include: {
      team: { select: { id: true, name: true } },
      _count: { select: { tasks: true, members: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  res.json(boards);
}

export async function getBoard(req: Request, res: Response) {
  const b = board(req);
  const full = await prisma.board.findUniqueOrThrow({
    where: { id: b.id },
    include: {
      taskStatuses: { orderBy: { position: "asc" } },
      team: { select: { id: true, name: true } },
      members: { include: { organisationMember: { include: { user: publicUser } } } },
    },
  });
  res.json({
    ...full,
    myRole: getMembership(req).role,
    members: full.members.map((m) => ({ id: m.id, userId: m.organisationMember.userId, role: m.organisationMember.role, user: m.organisationMember.user })),
  });
}

export async function updateBoard(req: Request, res: Response) {
  requireBoardAdmin(req);
  const b = board(req);
  const body = boardSchema.partial().parse(req.body);
  await assertTeamInOrg(b.organisationId, body.teamId);
  const updated = await prisma.board.update({ where: { id: b.id }, data: body });
  await publishBoardEvent(b.id, "BOARD_UPDATED", req.user!.id, { id: b.id });
  res.json(updated);
}

export async function deleteBoard(req: Request, res: Response) {
  requireBoardAdmin(req);
  const b = board(req);
  await prisma.board.delete({ where: { id: b.id } });
  await audit(req, { organisationId: b.organisationId, action: "board.deleted", targetType: "board", targetId: b.id, metadata: { name: b.name } });
  await publishBoardEvent(b.id, "BOARD_DELETED", req.user!.id, { id: b.id });
  res.status(204).send();
}

// ---- board members

const addBoardMemberSchema = z.object({ userId: z.string().uuid() });

export async function addBoardMember(req: Request, res: Response) {
  requireBoardAdmin(req);
  const b = board(req);
  const { userId } = addBoardMemberSchema.parse(req.body);

  const orgMember = await prisma.organisationMember.findUnique({
    where: { userId_organisationId: { userId, organisationId: b.organisationId } },
    include: { user: publicUser },
  });
  if (!orgMember) throw badRequest("That user is not a member of this organisation");

  const member = await prisma.boardMember.upsert({
    where: { boardId_organisationMemberId: { boardId: b.id, organisationMemberId: orgMember.id } },
    update: {},
    create: { boardId: b.id, organisationMemberId: orgMember.id },
  });
  await publishBoardEvent(b.id, "MEMBER_ADDED", req.user!.id, { userId });
  await publishUserEvent(userId, "ACCESS_CHANGED", req.user!.id, { boardId: b.id });
  res.status(201).json({ id: member.id, userId, role: orgMember.role, user: orgMember.user });
}

export async function removeBoardMember(req: Request, res: Response) {
  requireBoardAdmin(req);
  const b = board(req);
  const userId = param(req, "userId");
  const result = await prisma.boardMember.deleteMany({
    where: { boardId: b.id, organisationMember: { userId, organisationId: b.organisationId } },
  });
  if (result.count === 0) throw notFound("That user is not on this board");
  await publishBoardEvent(b.id, "MEMBER_REMOVED", req.user!.id, { userId });
  await publishUserEvent(userId, "ACCESS_CHANGED", req.user!.id, { boardId: b.id });
  res.status(204).send();
}

// ---- statuses (columns)

const statusSchema = z.object({
  name: z.string().trim().min(1).max(60),
  type: z.enum(STATUS_TYPES),
});

async function loadStatus(req: Request) {
  const b = board(req);
  const status = await prisma.taskStatus.findFirst({ where: { id: param(req, "statusId"), boardId: b.id } });
  if (!status) throw notFound("Column not found");
  return status;
}

export async function createStatus(req: Request, res: Response) {
  requireBoardAdmin(req);
  const b = board(req);
  const body = statusSchema.parse(req.body);
  const last = await prisma.taskStatus.findFirst({ where: { boardId: b.id }, orderBy: { position: "desc" } });
  const status = await prisma.taskStatus.create({
    data: { ...body, boardId: b.id, position: nextPosition(last?.position) },
  });
  await publishBoardEvent(b.id, "STATUS_CREATED", req.user!.id, status);
  res.status(201).json(status);
}

export async function updateStatus(req: Request, res: Response) {
  requireBoardAdmin(req);
  const status = await loadStatus(req);
  const body = statusSchema.partial().parse(req.body);
  const updated = await prisma.taskStatus.update({ where: { id: status.id }, data: body });
  await publishBoardEvent(status.boardId, "STATUS_UPDATED", req.user!.id, updated);
  res.json(updated);
}

const reorderSchema = z.object({
  beforeId: z.string().uuid().nullable().optional(),
  afterId: z.string().uuid().nullable().optional(),
});

export async function reorderStatus(req: Request, res: Response) {
  requireBoardAdmin(req);
  const status = await loadStatus(req);
  const body = reorderSchema.parse(req.body);

  const neighbour = (id: string | null | undefined) =>
    id ? prisma.taskStatus.findFirst({ where: { id, boardId: status.boardId } }) : Promise.resolve(null);
  const [before, after] = await Promise.all([neighbour(body.beforeId), neighbour(body.afterId)]);
  if ((body.beforeId && !before) || (body.afterId && !after)) throw badRequest("Neighbour columns must be on the same board");

  let position = betweenPosition(before?.position, after?.position);
  if (position === null) {
    // Out of integer room — renumber the board's columns and slot in after `before`.
    const columns = (await prisma.taskStatus.findMany({ where: { boardId: status.boardId }, orderBy: { position: "asc" } })).filter(
      (c) => c.id !== status.id
    );
    const insertAt = before ? columns.findIndex((c) => c.id === before.id) + 1 : 0;
    columns.splice(insertAt, 0, status);
    await prisma.$transaction(
      columns.map((c, i) => prisma.taskStatus.update({ where: { id: c.id }, data: { position: (i + 1) * POSITION_GAP } }))
    );
    position = (insertAt + 1) * POSITION_GAP;
  }

  const updated = await prisma.taskStatus.update({ where: { id: status.id }, data: { position } });
  await publishBoardEvent(status.boardId, "STATUS_REORDERED", req.user!.id, updated);
  res.json(updated);
}

export async function deleteStatus(req: Request, res: Response) {
  requireBoardAdmin(req);
  const status = await loadStatus(req);
  const taskCount = await prisma.task.count({ where: { statusId: status.id } });
  if (taskCount > 0) throw conflict("Move or delete this column's tasks before deleting it");
  const columnCount = await prisma.taskStatus.count({ where: { boardId: status.boardId } });
  if (columnCount <= 1) throw conflict("A board needs at least one column");

  await prisma.taskStatus.delete({ where: { id: status.id } });
  await publishBoardEvent(status.boardId, "STATUS_DELETED", req.user!.id, { id: status.id });
  res.status(204).send();
}
