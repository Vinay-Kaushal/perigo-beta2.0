import type { AuthedUser, PresenceUser, ServerMessage } from "./types";

/** The subset of a server-side socket the room registry needs (Bun's ServerWebSocket satisfies it). */
export interface SocketLike {
  send(data: string): unknown;
  readyState: number;
}

const OPEN = 1;

export interface ClientSocket {
  ws: SocketLike;
  user: AuthedUser;
  /** Channels this socket is subscribed to (always includes its own user:<id>). */
  channels: Set<string>;
  closed: boolean;
  /** Token bucket for inbound message rate limiting. */
  tokens: number;
  lastRefill: number;
}

const PRESENCE_COLORS = ["#EF4444", "#F97316", "#EAB308", "#22C55E", "#06B6D4", "#6366F1", "#A855F7", "#EC4899"];

export function colorForUser(userId: string) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return PRESENCE_COLORS[hash % PRESENCE_COLORS.length]!;
}

/**
 * In-memory, per-process room registry. Horizontal scaling works because
 * every instance subscribes to the same Redis channels and fans out to its
 * own local sockets.
 */
export class Rooms {
  private rooms = new Map<string, Set<ClientSocket>>();
  private byUser = new Map<string, Set<ClientSocket>>();

  send(client: ClientSocket, message: ServerMessage) {
    if (client.ws.readyState === OPEN) client.ws.send(JSON.stringify(message));
  }

  broadcast(channel: string, message: ServerMessage, exclude?: ClientSocket) {
    const room = this.rooms.get(channel);
    if (!room) return;
    const frame = JSON.stringify(message);
    for (const client of room) {
      if (client !== exclude && client.ws.readyState === OPEN) client.ws.send(frame);
    }
  }

  register(client: ClientSocket) {
    if (!this.byUser.has(client.user.userId)) this.byUser.set(client.user.userId, new Set());
    this.byUser.get(client.user.userId)!.add(client);
    this.join(client, `user:${client.user.userId}`);
  }

  socketsForUser(userId: string) {
    return [...(this.byUser.get(userId) ?? [])];
  }

  join(client: ClientSocket, channel: string) {
    if (!this.rooms.has(channel)) this.rooms.set(channel, new Set());
    this.rooms.get(channel)!.add(client);
    client.channels.add(channel);
    if (channel.startsWith("board:")) this.syncPresence(channel);
  }

  leave(client: ClientSocket, channel: string) {
    const room = this.rooms.get(channel);
    if (!room?.delete(client)) return;
    client.channels.delete(channel);
    if (room.size === 0) this.rooms.delete(channel);
    if (channel.startsWith("board:")) {
      this.broadcast(channel, { type: "presence:left", channel, userId: client.user.userId });
      this.syncPresence(channel);
    }
  }

  unregister(client: ClientSocket) {
    for (const channel of [...client.channels]) this.leave(client, channel);
    const set = this.byUser.get(client.user.userId);
    set?.delete(client);
    if (set?.size === 0) this.byUser.delete(client.user.userId);
  }

  roster(channel: string): PresenceUser[] {
    const seen = new Map<string, PresenceUser>();
    for (const client of this.rooms.get(channel) ?? []) {
      seen.set(client.user.userId, { userId: client.user.userId, name: client.user.name, color: colorForUser(client.user.userId) });
    }
    return [...seen.values()];
  }

  private syncPresence(channel: string) {
    this.broadcast(channel, { type: "presence:sync", channel, users: this.roster(channel) });
  }

  get size() {
    let n = 0;
    for (const set of this.byUser.values()) n += set.size;
    return n;
  }
}
