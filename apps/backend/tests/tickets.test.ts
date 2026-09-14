import { beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "../lib/prisma";
import { SLA_HOURS } from "../domain/tickets";
import { addMember, registerUsers, createOrg, notificationsFor, recordEvents, registerUser, useTestServer, type TestUser } from "./helpers";

useTestServer();

let owner: TestUser, admin: TestUser, alice: TestUser, bob: TestUser, carol: TestUser, outsider: TestUser;
let orgId: string;
const t = (path = "") => `/organisations/${orgId}/tickets${path}`;

beforeAll(async () => {
  [owner, admin, alice, bob, carol, outsider] = await registerUsers("Owner", "Admin", "Alice", "Bob", "Carol", "Outsider");
  const org = await createOrg(owner, { name: "Service Co" });
  orgId = org.id;
  await addMember(owner, orgId, admin, "ADMIN");
  await addMember(owner, orgId, alice);
  await addMember(owner, orgId, bob);
  await addMember(owner, orgId, carol);
});

describe("creating tickets", () => {
  test("numbers are sequential per org, keyed by prefix, with an SLA from priority", async () => {
    const before = Date.now();
    const a = await alice.api.post(t(), { title: "VPN keeps dropping", priority: "URGENT", type: "INCIDENT" });
    const b = await alice.api.post(t(), { title: "Need a new laptop", type: "SERVICE_REQUEST" });
    expect(a.status).toBe(201);
    expect(b.body.number).toBe(a.body.number + 1);
    expect(a.body.key).toBe(`TKT-${a.body.number}`);
    expect(a.body.status).toBe("NEW");
    expect(a.body.requester.id).toBe(alice.id);
    const slaMs = new Date(a.body.dueAt).getTime() - before;
    expect(slaMs).toBeGreaterThan(SLA_HOURS.URGENT * 3_600_000 - 5000);
    expect(slaMs).toBeLessThan(SLA_HOURS.URGENT * 3_600_000 + 5000);
    expect(b.body.priority).toBe("MEDIUM");
  });

  test("concurrent creates never collide on a number", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => bob.api.post(t(), { title: `Burst ticket ${i}` })));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const numbers = results.map((r) => r.body.number);
    expect(new Set(numbers).size).toBe(12);
  });

  test("each org has its own sequence", async () => {
    const other = await createOrg(outsider);
    const first = await outsider.api.post(`/organisations/${other.id}/tickets`, { title: "First ticket here" });
    expect(first.body.number).toBe(1);
  });

  test("assigning at creation opens the ticket and notifies the assignee in realtime", async () => {
    const userEvents = await recordEvents(`user:${bob.id}`);
    const orgEvents = await recordEvents(`org:${orgId}`);

    const res = await alice.api.post(t(), { title: "Email bouncing for finance", assigneeId: bob.id, priority: "HIGH" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("OPEN");
    expect(res.body.assignee.id).toBe(bob.id);

    const pushed = await userEvents.find((e) => e.type === "NOTIFICATION_CREATED" && e.data.type === "TICKET_ASSIGNED");
    expect(pushed).toHaveLength(1);
    expect(pushed[0]!.data.title).toBe(`Alice assigned ${res.body.key} to you`);
    expect(pushed[0]!.data.actor.name).toBe("Alice");
    expect(pushed[0]!.data.link).toBe(`/orgs/${orgId}/tickets/${res.body.number}`);
    expect(await orgEvents.find((e) => e.type === "TICKET_CREATED" && e.data.id === res.body.id)).toHaveLength(1);

    await Promise.all([userEvents.close(), orgEvents.close()]);
  });

  test("validation: assignee and team must belong to the org; only admins raise on behalf of others", async () => {
    expect((await alice.api.post(t(), { title: "Bad assignee", assigneeId: outsider.id })).status).toBe(400);
    expect((await alice.api.post(t(), { title: "x" })).status).toBe(400);
    expect((await alice.api.post(t(), { title: "Bad type", type: "BUG" })).status).toBe(400);

    const foreignOrg = await createOrg(outsider);
    const foreignTeam = await outsider.api.post(`/organisations/${foreignOrg.id}/teams`, { name: "Foreign" });
    expect((await alice.api.post(t(), { title: "Bad team", teamId: foreignTeam.body.id })).status).toBe(400);

    expect((await alice.api.post(t(), { title: "On behalf", requesterId: bob.id })).status).toBe(403);
    const onBehalf = await admin.api.post(t(), { title: "Raised for Carol", requesterId: carol.id });
    expect(onBehalf.status).toBe(201);
    expect(onBehalf.body.requester.id).toBe(carol.id);
    expect((await notificationsFor(carol)).map((n) => n.type)).toContain("TICKET_RAISED_FOR_YOU");
  });

  test("team queue members are notified about unassigned team tickets", async () => {
    const team = await owner.api.post(`/organisations/${orgId}/teams`, { name: `Network ${Date.now()}` });
    await owner.api.post(`/organisations/${orgId}/teams/${team.body.id}/members`, { userId: carol.id });
    const res = await alice.api.post(t(), { title: "Switch port flapping", teamId: team.body.id });
    expect(res.body.team.name).toBe(team.body.name);
    const n = (await notificationsFor(carol)).find((x) => x.type === "TICKET_TEAM_QUEUE" && x.body === "Switch port flapping");
    expect(n).toBeDefined();
  });
});

