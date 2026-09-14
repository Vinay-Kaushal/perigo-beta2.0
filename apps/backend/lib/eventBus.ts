import { redis } from "./redis";

/**
 * The backend and the websocket server are separate processes, so the
 * backend publishes small "facts" to Redis and the websocket service fans
 * them out to the sockets in the matching room:
 *
 *   board:<id>  — kanban changes, delivered to people viewing that board
 *   org:<id>    — service-desk / membership changes, for everyone in the org
 *   user:<id>   — personal notifications and access revocations
 *
 * Publishing is best-effort: a Redis blip must never fail the HTTP request
 * that already committed to the database.
 */
export type RealtimeScope = "board" | "org" | "user";

export interface RealtimeEvent {
  scope: RealtimeScope;
  targetId: string;
  type: string;
  actorId: string | null;
  data: unknown;
  timestamp: string;
}

async function publish(scope: RealtimeScope, targetId: string, type: string, actorId: string | null, data: unknown) {
  const payload: RealtimeEvent = { scope, targetId, type, actorId, data, timestamp: new Date().toISOString() };
  try {
    await redis().publish(`${scope}:${targetId}`, JSON.stringify(payload));
  } catch (err) {
    console.error(`[eventBus] failed to publish ${type} to ${scope}:${targetId}`, err);
  }
}

export const publishBoardEvent = (boardId: string, type: string, actorId: string | null, data: unknown) =>
  publish("board", boardId, type, actorId, data);

export const publishOrgEvent = (orgId: string, type: string, actorId: string | null, data: unknown) =>
  publish("org", orgId, type, actorId, data);

export const publishUserEvent = (userId: string, type: string, actorId: string | null, data: unknown) =>
  publish("user", userId, type, actorId, data);
