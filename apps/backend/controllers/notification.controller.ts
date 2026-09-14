import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { publicUser } from "../lib/selects";
import { notFound, param } from "../lib/http";
import { publishUserEvent } from "../lib/eventBus";
import { currentUser } from "../middleware/auth";
import { CATEGORIES, resolveSettings } from "../domain/notifications";
import { verifyUnsubscribeToken } from "../lib/unsubscribe";
import { HttpError } from "../lib/http";

const listQuerySchema = z.object({
  unread: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().uuid().optional(),
});

export async function listNotifications(req: Request, res: Response) {
  const user = currentUser(req);
  const q = listQuerySchema.parse(req.query);
  const rows = await prisma.notification.findMany({
    where: { userId: user.id, ...(q.unread === "true" ? { readAt: null } : {}) },
    include: { actor: publicUser, organisation: { select: { id: true, name: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: q.limit + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > q.limit;
  const items = hasMore ? rows.slice(0, q.limit) : rows;
  const unreadCount = await prisma.notification.count({ where: { userId: user.id, readAt: null } });
  res.json({ items, unreadCount, nextCursor: hasMore ? items[items.length - 1]!.id : null });
}

export async function unreadCount(req: Request, res: Response) {
  const user = currentUser(req);
  const count = await prisma.notification.count({ where: { userId: user.id, readAt: null } });
  res.json({ count });
}

export async function markRead(req: Request, res: Response) {
  const user = currentUser(req);
  const result = await prisma.notification.updateMany({
    where: { id: param(req, "notificationId"), userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
  if (result.count === 0) {
    const exists = await prisma.notification.findFirst({ where: { id: param(req, "notificationId"), userId: user.id } });
    if (!exists) throw notFound("Notification not found");
  }
  await publishUserEvent(user.id, "NOTIFICATIONS_READ", user.id, { ids: [param(req, "notificationId")] });
  res.status(204).send();
}

export async function markAllRead(req: Request, res: Response) {
  const user = currentUser(req);
  await prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
  await publishUserEvent(user.id, "NOTIFICATIONS_READ", user.id, { all: true });
  res.status(204).send();
}

const CATEGORY_NAMES = CATEGORIES.map((c) => c.category) as [string, ...string[]];

async function preferencesFor(userId: string) {
  const [rows, user] = await Promise.all([
    prisma.notificationSetting.findMany({ where: { userId } }),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { emailVerifiedAt: true } }),
  ]);
  const settings = resolveSettings(rows);
  return {
    emailVerified: !!user.emailVerifiedAt,
    categories: CATEGORIES.map((c) => ({ category: c.category, label: c.label, description: c.description, ...settings[c.category] })),
  };
}

export async function getPreferences(req: Request, res: Response) {
  res.json(await preferencesFor(currentUser(req).id));
}

const updatePreferencesSchema = z.object({
  categories: z
    .array(
      z
        .object({ category: z.enum(CATEGORY_NAMES), inApp: z.boolean().optional(), email: z.boolean().optional() })
        .refine((c) => c.inApp !== undefined || c.email !== undefined, "Nothing to update")
    )
    .min(1)
    .max(CATEGORIES.length),
});

export async function updatePreferences(req: Request, res: Response) {
  const user = currentUser(req);
  const { categories } = updatePreferencesSchema.parse(req.body);
  const current = resolveSettings(await prisma.notificationSetting.findMany({ where: { userId: user.id } }));

  await prisma.$transaction(
    categories.map((c) => {
      const category = c.category as keyof typeof current;
      const next = { inApp: c.inApp ?? current[category].inApp, email: c.email ?? current[category].email };
      return prisma.notificationSetting.upsert({
        where: { userId_category: { userId: user.id, category } },
        update: next,
        create: { userId: user.id, category, ...next },
      });
    })
  );
  res.json(await preferencesFor(user.id));
}

const unsubscribeSchema = z.object({ token: z.string().min(10).max(300) });

/**
 * One-click unsubscribe from an email link. Accepts the token in the body (our
 * page) or the query string (RFC 8058 List-Unsubscribe-Post from mail clients).
 * The HMAC signature is the authorization; no session needed.
 */
export async function unsubscribe(req: Request, res: Response) {
  const { token } = unsubscribeSchema.parse({ token: req.body?.token ?? req.query.token });
  const parsed = verifyUnsubscribeToken(token);
  if (!parsed) throw new HttpError(400, "This unsubscribe link is invalid", "INVALID_TOKEN");

  const user = await prisma.user.findUnique({ where: { id: parsed.userId }, select: { id: true } });
  if (!user) throw new HttpError(400, "This unsubscribe link is invalid", "INVALID_TOKEN");

  const scopes = parsed.scope === "ALL" ? CATEGORIES.map((c) => c.category) : CATEGORIES.filter((c) => c.category === parsed.scope).map((c) => c.category);
  if (!scopes.length) throw new HttpError(400, "This unsubscribe link is invalid", "INVALID_TOKEN");

  const current = resolveSettings(await prisma.notificationSetting.findMany({ where: { userId: user.id } }));
  await prisma.$transaction(
    scopes.map((category) =>
      prisma.notificationSetting.upsert({
        where: { userId_category: { userId: user.id, category } },
        update: { email: false },
        create: { userId: user.id, category, inApp: current[category].inApp, email: false },
      })
    )
  );
  res.json({ unsubscribed: parsed.scope, categories: scopes });
}
