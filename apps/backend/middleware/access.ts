import type { NextFunction, Request, Response } from "express";
import type { OrganisationMember, OrganisationRole } from "db/client";
import { prisma } from "../lib/prisma";
import { asyncHandler, forbidden, HttpError, notFound } from "../lib/http";
import { currentUser } from "./auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

export const isOrgAdmin = (role: OrganisationRole) => role === "OWNER" || role === "ADMIN";

export function getMembership(req: Request): OrganisationMember {
  if (!req.membership) throw new HttpError(500, "Membership not loaded for this route");
  return req.membership;
}

/**
 * Loads the caller's membership for :orgId. Org ids only ever come from the
 * URL — never the body or query — so a request can't smuggle a different org.
 * Non-members get 404 rather than 403 so org ids can't be probed.
 */
export function requireOrgMember() {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    const user = currentUser(req);
    const orgId = req.params.orgId;
    if (!isUuid(orgId)) throw notFound("Organisation not found");

    const membership = await prisma.organisationMember.findUnique({
      where: { userId_organisationId: { userId: user.id, organisationId: orgId } },
    });
    if (!membership) throw notFound("Organisation not found");

    req.membership = membership;
    next();
  });
}

/** Restricts a route to specific organisation roles. Use after a membership loader. */
export function requireOrgRole(...roles: OrganisationRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const membership = getMembership(req);
    if (!roles.includes(membership.role)) return next(forbidden("Insufficient permissions"));
    next();
  };
}

/**
 * Board access rule, shared with the websocket service: OWNER/ADMIN reach
 * every board in their org; MEMBERs need an explicit BoardMember row.
 */
export async function resolveBoardAccess(userId: string, boardId: string) {
  const board = await prisma.board.findUnique({ where: { id: boardId } });
  if (!board) return null;

  const membership = await prisma.organisationMember.findUnique({
    where: { userId_organisationId: { userId, organisationId: board.organisationId } },
  });
  if (!membership) return null;

  if (!isOrgAdmin(membership.role)) {
    const boardMember = await prisma.boardMember.findUnique({
      where: { boardId_organisationMemberId: { boardId, organisationMemberId: membership.id } },
    });
    if (!boardMember) return null;
  }
  return { board, membership };
}

export function requireBoardAccess() {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    const user = currentUser(req);
    const boardId = req.params.boardId;
    if (!isUuid(boardId)) throw notFound("Board not found");

    const access = await resolveBoardAccess(user.id, boardId);
    if (!access) throw notFound("Board not found");

    req.board = access.board;
    req.membership = access.membership;
    next();
  });
}

/** For /tasks/:taskId routes — same rule as boards, resolved through the task's board. */
export function requireTaskAccess() {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    const user = currentUser(req);
    const taskId = req.params.taskId;
    if (!isUuid(taskId)) throw notFound("Task not found");

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw notFound("Task not found");

    const access = await resolveBoardAccess(user.id, task.boardId);
    if (!access) throw notFound("Task not found");

    req.task = task;
    req.board = access.board;
    req.membership = access.membership;
    next();
  });
}
