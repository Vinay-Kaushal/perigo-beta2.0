import { createHmac, timingSafeEqual } from "crypto";
import type { NotificationCategory } from "db/client";
import { env } from "./env";

export type UnsubscribeScope = NotificationCategory | "ALL";

/** Separate key per purpose, derived from the app secret, so these tokens can never double as sessions. */
const key = () => createHmac("sha256", env().JWT_SECRET).update("perigo:email-unsubscribe:v1").digest();

const sign = (payload: string) => createHmac("sha256", key()).update(payload).digest("base64url");

/**
 * Stateless one-click unsubscribe token: `<userId>.<scope>.<hmac>`. Emails
 * can't carry sessions, so the signature is what authorizes the change.
 */
export function unsubscribeToken(userId: string, scope: UnsubscribeScope) {
  const payload = `${userId}.${scope}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyUnsubscribeToken(token: string): { userId: string; scope: UnsubscribeScope } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, scope, signature] = parts as [string, string, string];
  const expected = Buffer.from(sign(`${userId}.${scope}`));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return { userId, scope: scope as UnsubscribeScope };
}
