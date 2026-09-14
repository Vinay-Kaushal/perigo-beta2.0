import { beforeAll, describe, expect, test } from "bun:test";
import { addMember, registerUsers, createOrg, notificationsFor, recordEvents, registerUser, tokenFromUrl, useTestServer, type TestUser } from "./helpers";

useTestServer();

let owner: TestUser, member: TestUser, outsider: TestUser;
let orgId: string;

beforeAll(async () => {
  [owner, member, outsider] = await registerUsers("Owner", "Member", "Outsider");
  orgId = (await createOrg(owner, { name: "Dash Inc" })).id;
  await addMember(owner, orgId, member);
});

describe("personal dashboard", () => {
  test("is empty but well-formed for a new user", async () => {
    const res = await outsider.api.get("/me/dashboard");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ orgs: [], myTickets: [], tickets: { assignedOpen: 0 }, approvals: { joinRequests: 0, expenses: 0 } });
  });

  test("aggregates work across orgs, prioritised", async () => {
    const t = `/organisations/${orgId}/tickets`;
    await owner.api.post(t, { title: "Low thing for member", priority: "LOW", assigneeId: member.id });
    await owner.api.post(t, { title: "Urgent thing for member", priority: "URGENT", assigneeId: member.id });
    const board = (await owner.api.post(`/organisations/${orgId}/boards`, { name: "Dash board" })).body;
    await owner.api.post(`/boards/${board.id}/members`, { userId: member.id });
    await owner.api.post(`/boards/${board.id}/tasks`, {
      statusId: board.taskStatuses[0].id,
      title: "Overdue task",
      assigneeIds: [member.id],
      dueDate: new Date(Date.now() - 86_400_000).toISOString(),
    });
    await member.api.post(`/organisations/${orgId}/expenses`, { title: "Cab", amount: 12, category: "Travel", date: new Date().toISOString() });

    const dash = (await member.api.get("/me/dashboard")).body;
    expect(dash.orgs[0]).toMatchObject({ name: "Dash Inc", myRole: "MEMBER", openTickets: 2, pendingApprovals: 0 });
    expect(dash.tickets.assignedOpen).toBe(2);
    expect(dash.myTickets[0].title).toBe("Urgent thing for member");
    expect(dash.myTickets[0].key).toMatch(/^TKT-\d+$/);
    expect(dash.tasks).toMatchObject({ open: 1, overdue: 1 });
    expect(dash.upcomingTasks[0]).toMatchObject({ title: "Overdue task", overdue: true });
    expect(dash.unreadNotifications).toBeGreaterThanOrEqual(2);

    const ownerDash = (await owner.api.get("/me/dashboard")).body;
    expect(ownerDash.approvals.expenses).toBe(1);
    expect(ownerDash.orgs[0].pendingApprovals).toBe(1);
  });

  test("shows my own pending join requests", async () => {
    const other = await createOrg(outsider, { name: "Waiting Room" });
    const invite = await outsider.api.post(`/organisations/${other.id}/invitations`, { email: member.email });
    await member.api.post(`/invitations/${tokenFromUrl(invite.body.inviteUrl)}/accept`);
    const dash = (await member.api.get("/me/dashboard")).body;
    expect(dash.pendingJoinRequests[0].organisation.name).toBe("Waiting Room");
    expect((await outsider.api.get("/me/dashboard")).body.approvals.joinRequests).toBe(1);
  });
});

describe("notifications", () => {
  test("list, unread count, mark one read, mark all read — scoped to the recipient", async () => {
    const before = await member.api.get("/me/notifications");
    expect(before.body.unreadCount).toBeGreaterThan(0);
    const first = before.body.items[0];
    expect(first.actor).toHaveProperty("name");

    expect((await owner.api.post(`/me/notifications/${first.id}/read`)).status).toBe(404);

    const events = await recordEvents(`user:${member.id}`);
    expect((await member.api.post(`/me/notifications/${first.id}/read`)).status).toBe(204);
    expect(await events.find((ev) => ev.type === "NOTIFICATIONS_READ")).toHaveLength(1);
    await events.close();

    const count = await member.api.get("/me/notifications/unread-count");
    expect(count.body.count).toBe(before.body.unreadCount - 1);

    expect((await member.api.post("/me/notifications/read-all")).status).toBe(204);
    expect((await member.api.get("/me/notifications?unread=true")).body.items).toHaveLength(0);
  });

  test("cursor pagination", async () => {
    for (let i = 0; i < 4; i++) {
      await owner.api.post(`/organisations/${orgId}/tickets`, { title: `Paging ${i}`, assigneeId: member.id });
    }
    const page1 = await member.api.get("/me/notifications?limit=2");
    expect(page1.body.items).toHaveLength(2);
    const page2 = await member.api.get(`/me/notifications?limit=2&cursor=${page1.body.nextCursor}`);
    expect(page2.body.items[0].id).not.toBe(page1.body.items[1].id);
    expect((await notificationsFor(member)).length).toBeGreaterThan(4);
  });
});

