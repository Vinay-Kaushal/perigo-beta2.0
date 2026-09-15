/**
 * Demo data for local development: one organisation with an owner, an admin
 * and two members, teams, tickets across every status, a board, expenses and
 * goals — plus a pending join request to approve.
 *
 *   bun run seed            (uses DATABASE_URL from .env)
 *
 * Refuses to run when NODE_ENV=production. Idempotent: re-running removes the
 * previous demo org (slug "acme-demo") and its demo users first.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { initialTargets, resolvePolicies } from "../domain/sla";
import { ALWAYS_OPEN } from "../domain/businessHours";
import { sha256, randomToken } from "../lib/tokens";

if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed a production database");

const PASSWORD = "Password123";
const DAY = 86_400_000;
const ago = (days: number, hours = 0) => new Date(Date.now() - days * DAY - hours * 3_600_000);

async function main() {
  const emails = ["owner@acme.test", "admin@acme.test", "alex@acme.test", "sam@acme.test", "jordan@acme.test"];
  await prisma.organisation.deleteMany({ where: { slug: "acme-demo" } });
  await prisma.user.deleteMany({ where: { email: { in: emails } } });

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const [owner, admin, alex, sam, jordan] = await Promise.all(
    [
      ["owner@acme.test", "Priya Shah"],
      ["admin@acme.test", "Marcus Chen"],
      ["alex@acme.test", "Alex Rivera"],
      ["sam@acme.test", "Sam Okafor"],
      ["jordan@acme.test", "Jordan Lee"],
    ].map(([email, name]) => prisma.user.create({ data: { email: email!, name: name!, passwordHash, emailVerifiedAt: new Date() } }))
  );

  const org = await prisma.organisation.create({
    data: { name: "Acme Corp", slug: "acme-demo", description: "IT & operations workspace", ticketPrefix: "ACME", requireJoinApproval: true },
  });
  const [mOwner, mAdmin, mAlex, mSam] = await Promise.all([
    prisma.organisationMember.create({ data: { userId: owner!.id, organisationId: org.id, role: "OWNER" } }),
    prisma.organisationMember.create({ data: { userId: admin!.id, organisationId: org.id, role: "ADMIN" } }),
    prisma.organisationMember.create({ data: { userId: alex!.id, organisationId: org.id, role: "MEMBER" } }),
    prisma.organisationMember.create({ data: { userId: sam!.id, organisationId: org.id, role: "MEMBER" } }),
  ]);

  const itTeam = await prisma.team.create({ data: { name: "IT Support", organisationId: org.id } });
  const netTeam = await prisma.team.create({ data: { name: "Network", organisationId: org.id } });
  await prisma.teamMember.createMany({
    data: [
      { teamId: itTeam.id, organisationMemberId: mAlex.id },
      { teamId: itTeam.id, organisationMemberId: mAdmin.id },
      { teamId: netTeam.id, organisationMemberId: mSam.id },
    ],
  });

  const ticketSpecs = [
    { title: "VPN disconnects every 10 minutes", type: "INCIDENT", priority: "URGENT", status: "IN_PROGRESS", requester: sam, assignee: alex, team: netTeam, created: ago(0, 6) },
    { title: "New laptop for incoming designer", type: "SERVICE_REQUEST", priority: "MEDIUM", status: "OPEN", requester: owner, assignee: alex, team: itTeam, created: ago(2) },
    { title: "Printer on 3rd floor jams constantly", type: "INCIDENT", priority: "LOW", status: "NEW", requester: alex, assignee: null, team: itTeam, created: ago(1) },
    { title: "Grant finance access to billing dashboard", type: "SERVICE_REQUEST", priority: "HIGH", status: "OPEN", requester: admin, assignee: sam, team: null, created: ago(3) },
    { title: "Email delivery delays to external domains", type: "PROBLEM", priority: "HIGH", status: "ON_HOLD", requester: owner, assignee: admin, team: null, created: ago(5) },
    { title: "Upgrade office Wi-Fi controllers", type: "CHANGE", priority: "MEDIUM", status: "RESOLVED", requester: admin, assignee: sam, team: netTeam, created: ago(9), resolved: ago(2) },
    { title: "How do I set up MFA on my phone?", type: "QUESTION", priority: "LOW", status: "CLOSED", requester: sam, assignee: alex, team: itTeam, created: ago(12), resolved: ago(11) },
    { title: "Shared drive permissions broken for Sales", type: "INCIDENT", priority: "HIGH", status: "RESOLVED", requester: alex, assignee: admin, team: itTeam, created: ago(6), resolved: ago(4) },
    { title: "Conference room display flickers", type: "INCIDENT", priority: "MEDIUM", status: "OPEN", requester: owner, assignee: null, team: null, created: ago(4) },
  ] as const;

  let number = 0;
  for (const spec of ticketSpecs) {
    number++;
    const done = spec.status === "RESOLVED" || spec.status === "CLOSED";
    const ticket = await prisma.ticket.create({
      data: {
        organisationId: org.id,
        number,
        title: spec.title,
        description: "Seeded demo ticket. Try assigning it, commenting, or moving it through the workflow.",
        type: spec.type,
        priority: spec.priority,
        status: spec.status,
        requesterId: spec.requester!.id,
        createdById: spec.requester!.id,
        assigneeId: spec.assignee?.id ?? null,
        teamId: spec.team?.id ?? null,
        createdAt: spec.created,
        ...initialTargets({ schedule: ALWAYS_OPEN, policies: resolvePolicies([]) }, spec.priority, spec.created),
        firstResponseAt: spec.assignee ? new Date(spec.created.getTime() + 3_600_000) : null,
        // On-hold tickets were parked a couple of hours in, so their SLA clock is stopped.
        slaPausedAt: spec.status === "ON_HOLD" ? new Date(spec.created.getTime() + 2 * 3_600_000) : null,
        resolvedAt: done && "resolved" in spec ? spec.resolved : null,
        closedAt: spec.status === "CLOSED" && "resolved" in spec ? spec.resolved : null,
        resolutionNote: done ? "Root cause fixed and confirmed with the requester." : null,
      },
    });
    await prisma.ticketEvent.create({ data: { ticketId: ticket.id, actorId: spec.requester!.id, type: "CREATED", createdAt: spec.created } });
    if (spec.assignee) {
      await prisma.ticketEvent.create({
        data: { ticketId: ticket.id, actorId: admin!.id, type: "ASSIGNED", metadata: { from: null, to: { id: spec.assignee.id, name: spec.assignee.name } }, createdAt: new Date(spec.created.getTime() + 1_800_000) },
      });
    }
    await prisma.ticketWatcher.createMany({
      data: [...new Set([spec.requester!.id, spec.assignee?.id].filter(Boolean) as string[])].map((userId) => ({ ticketId: ticket.id, userId })),
    });
  }
  await prisma.ticketComment.create({ data: { ticketId: (await prisma.ticket.findFirstOrThrow({ where: { organisationId: org.id, number: 1 } })).id, authorId: alex!.id, body: "Looking into the VPN gateway logs now — seeing session timeouts on the Frankfurt node." } });
  await prisma.organisation.update({ where: { id: org.id }, data: { ticketCounter: number } });

  const board = await prisma.board.create({
    data: {
      name: "Q3 Infrastructure",
      description: "Planned upgrades and migrations",
      organisationId: org.id,
      teamId: itTeam.id,
      members: { create: [{ organisationMemberId: mOwner.id }, { organisationMemberId: mAlex.id }, { organisationMemberId: mSam.id }] },
      taskStatuses: { create: [{ name: "To Do", type: "TODO", position: 1000 }, { name: "In Progress", type: "IN_PROGRESS", position: 2000 }, { name: "In Review", type: "IN_REVIEW", position: 3000 }, { name: "Done", type: "COMPLETED", position: 4000 }] },
    },
    include: { taskStatuses: true },
  });
  const col = (name: string) => board.taskStatuses.find((s) => s.name === name)!.id;
  const tasks = [
    ["Migrate file server to cloud storage", "In Progress", "HIGH", 3, alex],
    ["Replace aging core switch", "To Do", "URGENT", -1, sam],
    ["Document onboarding checklist", "In Review", "LOW", 5, alex],
    ["Roll out password manager", "Done", "MEDIUM", -4, owner],
    ["Audit admin accounts", "To Do", "HIGH", 7, sam],
  ] as const;
  for (const [i, [title, column, priority, dueInDays, assignee]] of tasks.entries()) {
    await prisma.task.create({
      data: {
        boardId: board.id,
        statusId: col(column),
        title,
        priority,
        position: (i + 1) * 1000,
        dueDate: new Date(Date.now() + dueInDays * DAY),
        completedAt: column === "Done" ? ago(1) : null,
        assignees: { create: { userId: assignee!.id } },
        activities: { create: { userId: owner!.id, type: "TASK_CREATED" } },
      },
    });
  }

  const expenses = [
    ["AWS hosting", 1840.5, "Software", 3, "APPROVED", alex],
    ["Team offsite lunch", 312.4, "Meals", 8, "APPROVED", owner],
    ["Flights to client site", 920, "Travel", 35, "APPROVED", sam],
    ["Figma seats", 450, "Software", 62, "APPROVED", admin],
    ["Replacement monitors", 1299, "Equipment", 95, "APPROVED", alex],
    ["Taxi to data centre", 48.2, "Travel", 1, "PENDING", sam],
    ["Conference tickets", 780, "Training", 2, "PENDING", alex],
    ["Personal headphones", 199, "Equipment", 10, "REJECTED", sam],
  ] as const;
  for (const [title, amount, category, daysAgo, status, by] of expenses) {
    await prisma.expense.create({
      data: {
        organisationId: org.id,
        createdById: by!.id,
        title,
        amount,
        category,
        date: ago(daysAgo),
        status,
        reviewedById: status === "PENDING" ? null : owner!.id,
        reviewedAt: status === "PENDING" ? null : ago(Math.max(0, daysAgo - 1)),
        reviewNote: status === "REJECTED" ? "Personal equipment isn't reimbursable" : null,
      },
    });
  }

  const quarterStart = ago(30);
  const quarterEnd = new Date(Date.now() + 60 * DAY);
  await prisma.goal.createMany({
    data: [
      { organisationId: org.id, createdById: owner!.id, ownerId: admin!.id, title: "Software spend under $6k this quarter", type: "BUDGET", targetValue: 6000, category: "Software", periodStart: quarterStart, periodEnd: quarterEnd },
      { organisationId: org.id, createdById: admin!.id, ownerId: alex!.id, teamId: itTeam.id, title: "Resolve 20 IT tickets", type: "TICKETS_RESOLVED", targetValue: 20, periodStart: quarterStart, periodEnd: quarterEnd },
      { organisationId: org.id, createdById: owner!.id, ownerId: owner!.id, title: "Employee IT satisfaction score", type: "METRIC", targetValue: 90, currentValue: 42, unit: "%", periodStart: quarterStart, periodEnd: quarterEnd },
    ],
  });

  // A join request waiting for approval: Jordan accepted an invite from Alex (a member).
  await prisma.invitation.create({
    data: {
      organisationId: org.id,
      email: jordan!.email,
      role: "MEMBER",
      invitedById: alex!.id,
      tokenHash: sha256(randomToken()),
      status: "AWAITING_APPROVAL",
      acceptedById: jordan!.id,
      acceptedAt: ago(0, 2),
      expiresAt: new Date(Date.now() + 7 * DAY),
    },
  });

  console.log(`Seeded "Acme Corp". Sign in with any of: ${emails.join(", ")} — password: ${PASSWORD}`);
  console.log("jordan@acme.test has a pending join request for an admin to approve.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
