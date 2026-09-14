export type OrganisationRole = "OWNER" | "ADMIN" | "MEMBER";
export type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type TicketStatus = "NEW" | "OPEN" | "IN_PROGRESS" | "ON_HOLD" | "RESOLVED" | "CLOSED" | "CANCELLED";
export type TicketType = "INCIDENT" | "SERVICE_REQUEST" | "PROBLEM" | "CHANGE" | "QUESTION";
export type TaskStatusType = "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "BLOCKED" | "COMPLETED" | "APPROVED" | "REJECTED";
export type InvitationStatus = "PENDING" | "AWAITING_APPROVAL" | "ACCEPTED" | "REJECTED" | "REVOKED" | "EXPIRED";
export type ExpenseStatus = "PENDING" | "APPROVED" | "REJECTED";
export type GoalType = "BUDGET" | "METRIC" | "TICKETS_RESOLVED";
export type GoalHealth = "ON_TRACK" | "AT_RISK" | "OFF_TRACK" | "ACHIEVED" | "MISSED" | "NOT_STARTED";

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  createdAt?: string;
  lastLoginAt?: string | null;
  emailVerifiedAt?: string | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Organisation {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  requireJoinApproval: boolean;
  currency: string;
  ticketPrefix: string;
  myRole: OrganisationRole;
  createdAt: string;
  _count?: { members: number; boards: number; teams?: number; tickets: number };
}

export interface Member {
  id: string;
  userId: string;
  organisationId: string;
  role: OrganisationRole;
  joinedAt: string;
  user: User;
  teams: Array<{ id: string; name: string }>;
}

export interface Team {
  id: string;
  name: string;
  description?: string | null;
  openTickets: number;
  members: Array<User & { role: OrganisationRole }>;
}

export interface Invitation {
  id: string;
  email: string;
  role: OrganisationRole;
  status: InvitationStatus;
  message?: string | null;
  expiresAt: string;
  createdAt: string;
  acceptedAt?: string | null;
  invitedBy: User;
  acceptedBy?: User | null;
  reviewedBy?: User | null;
  inviteUrl?: string;
  emailed?: boolean;
}

export interface InvitationPreview {
  organisationName: string;
  invitedByName: string;
  email: string;
  role: OrganisationRole;
  status: InvitationStatus;
  message?: string | null;
  expiresAt: string;
  requiresApproval: boolean;
}

export interface Ticket {
  id: string;
  organisationId: string;
  number: number;
  key: string;
  title: string;
  description?: string | null;
  type: TicketType;
  status: TicketStatus;
  priority: Priority;
  category?: string | null;
  requesterId: string;
  assigneeId: string | null;
  teamId: string | null;
  requester: User;
  assignee: User | null;
  team: { id: string; name: string } | null;
  dueAt: string | null;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  resolutionNote: string | null;
  slaBreached: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { comments: number };
}

export interface TicketComment {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  author: User;
}

export interface TicketEvent {
  id: string;
  type: "CREATED" | "UPDATED" | "STATUS_CHANGED" | "PRIORITY_CHANGED" | "ASSIGNED" | "UNASSIGNED" | "TEAM_CHANGED" | "COMMENTED";
  metadata: any;
  createdAt: string;
  actor: User | null;
}

export interface TicketDetail extends Ticket {
  createdBy: User;
  watchers: User[];
  isWatching: boolean;
  comments: TicketComment[];
  events: TicketEvent[];
  permissions: { canEdit: boolean; canAssign: boolean; canDelete: boolean; allowedStatuses: TicketStatus[] };
}

export interface TicketStats {
  total: number;
  open: number;
  unassigned: number;
  breached: number;
  assignedToMe: number;
  byStatus: Record<TicketStatus, number>;
  byPriority: Record<Priority, number>;
  byType: Record<TicketType, number>;
  trend: Array<{ date: string; created: number; resolved: number }>;
  avgResolutionHours: number | null;
  slaCompliance: number | null;
  workload: Array<{ user: User; open: number }>;
}

export interface Board {
  id: string;
  organisationId: string;
  name: string;
  description?: string | null;
  team?: { id: string; name: string } | null;
  taskStatuses?: TaskStatusCol[];
  members?: Array<{ id: string; userId: string; role: OrganisationRole; user: User }>;
  myRole?: OrganisationRole;
  updatedAt?: string;
  _count?: { tasks: number; members: number };
}

