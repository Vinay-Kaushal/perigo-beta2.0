import type { Request, Response } from "express";
import { z } from "zod";
import { Prisma, type OrganisationMember, type Ticket, type TicketStatus } from "db/client";
import { prisma } from "../lib/prisma";
import { publicUser, publicUserSelect } from "../lib/selects";
import { badRequest, conflict, forbidden, HttpError, notFound, param } from "../lib/http";
import { publishOrgEvent } from "../lib/eventBus";
import { currentUser } from "../middleware/auth";
import { getMembership, isOrgAdmin } from "../middleware/access";
import { audit } from "../services/audit";
import { notify } from "../services/notifications";
import { extractMentionIds, newMentionIds, stripMentionTokens } from "../lib/mentions";
import { deleteObjects } from "../lib/storage";
import { attachmentInclude, serialiseAttachment } from "./attachment.controller";
import { loadSlaContext } from "../services/sla";
import { initialTargets, resume, retarget } from "../domain/sla";
import {
  DONE_STATUSES,
  OPEN_STATUSES,
  TRANSITIONS,
  canAssignTicket,
  canEditTicket,
  checkStatusChange,
  SLA_RUNNING_STATUSES,
  isResponseBreached,
  isSlaBreached,
  ticketKey,
} from "../domain/tickets";

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
const TYPES = ["INCIDENT", "SERVICE_REQUEST", "PROBLEM", "CHANGE", "QUESTION"] as const;
const STATUSES = ["NEW", "OPEN", "IN_PROGRESS", "ON_HOLD", "RESOLVED", "CLOSED", "CANCELLED"] as const;

const STATUS_LABEL: Record<TicketStatus, string> = {
  NEW: "New",
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  ON_HOLD: "On hold",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

const listInclude = {
  requester: publicUser,
  assignee: publicUser,
  team: { select: { id: true, name: true } },
  _count: { select: { comments: true } },
} satisfies Prisma.TicketInclude;

type ListTicket = Prisma.TicketGetPayload<{ include: typeof listInclude }>;

export async function orgPrefix(orgId: string) {
  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: orgId }, select: { ticketPrefix: true } });
  return org.ticketPrefix;
}

function serialise<T extends Ticket>(ticket: T, prefix: string) {
  return {
    ...ticket,
    key: ticketKey(prefix, ticket.number),
    slaBreached: isSlaBreached(ticket),
    responseBreached: isResponseBreached(ticket),
    slaPaused: !!ticket.slaPausedAt,
  };
}

export const ticketLink = (t: Pick<Ticket, "organisationId" | "number">) => `/orgs/${t.organisationId}/tickets/${t.number}`;

/** :ticketRef accepts the per-org number ("42") or the uuid. Always scoped to the org. */
export async function loadTicket(req: Request) {
  const membership = getMembership(req);
  const ref = param(req, "ticketRef");
  const where = /^\d{1,9}$/.test(ref)
    ? { organisationId: membership.organisationId, number: Number(ref) }
    : { organisationId: membership.organisationId, id: ref };
  const ticket = await prisma.ticket.findFirst({ where });
  if (!ticket) throw notFound("Ticket not found");
  return { ticket, membership };
}

async function assertOrgMember(orgId: string, userId: string, label: string) {
  const m = await prisma.organisationMember.findUnique({
    where: { userId_organisationId: { userId, organisationId: orgId } },
    include: { user: { select: publicUserSelect } },
  });
  if (!m) throw badRequest(`${label} must be a member of this organisation`);
  return m;
}

async function assertOrgTeam(orgId: string, teamId: string) {
  const team = await prisma.team.findFirst({ where: { id: teamId, organisationId: orgId } });
  if (!team) throw badRequest("Team must belong to this organisation");
  return team;
}

export async function watcherIds(ticketId: string) {
  const rows = await prisma.ticketWatcher.findMany({ where: { ticketId }, select: { userId: true } });
  return rows.map((r) => r.userId);
}

const excerpt = (text: string) => {
  const plain = stripMentionTokens(text);
  return plain.length > 160 ? `${plain.slice(0, 157)}…` : plain;
};

/**
 * Notifies org members mentioned by id (anyone else is silently ignored, so
 * mentions can't be used to probe who exists) and makes them watchers.
 * Returns the ids that were notified.
 */