describe("assignment", () => {
  test("anyone can pick up an unassigned ticket; then only requester, assignee or admin can reassign", async () => {
    const ticket = (await alice.api.post(t(), { title: "Unassigned printer issue" })).body;

    const take = await carol.api.post(t(`/${ticket.number}/assign`), { assigneeId: carol.id });
    expect(take.status).toBe(200);
    expect(take.body.status).toBe("OPEN");

    // Bob is neither requester nor assignee.
    expect((await bob.api.post(t(`/${ticket.number}/assign`), { assigneeId: bob.id })).status).toBe(403);
    // Requester can reassign.
    expect((await alice.api.post(t(`/${ticket.number}/assign`), { assigneeId: bob.id })).status).toBe(200);
    // Admin can do anything.
    expect((await admin.api.post(t(`/${ticket.number}/assign`), { assigneeId: null })).status).toBe(200);
    // Non-members can't be assigned.
    expect((await admin.api.post(t(`/${ticket.number}/assign`), { assigneeId: outsider.id })).status).toBe(400);
  });

  test("everyone involved learns who assigned it to whom", async () => {
    const ticket = (await alice.api.post(t(), { title: "Payroll export failing", assigneeId: bob.id })).body;
    await owner.api.post(t(`/${ticket.number}/watch`));

    const res = await admin.api.post(t(`/${ticket.number}/assign`), { assigneeId: carol.id });
    expect(res.status).toBe(200);

    const carolN = (await notificationsFor(carol)).find((n) => n.title === `Admin assigned ${ticket.key} to you`);
    const bobN = (await notificationsFor(bob)).find((n) => n.title === `Admin reassigned ${ticket.key} to Carol`);
    const aliceN = (await notificationsFor(alice)).find((n) => n.title === `Admin assigned ${ticket.key} to Carol`);
    const ownerN = (await notificationsFor(owner)).find((n) => n.title === `Admin assigned ${ticket.key} to Carol`);
    expect(carolN?.type).toBe("TICKET_ASSIGNED");
    expect(bobN?.type).toBe("TICKET_REASSIGNED");
    expect(aliceN?.type).toBe("TICKET_ASSIGNMENT_CHANGED");
    expect(ownerN).toBeDefined();
    // The actor isn't notified about their own action.
    expect((await notificationsFor(admin)).some((n) => n.title.includes(ticket.key))).toBe(false);

    const detail = await alice.api.get(t(`/${ticket.number}`));
    const assigned = detail.body.events.filter((e: { type: string }) => e.type === "ASSIGNED");
    expect(assigned.at(-1).metadata).toEqual({ from: { id: bob.id, name: "Bob" }, to: { id: carol.id, name: "Carol" } });
    expect(assigned.at(-1).actor.id).toBe(admin.id);
  });
});

