import Redis from "ioredis";
import type { ServerWebSocket } from "bun";

import { redeemTicket } from "./auth";
import { canAccessChannel, parseChannel } from "./access";
import { Rooms, colorForUser, type ClientSocket } from "./rooms";
import type { AuthedUser, RealtimeEvent } from "./types";

export interface WsServerOptions {
  port: number;
  redisUrl: string;
  /** Browser origins allowed to connect. Empty = allow any (development only). */
  allowedOrigins: string[];
  /** Seconds without traffic before Bun closes the socket (it pings automatically). */
  idleTimeoutSec?: number;
  maxSocketsPerUser?: number;
  maxChannelsPerSocket?: number;
  /** Sustained inbound messages per second before a socket is throttled. */
  messagesPerSecond?: number;
  log?: (...args: unknown[]) => void;
}

const MAX_PAYLOAD_BYTES = 16 * 1024;
const MAX_COORD = 100_000;

type SocketData = { client?: ClientSocket; user: AuthedUser };

export async function createWsServer(opts: WsServerOptions) {
  const { idleTimeoutSec = 60, maxSocketsPerUser = 20, maxChannelsPerSocket = 50, messagesPerSecond = 40, log = console.log } = opts;

  const redis = new Redis(opts.redisUrl, { maxRetriesPerRequest: 2 });
  const subscriber = new Redis(opts.redisUrl);
  const rooms = new Rooms();

  function allowMessage(client: ClientSocket) {
    const now = Date.now();
    client.tokens = Math.min(messagesPerSecond * 2, client.tokens + ((now - client.lastRefill) / 1000) * messagesPerSecond);
    client.lastRefill = now;
    if (client.tokens < 1) return false;
    client.tokens -= 1;
    return true;
  }

  async function handleMessage(client: ClientSocket, raw: string | Buffer) {
    if (!allowMessage(client)) return rooms.send(client, { type: "error", message: "Rate limit exceeded" });

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
      if (!msg || typeof msg !== "object") throw new Error();
    } catch {
      return rooms.send(client, { type: "error", message: "Malformed message" });
    }

    switch (msg.type) {
      case "ping":
        return rooms.send(client, { type: "pong" });

      case "subscribe": {
        const channel = msg.channel;
        if (typeof channel !== "string" || !parseChannel(channel)) {
          return rooms.send(client, { type: "subscribe_denied", channel: String(channel), reason: "Invalid channel" });
        }
        if (client.channels.has(channel)) return rooms.send(client, { type: "subscribed", channel });
        if (client.channels.size >= maxChannelsPerSocket) {
          return rooms.send(client, { type: "subscribe_denied", channel, reason: "Too many subscriptions" });
        }
        if (!(await canAccessChannel(client.user.userId, channel))) {
          return rooms.send(client, { type: "subscribe_denied", channel, reason: "Not allowed" });
        }
        if (client.closed) return;
        rooms.send(client, { type: "subscribed", channel });
        rooms.join(client, channel);
        return;
      }

      case "unsubscribe": {
        const channel = msg.channel;
        if (typeof channel === "string" && !channel.startsWith("user:")) {
          rooms.leave(client, channel);
          rooms.send(client, { type: "unsubscribed", channel });
        }
        return;
      }

      case "presence:cursor": {
        const { channel, x, y } = msg;
        if (typeof channel !== "string" || !channel.startsWith("board:") || !client.channels.has(channel)) return;
        if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return;
        if (Math.abs(x) > MAX_COORD || Math.abs(y) > MAX_COORD) return;
        return rooms.broadcast(
          channel,
          { type: "presence:cursor", channel, userId: client.user.userId, name: client.user.name, color: colorForUser(client.user.userId), x: Math.round(x), y: Math.round(y) },
          client
        );
      }

      case "task:typing": {
        const { channel, taskId, isTyping } = msg;
        if (typeof channel !== "string" || !channel.startsWith("board:") || !client.channels.has(channel)) return;
        if (typeof taskId !== "string" || taskId.length > 64 || typeof isTyping !== "boolean") return;
        return rooms.broadcast(channel, { type: "task:typing", channel, taskId, userId: client.user.userId, isTyping }, client);
      }

      default:
        return rooms.send(client, { type: "error", message: "Unknown message type" });
    }
  }

  const server = Bun.serve<SocketData, never>({
    port: opts.port,
    async fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/health") {
        const healthy = redis.status === "ready" && subscriber.status === "ready";
        return Response.json({ ok: healthy }, { status: healthy ? 200 : 503 });
      }

      const origin = req.headers.get("origin");
      if (opts.allowedOrigins.length && (!origin || !opts.allowedOrigins.includes(origin))) {
        return new Response("Forbidden", { status: 403 });
      }
      if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Upgrade Required", { status: 426 });
      }
      const user = await redeemTicket(redis, url.searchParams.get("ticket"));
      if (!user) return new Response("Unauthorized", { status: 401 });
      if (rooms.socketsForUser(user.userId).length >= maxSocketsPerUser) {
        return new Response("Too Many Requests", { status: 429 });
      }
      if (srv.upgrade(req, { data: { user } })) return undefined;
      return new Response("Upgrade failed", { status: 400 });
    },
    websocket: {
      maxPayloadLength: MAX_PAYLOAD_BYTES,
      idleTimeout: idleTimeoutSec,
      sendPings: true,
      open(ws: ServerWebSocket<SocketData>) {
        const client: ClientSocket = {
          ws,
          user: ws.data.user,
          channels: new Set(),
          closed: false,
          tokens: messagesPerSecond * 2,
          lastRefill: Date.now(),
        };
        ws.data.client = client;
        rooms.register(client);
        rooms.send(client, { type: "ready", userId: client.user.userId });
      },
      message(ws: ServerWebSocket<SocketData>, raw) {
        const client = ws.data.client!;
        handleMessage(client, raw).catch((err) => {
          log("[ws] message handling failed", err);
          rooms.send(client, { type: "error", message: "Internal error" });
        });
      },
      close(ws: ServerWebSocket<SocketData>) {
        const client = ws.data.client;
        if (!client) return;
        client.closed = true;
        rooms.unregister(client);
      },
    },
  });

  /** Re-checks every non-personal subscription a user holds; drops the ones they've lost. */
  async function revalidateUser(userId: string) {
    for (const client of rooms.socketsForUser(userId)) {
      for (const channel of [...client.channels]) {
        if (channel.startsWith("user:")) continue;
        if (!(await canAccessChannel(userId, channel))) {
          rooms.leave(client, channel);
          rooms.send(client, { type: "unsubscribed", channel, reason: "Access revoked" });
        }
      }
    }
  }

  subscriber.on("pmessage", (_pattern, channel, message) => {
    let event: RealtimeEvent;
    try {
      event = JSON.parse(message);
    } catch {
      return log("[ws] dropped malformed event on", channel);
    }

    if (event.scope === "user" && (event.type === "ACCESS_REVOKED" || event.type === "ACCESS_CHANGED")) {
      // Revoke first, then tell the user — so no further org events slip through.
      revalidateUser(event.targetId)
        .catch((err) => log("[ws] revalidation failed", err))
        .finally(() => rooms.broadcast(channel, { type: "event", channel, event }));
      return;
    }
    rooms.broadcast(channel, { type: "event", channel, event });
  });

  await subscriber.psubscribe("board:*", "org:*", "user:*");

  async function close() {
    server.stop(true);
    await Promise.allSettled([redis.quit(), subscriber.quit()]);
  }

  return { port: server.port!, close, rooms };
}