async function notifyMentions(
  ticket: Pick<Ticket, "id" | "organisationId" | "number" | "title">,
  mentionIds: string[],
  actor: { id: string; name: string },
  where: "comment" | "description",
  text: string
) {
  const ids = mentionIds.filter((id) => id !== actor.id);
  if (!ids.length) return [];
  const members = await prisma.organisationMember.findMany({
    where: { organisationId: ticket.organisationId, userId: { in: ids } },
    select: { userId: true },
  });
  const valid = members.map((m) => m.userId);
  if (!valid.length) return [];

  await prisma.ticketWatcher.createMany({
    data: valid.map((userId) => ({ ticketId: ticket.id, userId })),
    skipDuplicates: true,
  });
  const key = ticketKey(await orgPrefix(ticket.organisationId), ticket.number);
  await notify(valid, {
    type: "MENTIONED",
    title: `${actor.name} mentioned you ${where === "comment" ? "in a comment on" : "in"} ${key}`,
    body: excerpt(text),
    link: ticketLink(ticket),
    organisationId: ticket.organisationId,
    actorId: actor.id,
  });
  return valid;
}

// ---------------------------------------------------------------- create

const createSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(20_000).optional(),
  type: z.enum(TYPES).default("INCIDENT"),
  priority: z.enum(PRIORITIES).default("MEDIUM"),
  category: z.string().trim().max(60).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  teamId: z.string().uuid().nullable().optional(),
  requesterId: z.string().uuid().optional(),
  dueAt: z.coerce.date().optional(),
});

export async function createTicket(req: Request, res: Response) {
  const user = currentUser(req);
  const membership = getMembership(req);
  const orgId = membership.organisationId;
  const body = createSchema.parse(req.body);

  const requesterId = body.requesterId ?? user.id;
  if (requesterId !== user.id) {
    if (!isOrgAdmin(membership.role)) throw forbidden("Only owners and admins can raise tickets on behalf of others");
    await assertOrgMember(orgId, requesterId, "Requester");
  }
  const assignee = body.assigneeId ? await assertOrgMember(orgId, body.assigneeId, "Assignee") : null;
  const team = body.teamId ? await assertOrgTeam(orgId, body.teamId) : null;

  const now = new Date();
  const targets = initialTargets(await loadSlaContext(orgId), body.priority, now);
  const ticket = await prisma.$transaction(async (tx) => {
    // Atomic per-org sequence: the row lock on Organisation serialises concurrent creates.
    const org = await tx.organisation.update({
      where: { id: orgId },
      data: { ticketCounter: { increment: 1 } },
      select: { ticketCounter: true },
    });

    const created = await tx.ticket.create({
      data: {
        organisationId: orgId,
        number: org.ticketCounter,
        createdAt: now,
        title: body.title,
        description: body.description,
        type: body.type,
        priority: body.priority,
        category: body.category,
        status: assignee ? "OPEN" : "NEW",
        requesterId,
        createdById: user.id,
        assigneeId: assignee?.userId ?? null,
        teamId: team?.id ?? null,
        dueAt: body.dueAt ?? targets.dueAt,
        responseDueAt: targets.responseDueAt,
      },
      include: listInclude,
    });

    await tx.ticketEvent.create({ data: { ticketId: created.id, actorId: user.id, type: "CREATED" } });
    if (assignee) {
      await tx.ticketEvent.create({
        data: {
          ticketId: created.id,
          actorId: user.id,
          type: "ASSIGNED",
          metadata: { from: null, to: { id: assignee.userId, name: assignee.user.name } },
        },
      });
    }
    const watchers = new Set([requesterId, user.id, assignee?.userId].filter((v): v is string => !!v));
    await tx.ticketWatcher.createMany({
      data: [...watchers].map((userId) => ({ ticketId: created.id, userId })),
      skipDuplicates: true,
    });
    return created;
  });

  const prefix = await orgPrefix(orgId);
  const key = ticketKey(prefix, ticket.number);
  const link = ticketLink(ticket);

  if (assignee) {
    await notify([assignee.userId], {
      type: "TICKET_ASSIGNED",
      title: `${user.name} assigned ${key} to you`,
      body: ticket.title,
      link,
      organisationId: orgId,
      actorId: user.id,
    });
  } else if (team) {
    const teamMembers = await prisma.teamMember.findMany({
      where: { teamId: team.id },
      select: { organisationMember: { select: { userId: true } } },
    });
    await notify(
      teamMembers.map((m) => m.organisationMember.userId),
      { type: "TICKET_TEAM_QUEUE", title: `New ticket ${key} in ${team.name}'s queue`, body: ticket.title, link, organisationId: orgId, actorId: user.id }
    );
  }
  if (requesterId !== user.id) {
    await notify([requesterId], {
      type: "TICKET_RAISED_FOR_YOU",
      title: `${user.name} raised ${key} on your behalf`,
      body: ticket.title,
      link,
      organisationId: orgId,
      actorId: user.id,
    });
  }

  if (body.description) {
    await notifyMentions(ticket, extractMentionIds(body.description), user, "description", body.description);
  }

  const payload = serialise(ticket, prefix);
  await publishOrgEvent(orgId, "TICKET_CREATED", user.id, { id: ticket.id, number: ticket.number, key });
  res.status(201).json(payload);
}

