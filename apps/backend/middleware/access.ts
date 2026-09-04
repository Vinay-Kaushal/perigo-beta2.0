import type { Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";
import type { AuthedRequest } from "./auth";

/**
 * Loads the caller's OrganisationMember row for :orgId (or the org that
 * owns :boardId / :teamId / :taskId) and attaches it to req. Every
 * downstream handler can then trust req.membership instead of
 * re-querying, and read req.membership.role for permission checks.
 */
export function requireOrgMember() {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const organisationId =
      req.params.orgId ?? req.body.organisationId ?? req.query.organisationId;

    if (!organisationId) {
      return res.status(400).json({ error: "organisationId is required" });
    }

    const membership = await prisma.organisationMember.findUnique({
      where: { userId_organisationId: { userId: req.user.id, organisationId } },
    });

    if (!membership) {
      return res.status(403).json({ error: "Not a member of this organisation" });
    }

    (req as any).membership = membership;
    next();
  };
}

/** Resolves the board from params, verifies the caller is a board member, attaches both. */
export function requireBoardMember() {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const boardId = req.params.boardId ?? req.params.id;
    if (!boardId) return res.status(400).json({ error: "boardId is required" });

    const board = await prisma.board.findUnique({ where: { id: boardId } });
    if (!board) return res.status(404).json({ error: "Board not found" });

    const orgMembership = await prisma.organisationMember.findUnique({
      where: {
        userId_organisationId: { userId: req.user.id, organisationId: board.organisationId },
      },
    });
    if (!orgMembership) {
      return res.status(403).json({ error: "Not a member of this board's organisation" });
    }

    const boardMembership = await prisma.boardMember.findUnique({
      where: {
        boardId_organisationMemberId: { boardId, organisationMemberId: orgMembership.id },
      },
    });

    // OWNER/ADMIN of the org can act on any board even without an explicit
    // BoardMember row; regular MEMBERs must be explicitly added to the board.
    if (!boardMembership && orgMembership.role === "MEMBER") {
      return res.status(403).json({ error: "Not a member of this board" });
    }

    (req as any).board = board;
    (req as any).orgMembership = orgMembership;
    (req as any).boardMembership = boardMembership;
    next();
  };
}

/**
 * For routes keyed by :taskId (no boardId in the URL) — resolves the task's
 * board, then applies the same membership check as requireBoardMember().
 * Use on every /tasks/:taskId... route so a stray task id can't be probed
 * by someone outside that board's organisation.
 */
export function requireTaskAccess() {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const task = await prisma.task.findUnique({ where: { id: req.params.taskId } });
    if (!task) return res.status(404).json({ error: "Task not found" });

    const board = await prisma.board.findUniqueOrThrow({ where: { id: task.boardId } });
    const orgMembership = await prisma.organisationMember.findUnique({
      where: {
        userId_organisationId: { userId: req.user.id, organisationId: board.organisationId },
      },
    });
    if (!orgMembership) {
      return res.status(403).json({ error: "Not a member of this task's organisation" });
    }

    (req as any).task = task;
    (req as any).board = board;
    (req as any).orgMembership = orgMembership;
    next();
  };
}

/** Restricts a route to specific organisation roles. Use after requireOrgMember(). */
export function requireOrgRole(...roles: Array<"OWNER" | "ADMIN" | "MEMBER">) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const membership = (req as any).membership;
    if (!membership || !roles.includes(membership.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}