describe("workflow", () => {
  test("assignee works the ticket; resolve needs a note; requester closes", async () => {
    const ticket = (await alice.api.post(t(), { title: "Shared drive permissions", assigneeId: bob.id })).body;
    const path = t(`/${ticket.number}/status`);

    expect((await bob.api.post(path, { status: "IN_PROGRESS" })).status).toBe(200);
    expect((await carol.api.post(path, { status: "ON_HOLD" })).status).toBe(403);
    expect((await bob.api.post(path, { status: "CLOSED" })).status).toBe(409);
    expect((await bob.api.post(path, { status: "RESOLVED" })).status).toBe(409);

    const resolved = await bob.api.post(path, { status: "RESOLVED", resolutionNote: "Granted group access" });
    expect(resolved.status).toBe(200);
    expect(resolved.body.resolvedAt).toBeString();
    expect(resolved.body.resolutionNote).toBe("Granted group access");
    const n = (await notificationsFor(alice)).find((x) => x.type === "TICKET_STATUS_CHANGED" && x.title.includes("Resolved"));
    expect(n?.body).toBe("Granted group access");

    const closed = await alice.api.post(path, { status: "CLOSED" });
    expect(closed.status).toBe(200);
    expect(closed.body.closedAt).toBeString();

    // Closed tickets: only admins reopen, and nobody edits until then.
    expect((await alice.api.post(path, { status: "OPEN" })).status).toBe(403);
    expect((await bob.api.patch(t(`/${ticket.number}`), { title: "Edited after close" })).status).toBe(409);
    expect((await bob.api.post(t(`/${ticket.number}/assign`), { assigneeId: carol.id })).status).toBe(409);
    const reopened = await admin.api.post(path, { status: "OPEN" });
    expect(reopened.status).toBe(200);
    expect(reopened.body.resolvedAt).toBeNull();
    expect(reopened.body.closedAt).toBeNull();
  });

  test("detail exposes the caller's allowed actions", async () => {
    const ticket = (await alice.api.post(t(), { title: "Allowed actions check", assigneeId: bob.id })).body;
    const asRequester = (await alice.api.get(t(`/${ticket.number}`))).body.permissions;
    expect(asRequester).toMatchObject({ canEdit: true, canAssign: true, canDelete: false });
    expect(asRequester.allowedStatuses.sort()).toEqual(["CANCELLED"]);

    const asAssignee = (await bob.api.get(t(`/${ticket.number}`))).body.permissions;
    expect(asAssignee.allowedStatuses.sort()).toEqual(["CANCELLED", "IN_PROGRESS", "ON_HOLD", "RESOLVED"]);

    const asBystander = (await carol.api.get(t(`/${ticket.number}`))).body.permissions;
    expect(asBystander).toMatchObject({ canEdit: false, canAssign: false, allowedStatuses: [] });
  });

  test("editing: priority change re-derives the SLA and is audited in the timeline", async () => {
    const ticket = (await alice.api.post(t(), { title: "Slow wifi on floor 3", priority: "LOW" })).body;
    expect((await carol.api.patch(t(`/${ticket.number}`), { priority: "URGENT" })).status).toBe(403);

    const res = await alice.api.patch(t(`/${ticket.number}`), { priority: "URGENT", category: "Network" });
    expect(res.status).toBe(200);
    const due = new Date(res.body.dueAt).getTime() - new Date(ticket.createdAt).getTime();
    expect(due).toBe(SLA_HOURS.URGENT * 3_600_000);

    const detail = await alice.api.get(t(`/${ticket.number}`));
    const types = detail.body.events.map((e: { type: string }) => e.type);
    expect(types).toEqual(expect.arrayContaining(["CREATED", "PRIORITY_CHANGED", "UPDATED"]));
    expect((await alice.api.patch(t(`/${ticket.number}`), {})).status).toBe(400);
  });
});