// ---------------------------------------------------------------- list

const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .transform((s) => s.split(",").map((v) => v.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values)))
    .optional();

const listQuerySchema = z.object({
  status: z.union([z.literal("open"), z.literal("done")]).or(z.string()).optional(),
  priority: csv(PRIORITIES),
  type: csv(TYPES),
  assignee: z.union([z.literal("me"), z.literal("unassigned"), z.string().uuid()]).optional(),
  requester: z.union([z.literal("me"), z.string().uuid()]).optional(),
  team: z.union([z.literal("mine"), z.string().uuid()]).optional(),
  breached: z.enum(["true", "false"]).optional(),
  responseBreached: z.enum(["true", "false"]).optional(),
  q: z.string().trim().max(200).optional(),
  sort: z.enum(["createdAt", "updatedAt", "priority", "dueAt", "number"]).default("updatedAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

function parseStatusFilter(raw: string | undefined): TicketStatus[] | undefined {
  if (!raw) return undefined;
  if (raw === "open") return OPEN_STATUSES;
  if (raw === "done") return DONE_STATUSES;
  const parsed = z.array(z.enum(STATUSES)).safeParse(raw.split(",").map((s) => s.trim()));
  if (!parsed.success) throw badRequest("Invalid status filter");
  return parsed.data;
}

export async function listTickets(req: Request, res: Response) {
  const user = currentUser(req);
  const membership = getMembership(req);
  const orgId = membership.organisationId;
  const q = listQuerySchema.parse(req.query);
  const statuses = parseStatusFilter(q.status);

  const and: Prisma.TicketWhereInput[] = [{ organisationId: orgId }];
  if (statuses) and.push({ status: { in: statuses } });
  if (q.priority?.length) and.push({ priority: { in: q.priority } });
  if (q.type?.length) and.push({ type: { in: q.type } });
  if (q.assignee === "me") and.push({ assigneeId: user.id });
  else if (q.assignee === "unassigned") and.push({ assigneeId: null });
  else if (q.assignee) and.push({ assigneeId: q.assignee });
  if (q.requester) and.push({ requesterId: q.requester === "me" ? user.id : q.requester });
  if (q.team === "mine") {
    and.push({ team: { members: { some: { organisationMember: { userId: user.id } } } } });
  } else if (q.team) {
    and.push({ teamId: q.team });
  }
  if (q.breached === "true") and.push({ status: { in: SLA_RUNNING_STATUSES }, slaPausedAt: null, dueAt: { lt: new Date() } });
  // Still waiting for a first response past its target (matches the stats count).
  if (q.responseBreached === "true") {
    and.push({ status: { in: SLA_RUNNING_STATUSES }, slaPausedAt: null, firstResponseAt: null, responseDueAt: { lt: new Date() } });
  }
  if (q.q) {
    const numberMatch = q.q.match(/^(?:[A-Za-z]{2,6}-)?(\d{1,9})$/);
    and.push({
      OR: [
        { title: { contains: q.q, mode: "insensitive" } },
        ...(numberMatch ? [{ number: Number(numberMatch[1]) }] : []),
      ],
    });
  }

  const where: Prisma.TicketWhereInput = { AND: and };
  const orderBy: Prisma.TicketOrderByWithRelationInput[] = [
    q.sort === "dueAt" ? { dueAt: { sort: q.order, nulls: "last" } } : { [q.sort]: q.order },
    { number: "desc" },
  ];

  const [total, items, prefix] = await Promise.all([
    prisma.ticket.count({ where }),
    prisma.ticket.findMany({ where, include: listInclude, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    orgPrefix(orgId),
  ]);

  res.json({
    items: items.map((t: ListTicket) => serialise(t, prefix)),
    total,
    page: q.page,
    pageSize: q.pageSize,
  });
}

// ---------------------------------------------------------------- detail

function allowedTransitions(actor: { userId: string; role: OrganisationMember["role"] }, ticket: Ticket) {
  return TRANSITIONS[ticket.status].filter((to) => checkStatusChange(actor, ticket, to, "note") === null);
}

export async function getTicket(req: Request, res: Response) {
  const { ticket: base, membership } = await loadTicket(req);
  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id: base.id },
    include: {
      ...listInclude,
      createdBy: publicUser,
      watchers: { include: { user: publicUser }, orderBy: { createdAt: "asc" } },
      comments: { include: { author: publicUser, attachments: attachmentInclude }, orderBy: { createdAt: "asc" } },
      attachments: { ...attachmentInclude, orderBy: { createdAt: "asc" } },
      events: { include: { actor: publicUser }, orderBy: { createdAt: "asc" } },
    },
  });
  const prefix = await orgPrefix(ticket.organisationId);
  const actor = { userId: membership.userId, role: membership.role };

  res.json({
    ...serialise(ticket, prefix),
    watchers: ticket.watchers.map((w) => w.user),
    attachments: ticket.attachments.map(serialiseAttachment),
    comments: ticket.comments.map((c) => ({ ...c, attachments: c.attachments.map(serialiseAttachment) })),
    isWatching: ticket.watchers.some((w) => w.userId === membership.userId),
    permissions: {
      canEdit: canEditTicket(actor, ticket),
      canAssign: canAssignTicket(actor, ticket) && !["CLOSED", "CANCELLED"].includes(ticket.status),
      canDelete: isOrgAdmin(membership.role),
      allowedStatuses: allowedTransitions(actor, ticket),
    },
  });
}

// ---------------------------------------------------------------- update fields

const updateSchema = z
  .object({
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().max(20_000).nullable(),
    type: z.enum(TYPES),
    priority: z.enum(PRIORITIES),
    category: z.string().trim().max(60).nullable(),
    teamId: z.string().uuid().nullable(),
    dueAt: z.coerce.date().nullable(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, "Nothing to update");

export async function updateTicket(req: Request, res: Response) {
  const user = currentUser(req);
  const { ticket, membership } = await loadTicket(req);
  const body = updateSchema.parse(req.body);

  if (!canEditTicket({ userId: user.id, role: membership.role }, ticket)) {
    throw forbidden("Only the requester, assignee, or an admin can edit this ticket");
  }
  if (["CLOSED", "CANCELLED"].includes(ticket.status)) throw conflict("Reopen the ticket before editing it");

  const team = body.teamId ? await assertOrgTeam(ticket.organisationId, body.teamId) : null;
  const data: Prisma.TicketUncheckedUpdateInput = { ...body };
  const events: Prisma.TicketEventCreateManyInput[] = [];

  if (body.priority && body.priority !== ticket.priority) {
    events.push({ ticketId: ticket.id, actorId: user.id, type: "PRIORITY_CHANGED", metadata: { from: ticket.priority, to: body.priority } });
    // Re-derive the SLA target from the new priority unless a due date was set explicitly in this edit.
    const next = retarget(await loadSlaContext(ticket.organisationId), ticket, body.priority);
    if (body.dueAt === undefined) data.dueAt = next.dueAt;
    if (next.responseDueAt) data.responseDueAt = next.responseDueAt;
  }
  if (body.teamId !== undefined && body.teamId !== ticket.teamId) {
    const previous = ticket.teamId ? await prisma.team.findUnique({ where: { id: ticket.teamId }, select: { id: true, name: true } }) : null;
    events.push({
      ticketId: ticket.id,
      actorId: user.id,
      type: "TEAM_CHANGED",
      metadata: { from: previous, to: team ? { id: team.id, name: team.name } : null },
    });
  }
  const changedFields = (["title", "description", "type", "category", "dueAt"] as const).filter((f) => {
    if (body[f] === undefined) return false;
    const before = ticket[f] instanceof Date ? (ticket[f] as Date).toISOString() : ticket[f];
    const after = body[f] instanceof Date ? (body[f] as Date).toISOString() : body[f];
    return before !== after;
  });
  if (changedFields.length) {
    events.push({ ticketId: ticket.id, actorId: user.id, type: "UPDATED", metadata: { fields: changedFields } });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const t = await tx.ticket.update({ where: { id: ticket.id }, data, include: listInclude });
    if (events.length) await tx.ticketEvent.createMany({ data: events });
    return t;
  });

  const prefix = await orgPrefix(ticket.organisationId);
  const key = ticketKey(prefix, ticket.number);
  if (body.priority && body.priority !== ticket.priority) {
    await notify([...(await watcherIds(ticket.id)), ticket.assigneeId], {
      type: "TICKET_PRIORITY_CHANGED",
      title: `${user.name} changed ${key} priority to ${body.priority.toLowerCase()}`,
      body: ticket.title,
      link: ticketLink(ticket),
      organisationId: ticket.organisationId,
      actorId: user.id,
    });
  }

  if (body.description) {
    await notifyMentions(ticket, newMentionIds(ticket.description, body.description), user, "description", body.description);
  }

  await publishOrgEvent(ticket.organisationId, "TICKET_UPDATED", user.id, { id: ticket.id, number: ticket.number, key });
  res.json(serialise(updated, prefix));
}

// ---------------------------------------------------------------- assignment

const assignSchema = z.object({ assigneeId: z.string().uuid().nullable() });

export async function assignTicket(req: Request, res: Response) {
  const user = currentUser(req);
  const { ticket, membership } = await loadTicket(req);
  const { assigneeId } = assignSchema.parse(req.body);

  if (["CLOSED", "CANCELLED"].includes(ticket.status)) throw conflict("Reopen the ticket before reassigning it");
  if (!canAssignTicket({ userId: user.id, role: membership.role }, ticket)) {
    throw forbidden("Only the requester, current assignee, or an admin can reassign this ticket");
  }
  if (assigneeId === ticket.assigneeId) {
    const prefix = await orgPrefix(ticket.organisationId);
    const unchanged = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id }, include: listInclude });
    return res.json(serialise(unchanged, prefix));
  }

  const next = assigneeId ? await assertOrgMember(ticket.organisationId, assigneeId, "Assignee") : null;
  const previous = ticket.assigneeId
    ? await prisma.user.findUnique({ where: { id: ticket.assigneeId }, select: { id: true, name: true } })
    : null;

  const updated = await prisma.$transaction(async (tx) => {
    const t = await tx.ticket.update({
      where: { id: ticket.id },
      data: { assigneeId, status: next && ticket.status === "NEW" ? "OPEN" : undefined },
      include: listInclude,
    });
    await tx.ticketEvent.create({
      data: {
        ticketId: ticket.id,
        actorId: user.id,
        type: next ? "ASSIGNED" : "UNASSIGNED",
        metadata: { from: previous, to: next ? { id: next.userId, name: next.user.name } : null },
      },
    });
    if (next) {
      await tx.ticketWatcher.upsert({
        where: { ticketId_userId: { ticketId: ticket.id, userId: next.userId } },
        update: {},
        create: { ticketId: ticket.id, userId: next.userId },
      });
    }
    return t;
  });

  const prefix = await orgPrefix(ticket.organisationId);
  const key = ticketKey(prefix, ticket.number);
  const common = { link: ticketLink(ticket), organisationId: ticket.organisationId, actorId: user.id, body: ticket.title };

  if (next) {
    await notify([next.userId], { ...common, type: "TICKET_ASSIGNED", title: `${user.name} assigned ${key} to you` });
  }
  if (previous && previous.id !== next?.userId) {
    await notify([previous.id], {
      ...common,
      type: "TICKET_REASSIGNED",
      title: next ? `${user.name} reassigned ${key} to ${next.user.name}` : `${user.name} unassigned you from ${key}`,
    });
  }
  // Everyone else following the ticket learns who picked it up, and who made the call.
  const others = (await watcherIds(ticket.id)).filter((id) => id !== next?.userId && id !== previous?.id);
  await notify([...others, ticket.requesterId].filter((id) => id !== next?.userId && id !== previous?.id), {
    ...common,
    type: "TICKET_ASSIGNMENT_CHANGED",
    title: next ? `${user.name} assigned ${key} to ${next.user.name}` : `${user.name} unassigned ${key}`,
  });

  await publishOrgEvent(ticket.organisationId, "TICKET_ASSIGNED", user.id, {
    id: ticket.id,
    number: ticket.number,
    key,
    assigneeId,
    previousAssigneeId: previous?.id ?? null,
  });
  res.json(serialise(updated, prefix));
}