export interface TaskStatusCol {
  id: string;
  boardId: string;
  name: string;
  type: TaskStatusType;
  position: number;
}

export interface Task {
  id: string;
  boardId: string;
  statusId: string;
  title: string;
  description?: string | null;
  priority: Priority;
  position: number;
  dueDate?: string | null;
  createdAt: string;
  completedAt?: string | null;
  assignees: Array<{ id: string; userId: string; user: User }>;
  status?: TaskStatusCol;
  comments?: Array<{ id: string; content: string; createdAt: string; user: User; userId: string }>;
  activities?: Array<{ id: string; type: string; createdAt: string; user: User | null; metadata: any }>;
  _count?: { comments: number };
}

export interface Expense {
  id: string;
  title: string;
  amount: number;
  currency: string;
  category: string;
  date: string;
  notes?: string | null;
  status: ExpenseStatus;
  reviewNote?: string | null;
  reviewedAt?: string | null;
  createdBy: User;
  reviewedBy?: User | null;
  createdAt: string;
}

export interface ExpenseSummary {
  scope: "organisation" | "mine";
  currency: string;
  total: number;
  thisMonth: number;
  pending: { count: number; total: number };
  byCategory: Array<{ category: string; total: number; count: number }>;
  byMonth: Array<{ month: string; total: number }>;
}

export interface GoalProgress {
  current: number;
  target: number;
  percent: number;
  expectedPercent: number;
  health: GoalHealth;
}

export interface Goal {
  id: string;
  organisationId: string;
  title: string;
  description?: string | null;
  type: GoalType;
  targetValue: number;
  currentValue: number;
  unit?: string | null;
  category?: string | null;
  periodStart: string;
  periodEnd: string;
  owner: User | null;
  createdBy: User;
  team: { id: string; name: string } | null;
  ownerId: string | null;
  progress: GoalProgress;
  checkIns?: Array<{ id: string; value: number; note?: string | null; createdAt: string; user: User }>;
  canManage?: boolean;
  organisation?: { id: string; name: string };
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
  actor: User | null;
  organisation: { id: string; name: string } | null;
}

export interface AuditLog {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
  actor: User | null;
}

export interface OrgOverview {
  members: number;
  teams: number;
  boards: number;
  tickets: { open: number; breached: number; unassigned: number; resolvedLast30Days: number };
  tasks: { total: number; completed: number; overdue: number };
  goals: { total: number; byHealth: Partial<Record<GoalHealth, number>>; items: Goal[] };
  finance: null | {
    currency: string;
    approvedThisMonth: number;
    pendingExpenses: number;
    pendingAmount: number;
    pendingJoinRequests: number;
  };
  workload: Array<{ user: User; role: OrganisationRole; openTickets: number; openTasks: number }>;
}

export interface ActivityItem {
  id: string;
  source: "ticket" | "task";
  type: string;
  createdAt: string;
  actor: User | null;
  metadata: any;
  subject: { id: string; title: string; key?: string; number?: number; board?: { id: string; name: string } };
}

export interface MyDashboard {
  orgs: Array<{ id: string; name: string; slug: string; myRole: OrganisationRole; membersCount: number; openTickets: number; pendingApprovals: number }>;
  tickets: { assignedOpen: number; breached: number; dueSoon: number; requestedOpen: number };
  myTickets: Array<Pick<Ticket, "id" | "number" | "key" | "title" | "status" | "priority" | "dueAt" | "slaBreached" | "requester"> & { organisation: { id: string; name: string } }>;
  tasks: { open: number; overdue: number; dueThisWeek: number };
  upcomingTasks: Array<{ id: string; title: string; dueDate: string; priority: Priority; overdue: boolean; board: { id: string; name: string }; organisation: { id: string; name: string } }>;
  approvals: { joinRequests: number; expenses: number };
  myExpensesThisMonth: number;
  unreadNotifications: number;
  goals: Goal[];
  pendingJoinRequests: Array<{ id: string; organisation: { id: string; name: string }; acceptedAt: string }>;
}
