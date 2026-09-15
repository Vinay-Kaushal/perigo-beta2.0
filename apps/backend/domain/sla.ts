import type { TaskPriority } from "db/client";
import { addBusinessMinutes, businessMinutesBetween, type BusinessSchedule } from "./businessHours";

export interface SlaTargets {
  firstResponseMinutes: number;
  resolutionMinutes: number;
}

/** Used when an org hasn't customised a priority. Resolution targets match the original 24/7 SLAs. */
export const DEFAULT_SLA: Record<TaskPriority, SlaTargets> = {
  URGENT: { firstResponseMinutes: 30, resolutionMinutes: 4 * 60 },
  HIGH: { firstResponseMinutes: 2 * 60, resolutionMinutes: 24 * 60 },
  MEDIUM: { firstResponseMinutes: 8 * 60, resolutionMinutes: 72 * 60 },
  LOW: { firstResponseMinutes: 24 * 60, resolutionMinutes: 120 * 60 },
};

export const PRIORITIES: TaskPriority[] = ["URGENT", "HIGH", "MEDIUM", "LOW"];

export interface SlaContext {
  schedule: BusinessSchedule;
  policies: Record<TaskPriority, SlaTargets>;
}

export function resolvePolicies(rows: Array<{ priority: TaskPriority } & SlaTargets>): Record<TaskPriority, SlaTargets> {
  const byPriority = new Map(rows.map((r) => [r.priority, { firstResponseMinutes: r.firstResponseMinutes, resolutionMinutes: r.resolutionMinutes }]));
  return Object.fromEntries(PRIORITIES.map((p) => [p, byPriority.get(p) ?? DEFAULT_SLA[p]])) as Record<TaskPriority, SlaTargets>;
}

/** Targets for a new ticket. */
export function initialTargets(ctx: SlaContext, priority: TaskPriority, createdAt: Date) {
  const policy = ctx.policies[priority];
  return {
    responseDueAt: addBusinessMinutes(createdAt, policy.firstResponseMinutes, ctx.schedule),
    dueAt: addBusinessMinutes(createdAt, policy.resolutionMinutes, ctx.schedule),
  };
}

/**
 * Targets after a priority change: measured from creation, plus any business
 * time already spent paused, so time on hold is never lost.
 */
export function retarget(
  ctx: SlaContext,
  ticket: { createdAt: Date; slaPausedMinutes: number; firstResponseAt: Date | null },
  priority: TaskPriority
) {
  const policy = ctx.policies[priority];
  return {
    dueAt: addBusinessMinutes(ticket.createdAt, policy.resolutionMinutes + ticket.slaPausedMinutes, ctx.schedule),
    ...(ticket.firstResponseAt
      ? {}
      : { responseDueAt: addBusinessMinutes(ticket.createdAt, policy.firstResponseMinutes + ticket.slaPausedMinutes, ctx.schedule) }),
  };
}

export interface Resumed {
  slaPausedAt?: null;
  slaPausedMinutes?: number;
  dueAt?: Date;
  responseDueAt?: Date;
  /** Business minutes spent on this hold (not persisted; for the event log). */
  pausedMinutes?: number;
}

/**
 * Leaving ON_HOLD: the business time spent paused is added to the running
 * total and both targets move out by exactly that much.
 */
export function resume(
  ctx: SlaContext,
  ticket: { slaPausedAt: Date | null; slaPausedMinutes: number; dueAt: Date | null; responseDueAt: Date | null; firstResponseAt: Date | null },
  now: Date
): Resumed {
  if (!ticket.slaPausedAt) return {};
  const paused = businessMinutesBetween(ticket.slaPausedAt, now, ctx.schedule);
  return {
    slaPausedAt: null,
    slaPausedMinutes: ticket.slaPausedMinutes + paused,
    ...(ticket.dueAt ? { dueAt: addBusinessMinutes(ticket.dueAt, paused, ctx.schedule) } : {}),
    ...(ticket.responseDueAt && !ticket.firstResponseAt ? { responseDueAt: addBusinessMinutes(ticket.responseDueAt, paused, ctx.schedule) } : {}),
    pausedMinutes: paused,
  };
}
