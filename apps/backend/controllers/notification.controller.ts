import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { publicUser } from "../lib/selects";
import { notFound, param } from "../lib/http";
import { publishUserEvent } from "../lib/eventBus";
import { currentUser } from "../middleware/auth";

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
