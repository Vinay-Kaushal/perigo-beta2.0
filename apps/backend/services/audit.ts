import type { Request } from "express";
import { Prisma } from "db/client";
import { prisma } from "../lib/prisma";

export interface AuditInput {
  organisationId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Append-only record of security-relevant org changes (roles, membership,
 * approvals, deletions). Written after the change commits; a failure to
 * audit is logged loudly but doesn't undo the user's action.
 */
export async function audit(req: Request, input: AuditInput) {
  try {
    await prisma.auditLog.create({
      data: {
        organisationId: input.organisationId,
        actorId: req.user?.id ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        metadata: (input.metadata as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
        ip: req.ip ?? null,
      },
    });
  } catch (err) {
    console.error(`[audit] failed to record ${input.action}`, err);
  }
}