describe("comments and watchers", () => {
  test("comments notify participants, stamp first response, and auto-watch the author", async () => {
    const ticket = (await alice.api.post(t(), { title: "Monitor flickers", assigneeId: bob.id })).body;
    await alice.api.post(t(`/${ticket.number}/comments`), { body: "Started after the update" });
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).firstResponseAt).toBeNull();

    const reply = await carol.api.post(t(`/${ticket.number}/comments`), { body: "Try a different cable" });
    expect(reply.status).toBe(201);
    expect(reply.body.author.id).toBe(carol.id);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).firstResponseAt).not.toBeNull();

    for (const u of [alice, bob]) {
      expect((await notificationsFor(u)).some((n) => n.type === "TICKET_COMMENTED" && n.body === "Try a different cable")).toBe(true);
    }
    const detail = await carol.api.get(t(`/${ticket.number}`));
    expect(detail.body.isWatching).toBe(true);
    expect(detail.body.comments).toHaveLength(2);

    // Only the author edits; author or admin deletes.
    expect((await bob.api.patch(t(`/${ticket.number}/comments/${reply.body.id}`), { body: "hijack" })).status).toBe(403);
    expect((await carol.api.patch(t(`/${ticket.number}/comments/${reply.body.id}`), { body: "Try a different HDMI cable" })).status).toBe(200);
    expect((await bob.api.delete(t(`/${ticket.number}/comments/${reply.body.id}`))).status).toBe(403);
    expect((await admin.api.delete(t(`/${ticket.number}/comments/${reply.body.id}`))).status).toBe(204);
  });

  test("comment ids from another ticket can't be edited through this one", async () => {
    const a = (await alice.api.post(t(), { title: "Ticket A for comments" })).body;
    const b = (await alice.api.post(t(), { title: "Ticket B for comments" })).body;
    const comment = await alice.api.post(t(`/${a.number}/comments`), { body: "on A" });
    expect((await alice.api.patch(t(`/${b.number}/comments/${comment.body.id}`), { body: "moved" })).status).toBe(404);
  });

  test("unwatching stops notifications", async () => {
    const ticket = (await alice.api.post(t(), { title: "Watch toggling" })).body;
    await carol.api.post(t(`/${ticket.number}/watch`));
    await carol.api.delete(t(`/${ticket.number}/watch`));
    await alice.api.post(t(`/${ticket.number}/comments`), { body: "unique-comment-for-unwatch" });
    expect((await notificationsFor(carol)).some((n) => n.body === "unique-comment-for-unwatch")).toBe(false);
  });
});

