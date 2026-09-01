import Redis from "ioredis";

/**
 * The backend and the websocket server are separate deployable services
 * (separate folders / separate processes in the turborepo). They don't
 * share memory, so we can't just call `io.emit(...)` from an Express
 * route handler.
 *
 * Instead the backend publishes a small "fact" (what changed, on which
 * board) to Redis, and the websocket service subscribes to those channels
 * and rebroadcasts to the sockets in the relevant board room. This also
 * means the websocket service can be scaled to N instances later without
 * the backend caring.
 */
const publisher = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

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

interface BoardEventPayload {
  boardId: string;
  type: BoardEventType;
  actorId: string;
  data: unknown;
  timestamp: string;
}

export async function publishBoardEvent(
  boardId: string,
  type: BoardEventType,
  actorId: string,
  data: unknown
) {
  const payload: BoardEventPayload = {
    boardId,
    type,
    actorId,
    data,
    timestamp: new Date().toISOString(),
  };

  // Channel is namespaced per board so the websocket service can, if it
  // ever needs to, subscribe selectively instead of always doing
  // pattern-subscribe on `board:*`.
  await publisher.publish(`board:${boardId}`, JSON.stringify(payload));
}

export { publisher };