// ---------------------------------------------------------------- status

const statusSchema = z.object({
  status: z.enum(STATUSES),
  resolutionNote: z.string().trim().max(5000).optional(),
});

export async function changeTicketStatus(req: Request, res: Response) {
  const user = currentUser(req);
  const { ticket, membership } = await loadTicket(req);
  const { status, resolutionNote } = statusSchema.parse(req.body);

  const problem = checkStatusChange({ userId: user.id, role: membership.role }, ticket, status, resolutionNote);
  if (problem) throw new HttpError(problem.kind === "FORBIDDEN" ? 403 : 409, problem.message, problem.kind);

  const now = new Date();
  const data: Prisma.TicketUncheckedUpdateInput = { status };
  if (status === "RESOLVED") Object.assign(data, { resolvedAt: now, resolutionNote });
  if (status === "CLOSED") Object.assign(data, { closedAt: now, resolvedAt: ticket.resolvedAt ?? now });
  if (status === "CANCELLED") Object.assign(data, { closedAt: now });
  if (OPEN_STATUSES.includes(status) && DONE_STATUSES.includes(ticket.status)) {
    Object.assign(data, { resolvedAt: null, closedAt: null });
  }

  // SLA pause: the clock stops while on hold and resumes with the targets pushed out by the paused business time.
  let pausedMinutes: number | undefined;
  if (status === "ON_HOLD" && !ticket.slaPausedAt) {
    data.slaPausedAt = now;
  } else if (ticket.slaPausedAt && status !== "ON_HOLD") {
    const { pausedMinutes: minutes, ...resumed } = resume(await loadSlaContext(ticket.organisationId), ticket, now);
    Object.assign(data, resumed);
    pausedMinutes = minutes;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const t = await tx.ticket.update({ where: { id: ticket.id }, data, include: listInclude });
    await tx.ticketEvent.create({
      data: {
        ticketId: ticket.id,
        actorId: user.id,
        type: "STATUS_CHANGED",
        metadata: {
          from: ticket.status,
          to: status,
          ...(resolutionNote ? { note: resolutionNote } : {}),
          ...(pausedMinutes !== undefined ? { slaPausedMinutes: pausedMinutes } : {}),
        },
      },
    });
    return t;
  });

  const prefix = await orgPrefix(ticket.organisationId);
  const key = ticketKey(prefix, ticket.number);
  await notify([ticket.requesterId, ticket.assigneeId, ...(await watcherIds(ticket.id))], {
    type: "TICKET_STATUS_CHANGED",
    title: `${user.name} moved ${key} to ${STATUS_LABEL[status]}`,
    body: status === "RESOLVED" && resolutionNote ? resolutionNote.slice(0, 200) : ticket.title,
    link: ticketLink(ticket),
    organisationId: ticket.organisationId,
    actorId: user.id,
  });

  await publishOrgEvent(ticket.organisationId, "TICKET_STATUS_CHANGED", user.id, {
    id: ticket.id,
    number: ticket.number,
    key,
    from: ticket.status,
    to: status,
  });
  res.json(serialise(updated, prefix));
}

