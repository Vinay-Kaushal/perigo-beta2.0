export type OrganisationRole = "OWNER" | "ADMIN" | "MEMBER";
export type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type TaskStatusType =
  | "TODO"
  | "IN_PROGRESS"
  | "IN_REVIEW"
  | "BLOCKED"
  | "COMPLETED"
  | "APPROVED"
  | "REJECTED";

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
}

export interface Organisation {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  myRole?: OrganisationRole;
}

export interface Board {
  id: string;
  organisationId: string;
  teamId?: string | null;
  name: string;
  description?: string | null;
  taskStatuses?: TaskStatusCol[];
  _count?: { tasks: number; members: number };
}

export interface TaskStatusCol {
  id: string;
  boardId: string;
  name: string;
  type: TaskStatusType;
  position: number;
}

export interface TaskAssignee {
  id: string;
  userId: string;
  user: User;
}

export interface Comment {
  id: string;
  taskId: string;
  userId: string;
  content: string;
  createdAt: string;
  user: User;
}

export interface Task {
  id: string;
  boardId: string;
  statusId: string;
  title: string;
  description?: string | null;
  priority: TaskPriority;
  position: number;
  dueDate?: string | null;
  createdAt: string;
  completedAt?: string | null;
  assignees: TaskAssignee[];
  status?: TaskStatusCol;
  comments?: Comment[];
  _count?: { comments: number };
}

export interface OrganisationMember {
  id: string;
  userId: string;
  organisationId: string;
  role: OrganisationRole;
  user: User;
}

export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";

export interface Invitation {
  id: string;
  organisationId: string;
  email: string;
  role: OrganisationRole;
  token: string;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
  inviteUrl?: string;
}

export interface Expense {
  id: string;
  organisationId: string;
  title: string;
  amount: string | number;
  currency: string;
  category: string;
  date: string;
  notes?: string | null;
  createdBy: User;
}

export interface ExpenseSummary {
  total: number;
  byCategory: { category: string; total: string | number }[];
}

export interface AnalyticsOverview {
  totalBoards: number;
  totalMembers: number;
  totalTasks: number;
  completedCount: number;
  overdueCount: number;
  tasksByStatus: { statusId: string; name: string; type?: string; count: number }[];
  tasksByPriority: { priority: TaskPriority; count: number }[];
  memberWorkload: { userId: string; name: string; assigned: number; completed: number }[];
}

export interface ActivityItem {
  id: string;
  type: string;
  createdAt: string;
  user: User | null;
  task: { id: string; title: string; board: { id: string; name: string } };
}

export interface CalendarTask {
  id: string;
  title: string;
  priority: TaskPriority;
  dueDate: string;
  board: { id: string; name: string };
}

export interface MyDashboardOrg {
  id: string;
  name: string;
  slug: string;
  myRole: OrganisationRole;
  boardsCount: number;
  membersCount: number;
  overdueCount: number;
}

export interface MyDashboardUpcomingTask {
  id: string;
  title: string;
  dueDate: string;
  priority: TaskPriority;
  orgName: string;
  boardName: string;
  boardId: string;
}

export interface MyDashboardActivity {
  id: string;
  type: string;
  createdAt: string;
  user: User | null;
  task: { id: string; title: string; board: { id: string; name: string }; orgName: string };
}

export interface MyDashboard {
  orgs: MyDashboardOrg[];
  myTasks: { total: number; overdueCount: number; dueThisWeekCount: number };
  upcomingTasks: MyDashboardUpcomingTask[];
  expensesThisMonth: number;
  recentActivity: MyDashboardActivity[];
}

export interface Goal {
  id: string;
  organisationId: string;
  title: string;
  targetAmount: string | number;
  category: string | null;
  periodStart: string;
  periodEnd: string;
  progress: { spent: number; target: number; percent: number };
}
