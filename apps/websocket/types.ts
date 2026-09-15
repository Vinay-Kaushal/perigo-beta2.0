export interface AuthedUser {
  userId: string;
  email: string;
  name: string;
  /** The SSO connection this session signed in through, if any (mirrors the backend session's `sso` claim). */
  ssoConnectionId: string | null;
}

/** Mirrors apps/backend/lib/eventBus.ts. */
export interface RealtimeEvent {
  scope: "board" | "org" | "user";
  targetId: string;
  type: string;
  actorId: string | null;
  data: unknown;
  timestamp: string;
}

/** A subscribable room: `board:<uuid>` or `org:<uuid>`. `user:<id>` is joined automatically. */
export type Channel = `board:${string}` | `org:${string}` | `user:${string}`;

export type ClientMessage =
  | { type: "subscribe"; channel: string }
  | { type: "unsubscribe"; channel: string }
  | { type: "presence:cursor"; channel: string; x: number; y: number }
  | { type: "task:typing"; channel: string; taskId: string; isTyping: boolean }
  | { type: "ping" };

export interface PresenceUser {
  userId: string;
  name: string;
  color: string;
}

export type ServerMessage =
  | { type: "ready"; userId: string }
  | { type: "event"; channel: string; event: RealtimeEvent }
  | { type: "subscribed"; channel: string }
  | { type: "subscribe_denied"; channel: string; reason: string }
  | { type: "unsubscribed"; channel: string; reason?: string }
  | { type: "presence:sync"; channel: string; users: PresenceUser[] }
  | { type: "presence:cursor"; channel: string; userId: string; name: string; color: string; x: number; y: number }
  | { type: "presence:left"; channel: string; userId: string }
  | { type: "task:typing"; channel: string; taskId: string; userId: string; isTyping: boolean }
  | { type: "pong" }
  | { type: "error"; message: string };
