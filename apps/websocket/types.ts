export interface AuthedUser {
  userId: string;
  email: string;
  name: string;
}

export type BoardEventType =
  | "TASK_CREATED"
  | "TASK_UPDATED"
  | "TASK_MOVED"
  | "TASK_DELETED"
  | "TASK_ASSIGNEE_CHANGED"
  | "STATUS_CREATED"
  | "STATUS_UPDATED"
  | "STATUS_REORDERED"
  | "STATUS_DELETED"
  | "COMMENT_ADDED"
  | "COMMENT_UPDATED"
  | "COMMENT_DELETED"
  | "BOARD_UPDATED"
  | "MEMBER_ADDED"
  | "MEMBER_REMOVED";

export interface BoardEventPayload {
  boardId: string;
  type: BoardEventType;
  actorId: string;
  data: unknown;
  timestamp: string;
}

/** Client -> server frame shapes. */
export type ClientMessage =
  | { type: "board:join"; boardId: string }
  | { type: "board:leave"; boardId: string }
  | { type: "presence:cursor"; boardId: string; x: number; y: number }
  | { type: "task:typing"; boardId: string; taskId: string; isTyping: boolean };

/** Server -> client frame shapes. */
export type ServerMessage =
  | { type: "board:event"; payload: BoardEventPayload }
  | { type: "board:joined"; boardId: string }
  | { type: "board:join_denied"; boardId: string; reason: string }
  | { type: "presence:sync"; boardId: string; users: Array<{ userId: string; name: string; color: string }> }
  | { type: "presence:cursor"; boardId: string; userId: string; name: string; color: string; x: number; y: number }
  | { type: "presence:left"; boardId: string; userId: string }
  | { type: "task:typing"; boardId: string; taskId: string; userId: string; isTyping: boolean }
  | { type: "error"; message: string };