// ---------------------------------------------------------------- comments

const commentSchema = z.object({ body: z.string().trim().min(1).max(10_000) });

const newCommentSchema = z
  .object({
    body: z.string().trim().max(10_000).default(""),
    attachmentIds: z.array(z.string().uuid()).max(10).default([]),
  })
  .refine((c) => c.body.length > 0 || c.attachmentIds.length > 0, { message: "Write a comment or attach a file", path: ["body"] });

export async function addTicketComment(req: Request, res: Response) {
  const user = currentUser(req);
  const { ticket } = await loadTicket(req);
  const { body, attachmentIds } = newCommentSchema.parse(req.body);

  const comment = await prisma.$transaction(async (tx) => {
    const c = await tx.ticketComment.create({
      data: { ticketId: ticket.id, authorId: user.id, body },
    });
    // Only the author's own, not-yet-linked uploads on this ticket can be attached. One conditional
    // update both claims and verifies them, so two comments can't race for the same file; a
    // mismatch throws and rolls the whole comment back.
    const wanted = [...new Set(attachmentIds)];
    if (wanted.length) {
      const linked = await tx.ticketAttachment.updateMany({
        where: { id: { in: wanted }, ticketId: ticket.id, uploaderId: user.id, commentId: null },
        data: { commentId: c.id },
      });
      if (linked.count !== wanted.length) throw badRequest("Some attachments can't be added to this comment");
    }
    await tx.ticketWatcher.upsert({
      where: { ticketId_userId: { ticketId: ticket.id, userId: user.id } },
      update: {},
      create: { ticketId: ticket.id, userId: user.id },
    });
    // First response SLA: the first reply from anyone other than the requester.
    await tx.ticket.update({
      where: { id: ticket.id },
      data: {
        updatedAt: new Date(),
        ...(!ticket.firstResponseAt && user.id !== ticket.requesterId ? { firstResponseAt: new Date() } : {}),
      },
    });
    return tx.ticketComment.findUniqueOrThrow({
      where: { id: c.id },
      include: { author: publicUser, attachments: attachmentInclude },
    });
  });

  const prefix = await orgPrefix(ticket.organisationId);
  const key = ticketKey(prefix, ticket.number);
  // Mentioned people get a "mentioned you" notification instead of the generic "commented" one.
  const mentioned = await notifyMentions(ticket, extractMentionIds(body), user, "comment", body);
  const fileNote = comment.attachments.length ? `📎 ${comment.attachments.map((a) => a.fileName).join(", ")}` : "";
  await notify(
    [ticket.requesterId, ticket.assigneeId, ...(await watcherIds(ticket.id))].filter((id) => !id || !mentioned.includes(id)),
    {
      type: "TICKET_COMMENTED",
      title: `${user.name} commented on ${key}`,
      body: body ? excerpt(body) : fileNote,
      link: ticketLink(ticket),
      organisationId: ticket.organisationId,
      actorId: user.id,
    }
  );
  await publishOrgEvent(ticket.organisationId, "TICKET_COMMENTED", user.id, { id: ticket.id, number: ticket.number, key });
  res.status(201).json({ ...comment, attachments: comment.attachments.map(serialiseAttachment) });
}

