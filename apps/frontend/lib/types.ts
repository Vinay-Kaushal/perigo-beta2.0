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
