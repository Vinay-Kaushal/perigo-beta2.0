import type { OrganisationRole, TaskPriority, TicketStatus } from "db/client";

const HOUR = 60 * 60 * 1000;

/** Resolution SLA per priority, in hours. */
export const SLA_HOURS: Record<TaskPriority, number> = {
  URGENT: 4,
  HIGH: 24,
  MEDIUM: 72,
  LOW: 120,
};

export function slaDueAt(priority: TaskPriority, from: Date): Date {
  return new Date(from.getTime() + SLA_HOURS[priority] * HOUR);
}

export const OPEN_STATUSES: TicketStatus[] = ["NEW", "OPEN", "IN_PROGRESS", "ON_HOLD"];
export const DONE_STATUSES: TicketStatus[] = ["RESOLVED", "CLOSED", "CANCELLED"];

export function isOpenStatus(status: TicketStatus) {
  return OPEN_STATUSES.includes(status);
}

export function isSlaBreached(ticket: { status: TicketStatus; dueAt: Date | null }, now = new Date()) {
  return isOpenStatus(ticket.status) && !!ticket.dueAt && ticket.dueAt.getTime() < now.getTime();
}

/** The workflow. Anything not listed here is rejected. */
export const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  NEW: ["OPEN", "IN_PROGRESS", "ON_HOLD", "RESOLVED", "CANCELLED"],
  OPEN: ["IN_PROGRESS", "ON_HOLD", "RESOLVED", "CANCELLED"],
  IN_PROGRESS: ["OPEN", "ON_HOLD", "RESOLVED", "CANCELLED"],
  ON_HOLD: ["OPEN", "IN_PROGRESS", "RESOLVED", "CANCELLED"],
  RESOLVED: ["CLOSED", "OPEN", "IN_PROGRESS"],
  CLOSED: ["OPEN"],
  CANCELLED: ["OPEN"],
};

export function canTransition(from: TicketStatus, to: TicketStatus) {
  return TRANSITIONS[from].includes(to);
}

export interface TicketActor {
  userId: string;
  role: OrganisationRole;
}

interface TicketPeople {
  requesterId: string;
  assigneeId: string | null;
}

const isAdmin = (role: OrganisationRole) => role === "OWNER" || role === "ADMIN";

/** Who may edit title/description/priority/type/category/team/SLA. */
export function canEditTicket(actor: TicketActor, ticket: TicketPeople) {
  return isAdmin(actor.role) || actor.userId === ticket.requesterId || actor.userId === ticket.assigneeId;
}

/**
 * Assignment rules:
 *  - owners/admins can assign anyone (or unassign);
 *  - anyone can pick up an unassigned ticket or route it to a colleague;
 *  - the requester and the current assignee can reassign;
 *  - otherwise a member may only take the ticket themselves if it's unassigned.
 */
export function canAssignTicket(actor: TicketActor, ticket: TicketPeople) {
  if (isAdmin(actor.role)) return true;
  if (ticket.assigneeId === null) return true;
  return actor.userId === ticket.requesterId || actor.userId === ticket.assigneeId;
}

export interface StatusChangeProblem {
  kind: "INVALID_TRANSITION" | "FORBIDDEN";
  message: string;
}

/** Returns why a status change is not allowed, or null if it is. */
export function checkStatusChange(
  actor: TicketActor,
  ticket: TicketPeople & { status: TicketStatus },
  to: TicketStatus,
  resolutionNote?: string | null
): StatusChangeProblem | null {
  const invalid = (message: string): StatusChangeProblem => ({ kind: "INVALID_TRANSITION", message });
  const forbidden = (message: string): StatusChangeProblem => ({ kind: "FORBIDDEN", message });

  if (ticket.status === to) return invalid(`Ticket is already ${to}`);
  if (!canTransition(ticket.status, to)) return invalid(`Cannot move a ticket from ${ticket.status} to ${to}`);
  if (to === "RESOLVED" && !resolutionNote?.trim()) return invalid("A resolution note is required to resolve a ticket");

  if (isAdmin(actor.role)) return null;

  // Reopening closed/cancelled tickets is an admin decision — even for the assignee.
  if (ticket.status === "CLOSED" || ticket.status === "CANCELLED") {
    return forbidden("Only an owner or admin can reopen a closed or cancelled ticket");
  }

  if (actor.userId === ticket.assigneeId) return null;

  if (actor.userId === ticket.requesterId) {
    // Requesters can withdraw their request, confirm a fix, or say it isn't fixed.
    const requesterMoves: TicketStatus[] = ["CANCELLED", "CLOSED", "OPEN"];
    if (requesterMoves.includes(to)) return null;
    return forbidden("Only the assignee or an admin can make that status change");
  }

  return forbidden("Only the requester, assignee, or an admin can change this ticket's status");
}

export function ticketKey(prefix: string, number: number) {
  return `${prefix}-${number}`;
}