async function loadComment(req: Request) {
  const { ticket, membership } = await loadTicket(req);
  const comment = await prisma.ticketComment.findFirst({ where: { id: param(req, "commentId"), ticketId: ticket.id } });
  if (!comment) throw notFound("Comment not found");
  return { ticket, membership, comment };
}

export async function updateTicketComment(req: Request, res: Response) {
  const user = currentUser(req);
  const { ticket, comment } = await loadComment(req);
  if (comment.authorId !== user.id) throw forbidden("You can only edit your own comments");
  const { body } = commentSchema.parse(req.body);
  const updated = await prisma.ticketComment.update({
    where: { id: comment.id },
    data: { body },
    include: { author: publicUser, attachments: attachmentInclude },
  });
  await notifyMentions(ticket, newMentionIds(comment.body, body), user, "comment", body);
  await publishOrgEvent(ticket.organisationId, "TICKET_COMMENTED", user.id, { id: ticket.id, number: ticket.number });
  res.json({ ...updated, attachments: updated.attachments.map(serialiseAttachment) });
}

export async function deleteTicketComment(req: Request, res: Response) {
  const user = currentUser(req);
  const { ticket, membership, comment } = await loadComment(req);
  if (comment.authorId !== user.id && !isOrgAdmin(membership.role)) {
    throw forbidden("You can only delete your own comments");
  }
  await prisma.ticketComment.delete({ where: { id: comment.id } });
  await publishOrgEvent(ticket.organisationId, "TICKET_COMMENTED", user.id, { id: ticket.id, number: ticket.number });
  res.status(204).send();
}

