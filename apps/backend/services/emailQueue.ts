import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { env } from "../lib/env";
import { deliverMail, type MailMessage } from "../lib/mailer";
import { resolveSettings } from "../domain/notifications";
import { renderNotificationEmail, type EmailItem } from "./emailTemplates";

/**
 * Notification email pipeline, all in Redis so any number of API instances
 * can share it:
 *
 *   email:pending:<userId>  list of items waiting to be batched for that user
 *   email:flush             zset userId -> when the batch is due (set once per window)
 *   email:retry             zset job -> when to retry a failed delivery
 *   email:dead              list of deliveries that failed MAX_ATTEMPTS times
 *
 * No email is sent twice by concurrent workers: a user's pending items are
 * drained with one atomic LRANGE+DEL, and ZREM claims keep workers from even
 * attempting the same batch or retry.
 */
const PENDING = (userId: string) => `email:pending:${userId}`;
const FLUSH = "email:flush";
const RETRY = "email:retry";
const DEAD = "email:dead";
export const MAX_ATTEMPTS = 5;
const PENDING_TTL_SEC = 7 * 24 * 60 * 60;

interface DeliveryJob {
  id: string;
  userId: string;
  attempts: number;
  message: MailMessage;
}

export async function queueNotificationEmail(userId: string, item: EmailItem) {
  const due = Date.now() + env().EMAIL_BATCH_WINDOW_SEC * 1000;
  await redis()
    .multi()
    .rpush(PENDING(userId), JSON.stringify(item))
    .expire(PENDING(userId), PENDING_TTL_SEC)
    // NX: the first notification opens the window; later ones join the same email.
    .zadd(FLUSH, "NX", due, userId)
    .exec();
}

export interface TickStats {
  sent: number;
  skipped: number;
  retried: number;
  dead: number;
}

/** Backoff: 30s, 1m, 2m, 4m … capped at an hour. */
export const retryDelayMs = (attempts: number) => Math.min(60 * 60 * 1000, 30_000 * 2 ** Math.max(0, attempts - 1));

async function attempt(job: DeliveryJob, stats: TickStats, now: number) {
  try {
    await deliverMail(job.message);
    stats.sent++;
  } catch (err) {
    const attempts = job.attempts + 1;
    const reason = err instanceof Error ? err.message : String(err);
    if (attempts >= MAX_ATTEMPTS) {
      await redis().multi().lpush(DEAD, JSON.stringify({ ...job, attempts, error: reason, failedAt: new Date(now).toISOString() })).ltrim(DEAD, 0, 999).exec();
      console.error(`[email] giving up on ${job.id} to user ${job.userId} after ${attempts} attempts: ${reason}`);
      stats.dead++;
    } else {
      await redis().zadd(RETRY, now + retryDelayMs(attempts), JSON.stringify({ ...job, attempts }));
      stats.retried++;
    }
  }
}

async function deliverBatch(userId: string, items: EmailItem[], stats: TickStats, now: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, emailVerifiedAt: true, notificationSettings: true },
  });
  // Never email unverified addresses — a typo'd or someone else's address shouldn't receive org data.
  if (!user || !user.emailVerifiedAt) return void stats.skipped++;

  // Preferences are checked again at send time: the user may have switched email off since.
  const settings = resolveSettings(user.notificationSettings);
  let wanted = items.filter((i) => settings[i.category].email);

  // Don't email what the user has already seen in the app.
  const ids = wanted.map((i) => i.notificationId).filter((id): id is string => !!id);
  if (ids.length) {
    const unread = new Set(
      (await prisma.notification.findMany({ where: { id: { in: ids }, userId, readAt: null }, select: { id: true } })).map((n) => n.id)
    );
    wanted = wanted.filter((i) => !i.notificationId || unread.has(i.notificationId));
  }
  if (!wanted.length) return void stats.skipped++;

  await attempt({ id: randomUUID(), userId, attempts: 0, message: renderNotificationEmail(user, wanted) }, stats, now);
}

/** One pass of the worker. Exported so tests can drive it deterministically. */
export async function runEmailWorkerTick(now = Date.now()): Promise<TickStats> {
  const stats: TickStats = { sent: 0, skipped: 0, retried: 0, dead: 0 };
  const r = redis();

  for (const userId of await r.zrangebyscore(FLUSH, 0, now, "LIMIT", 0, 200)) {
    if ((await r.zrem(FLUSH, userId)) !== 1) continue; // another worker claimed it
    const result = await r.multi().lrange(PENDING(userId), 0, -1).del(PENDING(userId)).exec();
    const raw = (result?.[0]?.[1] as string[] | undefined) ?? [];
    const items = raw.flatMap((line) => {
      try {
        return [JSON.parse(line) as EmailItem];
      } catch {
        return [];
      }
    });
    if (items.length) await deliverBatch(userId, items, stats, now);
  }

  for (const raw of await r.zrangebyscore(RETRY, 0, now, "LIMIT", 0, 200)) {
    if ((await r.zrem(RETRY, raw)) !== 1) continue;
    await attempt(JSON.parse(raw) as DeliveryJob, stats, now);
  }

  return stats;
}

export async function deadLetters(limit = 50) {
  return (await redis().lrange(DEAD, 0, limit - 1)).map((line) => JSON.parse(line));
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startEmailWorker() {
  if (timer) return;
  let running = false;
  timer = setInterval(async () => {
    if (running) return; // never overlap ticks
    running = true;
    try {
      const stats = await runEmailWorkerTick();
      if (stats.sent || stats.dead) console.info(`[email] sent=${stats.sent} retried=${stats.retried} dead=${stats.dead} skipped=${stats.skipped}`);
    } catch (err) {
      console.error("[email] worker tick failed", err);
    } finally {
      running = false;
    }
  }, env().EMAIL_WORKER_INTERVAL_MS);
}

export function stopEmailWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
