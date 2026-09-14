import { prisma } from "../lib/prisma";
import { publishUserEvent } from "../lib/eventBus";

export interface NotifyInput {
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  organisationId?: string | null;
  actorId?: string | null;
}

/**
 * Persists one in-app notification per recipient and pushes it live over
 * `user:<id>`. The actor is always excluded — nobody needs to be told about
 * their own action.
 */
export async function notify(recipientIds: Iterable<string | null | undefined>, input: NotifyInput) {
  const unique = [...new Set([...recipientIds].filter((id): id is string => !!id && id !== input.actorId))];
  if (unique.length === 0) return;

  const actor = input.actorId
    ? await prisma.user.findUnique({ where: { id: input.actorId }, select: { id: true, name: true, avatarUrl: true } })
    : null;

  const created = await prisma.$transaction(
    unique.map((userId) =>
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
  );

  await Promise.all(
    created.map((n) => publishUserEvent(n.userId, "NOTIFICATION_CREATED", input.actorId ?? null, { ...n, actor }))
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
