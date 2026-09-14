import { prisma } from "../lib/prisma";
import { publishUserEvent } from "../lib/eventBus";
import { categoryFor, resolveSettings } from "../domain/notifications";
import { queueNotificationEmail } from "./emailQueue";

export interface NotifyInput {
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  organisationId?: string | null;
  actorId?: string | null;
}

/**
 * Delivers one notification to each recipient according to their preferences:
 * an in-app notification pushed live over `user:<id>`, and/or a queued email
 * (batched and sent by the email worker). The actor is always excluded.
 */
export async function notify(recipientIds: Iterable<string | null | undefined>, input: NotifyInput) {
  const unique = [...new Set([...recipientIds].filter((id): id is string => !!id && id !== input.actorId))];
  if (unique.length === 0) return;

  const category = categoryFor(input.type);
  const [users, actor, organisation] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, emailVerifiedAt: true, notificationSettings: { where: { category } } },
    }),
    input.actorId ? prisma.user.findUnique({ where: { id: input.actorId }, select: { id: true, name: true, avatarUrl: true } }) : null,
    input.organisationId ? prisma.organisation.findUnique({ where: { id: input.organisationId }, select: { name: true } }) : null,
  ]);

  const plan = users.map((u) => ({ user: u, setting: resolveSettings(u.notificationSettings)[category] }));

  const inApp = plan.filter((p) => p.setting.inApp).map((p) => p.user.id);
  const created = inApp.length
    ? await prisma.$transaction(
        inApp.map((userId) =>
          prisma.notification.create({
            data: {
              userId,
              type: input.type,
              title: input.title,
              body: input.body ?? null,
              link: input.link ?? null,
              organisationId: input.organisationId ?? null,
              actorId: input.actorId ?? null,
            },
          })
        )
      )
    : [];
  const notificationIdFor = new Map(created.map((n) => [n.userId, n.id]));

  await Promise.all(created.map((n) => publishUserEvent(n.userId, "NOTIFICATION_CREATED", input.actorId ?? null, { ...n, actor })));

  // Email is best-effort and asynchronous: a queue hiccup must not fail the user's action.
  const emailRecipients = plan.filter((p) => p.setting.email && p.user.emailVerifiedAt);
  await Promise.all(
    emailRecipients.map((p) =>
      queueNotificationEmail(p.user.id, {
        notificationId: notificationIdFor.get(p.user.id) ?? null,
        category,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
        organisationName: organisation?.name ?? null,
        createdAt: new Date().toISOString(),
      }).catch((err) => console.error(`[notify] couldn't queue email for ${p.user.id}`, err))
    )
  );
}

/** Owners and admins of an org — the approvers for join requests and expenses. */
export async function orgAdminIds(organisationId: string) {
  const admins = await prisma.organisationMember.findMany({
    where: { organisationId, role: { in: ["OWNER", "ADMIN"] } },
    select: { userId: true },
  });
  return admins.map((a) => a.userId);
}