// ---------------------------------------------------------------- watching / delete

export async function watchTicket(req: Request, res: Response) {
  const user = currentUser(req);
  const { ticket } = await loadTicket(req);
  await prisma.ticketWatcher.upsert({
    where: { ticketId_userId: { ticketId: ticket.id, userId: user.id } },
    update: {},
    create: { ticketId: ticket.id, userId: user.id },
  });
  res.status(204).send();
}

export async function unwatchTicket(req: Request, res: Response) {
  const user = currentUser(req);
  const { ticket } = await loadTicket(req);
  await prisma.ticketWatcher.deleteMany({ where: { ticketId: ticket.id, userId: user.id } });
  res.status(204).send();
}

export async function deleteTicket(req: Request, res: Response) {
  const { ticket } = await loadTicket(req);
  const files = await prisma.ticketAttachment.findMany({ where: { ticketId: ticket.id }, select: { storageKey: true } });
  await prisma.ticket.delete({ where: { id: ticket.id } });
  await deleteObjects(files.map((f) => f.storageKey));
  const prefix = await orgPrefix(ticket.organisationId);
  await audit(req, {
    organisationId: ticket.organisationId,
    action: "ticket.deleted",
    targetType: "ticket",
    targetId: ticket.id,
    metadata: { key: ticketKey(prefix, ticket.number), title: ticket.title },
  });
  await publishOrgEvent(ticket.organisationId, "TICKET_DELETED", req.user!.id, { id: ticket.id, number: ticket.number });
  res.status(204).send();
}

// ---------------------------------------------------------------- stats

