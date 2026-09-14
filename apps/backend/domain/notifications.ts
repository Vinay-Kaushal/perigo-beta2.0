import type { NotificationCategory } from "db/client";

export const CATEGORIES: Array<{ category: NotificationCategory; label: string; description: string; defaultEmail: boolean }> = [
  { category: "ASSIGNMENTS", label: "Assignments", description: "Tickets and tasks assigned to you or routed to your team", defaultEmail: true },
  { category: "MENTIONS", label: "Mentions", description: "When someone @mentions you", defaultEmail: true },
  { category: "APPROVALS", label: "Approvals", description: "Join requests and expenses waiting for your decision", defaultEmail: true },
  { category: "ACCOUNT", label: "Your requests", description: "Decisions on your join requests, invitations and expenses", defaultEmail: true },
  // Busiest category, so email is opt-in.
  { category: "TICKET_UPDATES", label: "Ticket activity", description: "Status changes, comments and reassignments on tickets you follow", defaultEmail: false },
];

const TYPE_CATEGORY: Record<string, NotificationCategory> = {
  TICKET_ASSIGNED: "ASSIGNMENTS",
  TICKET_TEAM_QUEUE: "ASSIGNMENTS",
  TICKET_RAISED_FOR_YOU: "ASSIGNMENTS",
  TASK_ASSIGNED: "ASSIGNMENTS",
  MENTIONED: "MENTIONS",
  TICKET_REASSIGNED: "TICKET_UPDATES",
  TICKET_ASSIGNMENT_CHANGED: "TICKET_UPDATES",
  TICKET_STATUS_CHANGED: "TICKET_UPDATES",
  TICKET_PRIORITY_CHANGED: "TICKET_UPDATES",
  TICKET_COMMENTED: "TICKET_UPDATES",
  JOIN_REQUEST: "APPROVALS",
  EXPENSE_SUBMITTED: "APPROVALS",
  JOIN_APPROVED: "ACCOUNT",
  JOIN_REJECTED: "ACCOUNT",
  INVITATION_RECEIVED: "ACCOUNT",
  INVITATION_ACCEPTED: "ACCOUNT",
  EXPENSE_APPROVED: "ACCOUNT",
  EXPENSE_REJECTED: "ACCOUNT",
};

/** Unknown types fall into ACCOUNT so a new notification type is never silently undeliverable. */
export function categoryFor(type: string): NotificationCategory {
  return TYPE_CATEGORY[type] ?? "ACCOUNT";
}

export interface DeliverySetting {
  inApp: boolean;
  email: boolean;
}

export function defaultSetting(category: NotificationCategory): DeliverySetting {
  return { inApp: true, email: CATEGORIES.find((c) => c.category === category)?.defaultEmail ?? true };
}

/** Effective settings for one user: stored rows override defaults. */
export function resolveSettings(rows: Array<{ category: NotificationCategory; inApp: boolean; email: boolean }>) {
  const map = new Map(rows.map((r) => [r.category, { inApp: r.inApp, email: r.email }]));
  return Object.fromEntries(CATEGORIES.map(({ category }) => [category, map.get(category) ?? defaultSetting(category)])) as Record<
    NotificationCategory,
    DeliverySetting
  >;
}