describe("org analytics", () => {
  test("overview hides finance from members; activity mixes tickets and visible tasks", async () => {
    const memberView = (await member.api.get(`/organisations/${orgId}/analytics/overview`)).body;
    expect(memberView.finance).toBeNull();
    expect(memberView.tickets.open).toBeGreaterThan(0);
    const ownerView = (await owner.api.get(`/organisations/${orgId}/analytics/overview`)).body;
    expect(ownerView.finance).toMatchObject({ currency: "USD", pendingExpenses: 1 });
    expect(ownerView.workload.find((w: { user: { id: string } }) => w.user.id === member.id).openTickets).toBeGreaterThan(0);

    const activity = (await member.api.get(`/organisations/${orgId}/analytics/activity`)).body;
    const sources = new Set(activity.map((a: { source: string }) => a.source));
    expect(sources.has("ticket") && sources.has("task")).toBe(true);
  });

  test("members don't see activity or calendar entries from boards they're not on", async () => {
    const secret = (await owner.api.post(`/organisations/${orgId}/boards`, { name: "Secret board" })).body;
    await owner.api.post(`/boards/${secret.id}/tasks`, {
      statusId: secret.taskStatuses[0].id,
      title: "Top secret task",
      dueDate: new Date().toISOString(),
    });
    const activity = (await member.api.get(`/organisations/${orgId}/analytics/activity?limit=100`)).body;
    expect(activity.some((a: { subject: { title: string } }) => a.subject.title === "Top secret task")).toBe(false);

    const month = new Date().toISOString().slice(0, 7);
    const cal = (await member.api.get(`/organisations/${orgId}/analytics/calendar?month=${month}`)).body;
    expect(cal.tasks.some((t: { title: string }) => t.title === "Top secret task")).toBe(false);
    const ownerCal = (await owner.api.get(`/organisations/${orgId}/analytics/calendar?month=${month}`)).body;
    expect(ownerCal.tasks.some((t: { title: string }) => t.title === "Top secret task")).toBe(true);
    expect((await owner.api.get(`/organisations/${orgId}/analytics/calendar?month=2026-13`)).status).toBe(400);
  });

  test("PDF report is admin-only and range-limited", async () => {
    const from = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const to = new Date().toISOString();
    expect((await member.api.get(`/organisations/${orgId}/analytics/report.pdf?from=${from}&to=${to}`)).status).toBe(403);
    const pdf = await owner.api.get(`/organisations/${orgId}/analytics/report.pdf?from=${from}&to=${to}`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    const tooLong = new Date(Date.now() - 400 * 86_400_000).toISOString();
    expect((await owner.api.get(`/organisations/${orgId}/analytics/report.pdf?from=${tooLong}&to=${to}`)).status).toBe(400);
  });
});

describe("teams", () => {
  test("admins manage teams; members must belong to the org; cross-org ids are 404", async () => {
    const t = `/organisations/${orgId}/teams`;
    expect((await member.api.post(t, { name: "Rogue" })).status).toBe(403);
    const team = await owner.api.post(t, { name: "Service Desk" });
    expect(team.status).toBe(201);
    expect((await owner.api.post(t, { name: "Service Desk" })).status).toBe(409);

    expect((await owner.api.post(`${t}/${team.body.id}/members`, { userId: outsider.id })).status).toBe(400);
    expect((await owner.api.post(`${t}/${team.body.id}/members`, { userId: member.id })).status).toBe(201);
    const list = (await member.api.get(t)).body;
    expect(list.find((x: { id: string }) => x.id === team.body.id).members[0].id).toBe(member.id);

    const otherOrg = await createOrg(outsider);
    expect((await outsider.api.patch(`/organisations/${otherOrg.id}/teams/${team.body.id}`, { name: "Stolen" })).status).toBe(404);
    expect((await outsider.api.delete(`/organisations/${otherOrg.id}/teams/${team.body.id}`)).status).toBe(404);

    expect((await owner.api.delete(`${t}/${team.body.id}/members/${member.id}`)).status).toBe(204);
    expect((await owner.api.delete(`${t}/${team.body.id}`)).status).toBe(204);
  });
});