const DAY = 24 * 60 * 60 * 1000;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export async function ticketStats(req: Request, res: Response) {
  const user = currentUser(req);
  const membership = getMembership(req);
  const orgId = membership.organisationId;
  const now = new Date();
  const since14 = new Date(now.getTime() - 13 * DAY);
  since14.setUTCHours(0, 0, 0, 0);
  const since30 = new Date(now.getTime() - 30 * DAY);
  const open = { organisationId: orgId, status: { in: OPEN_STATUSES } };
  const running = { organisationId: orgId, status: { in: SLA_RUNNING_STATUSES }, slaPausedAt: null };

  const [byStatus, byPriority, byType, unassigned, breached, mine, created14, resolved14, resolved30, byAssignee, responseBreached, paused] =
    await Promise.all([
      prisma.ticket.groupBy({ by: ["status"], where: { organisationId: orgId }, _count: { _all: true } }),
      prisma.ticket.groupBy({ by: ["priority"], where: open, _count: { _all: true } }),
      prisma.ticket.groupBy({ by: ["type"], where: open, _count: { _all: true } }),
      prisma.ticket.count({ where: { ...open, assigneeId: null } }),
      prisma.ticket.count({ where: { ...running, dueAt: { lt: now } } }),
      prisma.ticket.count({ where: { ...open, assigneeId: user.id } }),
      prisma.ticket.findMany({ where: { organisationId: orgId, createdAt: { gte: since14 } }, select: { createdAt: true } }),
      prisma.ticket.findMany({ where: { organisationId: orgId, resolvedAt: { gte: since14 } }, select: { resolvedAt: true } }),
      prisma.ticket.findMany({
        where: { organisationId: orgId, resolvedAt: { gte: since30 } },
        select: { createdAt: true, resolvedAt: true, dueAt: true },
        take: 5000,
      }),
      prisma.ticket.groupBy({ by: ["assigneeId"], where: { ...open, assigneeId: { not: null } }, _count: { _all: true } }),
      prisma.ticket.count({ where: { ...running, firstResponseAt: null, responseDueAt: { lt: now } } }),
      prisma.ticket.count({ where: { organisationId: orgId, slaPausedAt: { not: null } } }),
    ]);

  const trend = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(since14.getTime() + i * DAY);
    return { date: dayKey(d), created: 0, resolved: 0 };
  });
  const trendIndex = new Map(trend.map((t, i) => [t.date, i]));
  for (const t of created14) {
    const i = trendIndex.get(dayKey(t.createdAt));
    if (i !== undefined) trend[i]!.created++;
  }
  for (const t of resolved14) {
    const i = trendIndex.get(dayKey(t.resolvedAt!));
    if (i !== undefined) trend[i]!.resolved++;
  }

  const resolutionHours = resolved30.map((t) => (t.resolvedAt!.getTime() - t.createdAt.getTime()) / 3_600_000);
  const withSla = resolved30.filter((t) => t.dueAt);
  const metSla = withSla.filter((t) => t.resolvedAt! <= t.dueAt!);

  const assigneeUsers = await prisma.user.findMany({
    where: { id: { in: byAssignee.map((a) => a.assigneeId!) } },
    select: publicUserSelect,
  });
  const userById = new Map(assigneeUsers.map((u) => [u.id, u]));

  const statusCounts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<TicketStatus, number>;
  for (const g of byStatus) statusCounts[g.status] = g._count._all;

  res.json({
    total: byStatus.reduce((n, g) => n + g._count._all, 0),
    open: OPEN_STATUSES.reduce((n, s) => n + statusCounts[s], 0),
    unassigned,
    breached,
    responseBreached,
    paused,
    assignedToMe: mine,
    byStatus: statusCounts,
    byPriority: Object.fromEntries(PRIORITIES.map((p) => [p, byPriority.find((g) => g.priority === p)?._count._all ?? 0])),
    byType: Object.fromEntries(TYPES.map((t) => [t, byType.find((g) => g.type === t)?._count._all ?? 0])),
    trend,
    avgResolutionHours: resolutionHours.length
      ? Math.round((resolutionHours.reduce((a, b) => a + b, 0) / resolutionHours.length) * 10) / 10
      : null,
    slaCompliance: withSla.length ? Math.round((metSla.length / withSla.length) * 1000) / 10 : null,
    workload: byAssignee
      .map((a) => ({ user: userById.get(a.assigneeId!) ?? null, open: a._count._all }))
      .filter((w) => w.user)
      .sort((a, b) => b.open - a.open),
  });
}