describe("queue views and stats", () => {
  test("filters: mine, unassigned, requester, status groups, priority, search by key", async () => {
    const mine = (await admin.api.post(t(), { title: "Queue filter target zeta", assigneeId: carol.id, priority: "HIGH" })).body;

    const assignedToMe = await carol.api.get(t("?assignee=me&pageSize=100"));
    expect(assignedToMe.body.items.every((x: { assigneeId: string }) => x.assigneeId === carol.id)).toBe(true);
    expect(assignedToMe.body.items.some((x: { id: string }) => x.id === mine.id)).toBe(true);

    const unassigned = await carol.api.get(t("?assignee=unassigned&pageSize=100"));
    expect(unassigned.body.items.every((x: { assigneeId: string | null }) => x.assigneeId === null)).toBe(true);

    const byRequester = await admin.api.get(t("?requester=me&pageSize=100"));
    expect(byRequester.body.items.every((x: { requesterId: string }) => x.requesterId === admin.id)).toBe(true);

    const open = await carol.api.get(t("?status=open&priority=HIGH,URGENT&pageSize=100"));
    expect(open.body.items.every((x: { status: string; priority: string }) => ["NEW", "OPEN", "IN_PROGRESS", "ON_HOLD"].includes(x.status) && ["HIGH", "URGENT"].includes(x.priority))).toBe(true);

    const byKey = await carol.api.get(t(`?q=${mine.key}`));
    expect(byKey.body.items.map((x: { id: string }) => x.id)).toEqual([mine.id]);
    const byTitle = await carol.api.get(t("?q=FILTER%20TARGET%20zeta"));
    expect(byTitle.body.items.map((x: { id: string }) => x.id)).toEqual([mine.id]);

    expect((await carol.api.get(t("?status=BOGUS"))).status).toBe(400);
  });

  test("pagination and sorting", async () => {
    const page1 = await alice.api.get(t("?pageSize=5&page=1&sort=number&order=asc"));
    const page2 = await alice.api.get(t("?pageSize=5&page=2&sort=number&order=asc"));
    expect(page1.body.items).toHaveLength(5);
    expect(page1.body.total).toBeGreaterThan(10);
    expect(page2.body.items[0].number).toBeGreaterThan(page1.body.items[4].number);
    expect((await alice.api.get(t("?pageSize=1000"))).status).toBe(400);
  });

  test("SLA breaches are flagged and filterable", async () => {
    const ticket = (await alice.api.post(t(), { title: "Overdue ticket for SLA" })).body;
    await prisma.ticket.update({ where: { id: ticket.id }, data: { dueAt: new Date(Date.now() - 3_600_000) } });
    const breached = await alice.api.get(t("?breached=true&pageSize=100"));
    const found = breached.body.items.find((x: { id: string }) => x.id === ticket.id);
    expect(found.slaBreached).toBe(true);
  });

  test("stats summarise the desk", async () => {
    const stats = await carol.api.get(t("/stats"));
    expect(stats.status).toBe(200);
    expect(stats.body.total).toBeGreaterThan(0);
    expect(stats.body.open).toBeLessThanOrEqual(stats.body.total);
    expect(stats.body.trend).toHaveLength(14);
    expect(stats.body.trend.at(-1).created).toBeGreaterThan(0);
    expect(stats.body.breached).toBeGreaterThanOrEqual(1);
    expect(stats.body.assignedToMe).toBeGreaterThanOrEqual(1);
    expect(Object.keys(stats.body.byStatus)).toHaveLength(7);
    expect(stats.body.slaCompliance === null || typeof stats.body.slaCompliance === "number").toBe(true);
    expect(stats.body.workload[0].user).toHaveProperty("name");
  });
});

describe("isolation and deletion", () => {
  test("tickets can't be read or changed from another org", async () => {
    const ticket = (await alice.api.post(t(), { title: "Confidential HR ticket" })).body;
    const otherOrg = await createOrg(outsider);
    const viaOtherOrg = `/organisations/${otherOrg.id}/tickets`;
    expect((await outsider.api.get(`${viaOtherOrg}/${ticket.id}`)).status).toBe(404);
    expect((await outsider.api.post(`${viaOtherOrg}/${ticket.id}/comments`, { body: "sneaky" })).status).toBe(404);
    expect((await outsider.api.get(t(`/${ticket.number}`))).status).toBe(404);
    const list = await outsider.api.get(`${viaOtherOrg}?pageSize=100`);
    expect(list.body.items.some((x: { id: string }) => x.id === ticket.id)).toBe(false);
  });

  test("only admins delete, and it's audited", async () => {
    const ticket = (await alice.api.post(t(), { title: "Delete me please" })).body;
    expect((await alice.api.delete(t(`/${ticket.number}`))).status).toBe(403);
    expect((await owner.api.delete(t(`/${ticket.number}`))).status).toBe(204);
    expect((await owner.api.get(t(`/${ticket.number}`))).status).toBe(404);
    const logs = await owner.api.get(`/organisations/${orgId}/audit-logs?action=ticket.`);
    expect(logs.body.items[0].metadata.key).toBe(ticket.key);
  });
});
