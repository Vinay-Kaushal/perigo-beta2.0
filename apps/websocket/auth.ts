import type Redis from "ioredis";
import type { AuthedUser } from "./types";

const TICKET_RE = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * Sockets authenticate with a single-use ticket minted by the backend
 * (POST /auth/ws-ticket), passed as `?ticket=`. GETDEL makes it one-shot,
 * and the backend gives it a ~30s TTL — so a ticket that leaks into a proxy
 * log is worthless by the time anyone reads it. The long-lived JWT never
 * appears in a websocket URL.
 */
export async function redeemTicket(redis: Redis, ticket: string | null): Promise<AuthedUser | null> {
  if (!ticket || !TICKET_RE.test(ticket)) return null;
  try {
    const raw = await redis.getdel(`ws:ticket:${ticket}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthedUser>;
    if (typeof parsed.userId !== "string" || typeof parsed.name !== "string") return null;
    return {
      userId: parsed.userId,
      email: parsed.email ?? "",
      name: parsed.name,
      ssoConnectionId: typeof parsed.ssoConnectionId === "string" ? parsed.ssoConnectionId : null,
    };
  } catch {
    return null;
  }
}
