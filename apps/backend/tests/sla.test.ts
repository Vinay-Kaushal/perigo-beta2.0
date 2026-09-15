import { beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "../lib/prisma";
import { addBusinessMinutes, type BusinessSchedule } from "../domain/businessHours";
import { addMember, createOrg, registerUsers, useTestServer, type TestUser } from "./helpers";

useTestServer();

const MIN = 60_000;
let owner: TestUser, admin: TestUser, agent: TestUser, requester: TestUser, outsider: TestUser;
let orgId: string;
const t = (path = "") => `/organisations/${orgId}/tickets${path}`;
const sla = (path = "") => `/organisations/${orgId}/sla${path}`;
const ms = (iso: string) => new Date(iso).getTime();

beforeAll(async () => {
  [owner, admin, agent, requester, outsider] = await registerUsers("Owner", "Admin", "Agent", "Requester", "Outsider");
  orgId = (await createOrg(owner, { name: "SLA Co" })).id;
  await addMember(owner, orgId, admin, "ADMIN");
  await addMember(owner, orgId, agent);
  await addMember(owner, orgId, requester);
});

/** Moves a ticket's clock back in time as if it had been paused `minutes` ago. */
async function pausedMinutesAgo(ticketId: string, minutes: number) {
  await prisma.ticket.update({ where: { id: ticketId }, data: { slaPausedAt: new Date(Date.now() - minutes * MIN) } });
}

describe("settings", () => {
  test("defaults: 24/7 with the built-in policy per priority", async () => {
    const res = await agent.api.get(sla());
    expect(res.status).toBe(200);
    expect(res.body.businessHours).toEqual({ enabled: false, timezone: "UTC", days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" });
    expect(res.body.holidays).toEqual([]);
    expect(res.body.policies.map((p: { priority: string }) => p.priority)).toEqual(["URGENT", "HIGH", "MEDIUM", "LOW"]);
    const urgent = res.body.policies[0];
    expect(urgent).toMatchObject({ firstResponseMinutes: 30, resolutionMinutes: 240, isDefault: true });
  });

  test("only admins can change SLA settings; outsiders can't even read them", async () => {
    expect((await agent.api.put(sla(), { policies: [{ priority: "LOW", firstResponseMinutes: 60, resolutionMinutes: 120 }] })).status).toBe(403);
    expect((await agent.api.post(sla("/holidays"), { date: "2026-12-25", name: "Christmas" })).status).toBe(403);
    expect((await outsider.api.get(sla())).status).toBe(404);
    expect((await outsider.api.put(sla(), { resetPolicies: ["LOW"] })).status).toBe(404);
  });

  test("validation rejects nonsense schedules and policies", async () => {
    const base = { enabled: true, timezone: "UTC", days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" };
    const bad = [
      {},
      { businessHours: { ...base, timezone: "Mars/Olympus" } },
      { businessHours: { ...base, start: "17:00", end: "09:00" } },
      { businessHours: { ...base, start: "9am" } },
      { businessHours: { ...base, days: [] } },
      { businessHours: { ...base, days: [7] } },
      { policies: [{ priority: "HIGH", firstResponseMinutes: 600, resolutionMinutes: 60 }] },
      { policies: [{ priority: "HIGH", firstResponseMinutes: 1, resolutionMinutes: 60 }] },
      { policies: [{ priority: "HIGH", firstResponseMinutes: 60, resolutionMinutes: 60 * 24 * 366 }] },
      { policies: [{ priority: "CRITICAL", firstResponseMinutes: 60, resolutionMinutes: 120 }] },
    ];
    for (const body of bad) {
      const res = await admin.api.put(sla(), body);
      expect({ body, status: res.status }).toEqual({ body, status: 400 });
    }
    // A disabled schedule doesn't need working days.
    expect((await admin.api.put(sla(), { businessHours: { ...base, enabled: false, days: [] } })).status).toBe(200);
  });

  test("updates are audited and policies can be reset to defaults", async () => {
    const res = await admin.api.put(sla(), { policies: [{ priority: "LOW", firstResponseMinutes: 90, resolutionMinutes: 600 }] });
    expect(res.status).toBe(200);
    const low = res.body.policies.find((p: { priority: string }) => p.priority === "LOW");
    expect(low).toMatchObject({ firstResponseMinutes: 90, resolutionMinutes: 600, isDefault: false });

    const reset = await admin.api.put(sla(), { resetPolicies: ["LOW"] });
    expect(reset.body.policies.find((p: { priority: string }) => p.priority === "LOW")).toMatchObject({ resolutionMinutes: 7200, isDefault: true });

    const audit = await prisma.auditLog.findMany({ where: { organisationId: orgId, action: "sla.updated" } });
    expect(audit.length).toBeGreaterThanOrEqual(2);
  });

  test("holidays: add, reject duplicates and bad dates, delete, scoped to the org", async () => {
    const created = await admin.api.post(sla("/holidays"), { date: "2026-12-25", name: "Christmas" });
    expect(created.status).toBe(201);
    expect((await admin.api.post(sla("/holidays"), { date: "2026-12-25", name: "Again" })).status).toBe(409);
    expect((await admin.api.post(sla("/holidays"), { date: "2026-02-30", name: "Nope" })).status).toBe(400);
    expect((await admin.api.post(sla("/holidays"), { date: "25/12/2026", name: "Nope" })).status).toBe(400);
    expect((await agent.api.get(sla())).body.holidays).toEqual([{ id: created.body.id, date: "2026-12-25", name: "Christmas" }]);

    const otherOrg = await createOrg(outsider);
    expect((await outsider.api.delete(`/organisations/${otherOrg.id}/sla/holidays/${created.body.id}`)).status).toBe(404);
    expect((await admin.api.delete(sla(`/holidays/${created.body.id}`))).status).toBe(204);
    expect((await admin.api.delete(sla(`/holidays/${created.body.id}`))).status).toBe(404);
  });
});

describe("targets on tickets", () => {
  test("custom policies drive both the response and resolution targets", async () => {
    await admin.api.put(sla(), { policies: [{ priority: "HIGH", firstResponseMinutes: 15, resolutionMinutes: 60 }] });
    const res = await requester.api.post(t(), { title: "Printer on fire", priority: "HIGH" });
    expect(res.status).toBe(201);
    const created = ms(res.body.createdAt);
    expect(ms(res.body.responseDueAt) - created).toBe(15 * MIN);
    expect(ms(res.body.dueAt) - created).toBe(60 * MIN);
    expect(res.body.slaPaused).toBe(false);
    expect(res.body.responseBreached).toBe(false);
    await admin.api.put(sla(), { resetPolicies: ["HIGH"] });
  });

  test("business hours push targets into working time", async () => {
    const tomorrow = (new Date().getUTCDay() + 1) % 7;
    const businessHours = { enabled: true, timezone: "UTC", days: [tomorrow], start: "09:00", end: "17:00" };
    expect((await admin.api.put(sla(), { businessHours })).status).toBe(200);

    const before = new Date();
    const res = await requester.api.post(t(), { title: "Only tomorrow counts", priority: "URGENT" });
    const after = new Date();
    const schedule: BusinessSchedule = { ...businessHours, holidays: [] };

    // URGENT: 30m response, 4h resolution — both land inside tomorrow's 09:00–17:00 window.
    const due = ms(res.body.dueAt);
    expect(due).toBeGreaterThanOrEqual(addBusinessMinutes(before, 240, schedule).getTime());
    expect(due).toBeLessThanOrEqual(addBusinessMinutes(after, 240, schedule).getTime());
    expect(new Date(res.body.dueAt).getUTCHours()).toBe(13);
    expect(new Date(res.body.responseDueAt).toISOString().slice(11, 16)).toBe("09:30");

    // A holiday tomorrow moves the targets a whole week out.
    const tomorrowDate = new Date(Date.now() + 24 * 60 * MIN).toISOString().slice(0, 10);
    const holiday = await admin.api.post(sla("/holidays"), { date: tomorrowDate, name: "Surprise day off" });
    const later = await requester.api.post(t(), { title: "After the holiday", priority: "URGENT" });
    expect(ms(later.body.dueAt) - due).toBeGreaterThanOrEqual(6 * 24 * 60 * MIN);

    await admin.api.delete(sla(`/holidays/${holiday.body.id}`));
    await admin.api.put(sla(), { businessHours: { ...businessHours, enabled: false } });
  });

  test("changing priority re-targets from creation; an explicit due date wins", async () => {
    const ticket = (await requester.api.post(t(), { title: "Priority shuffle", priority: "LOW" })).body;
    const raised = await admin.api.patch(t(`/${ticket.number}`), { priority: "URGENT" });
    expect(ms(raised.body.dueAt) - ms(ticket.createdAt)).toBe(240 * MIN);
    expect(ms(raised.body.responseDueAt) - ms(ticket.createdAt)).toBe(30 * MIN);

    const explicit = new Date(Date.now() + 3 * 24 * 60 * MIN).toISOString();
    const both = await admin.api.patch(t(`/${ticket.number}`), { priority: "HIGH", dueAt: explicit });
    expect(both.body.dueAt).toBe(explicit);
    expect(ms(both.body.responseDueAt) - ms(ticket.createdAt)).toBe(120 * MIN);
  });

  test("the first reply from someone other than the requester meets the response SLA", async () => {
    const ticket = (await requester.api.post(t(), { title: "Waiting for a reply", priority: "URGENT" })).body;
    await prisma.ticket.update({ where: { id: ticket.id }, data: { responseDueAt: new Date(Date.now() - MIN) } });

    let fetched = await agent.api.get(t(`/${ticket.number}`));
    expect(fetched.body.responseBreached).toBe(true);
    const stats = await agent.api.get(t("/stats"));
    expect(stats.body.responseBreached).toBeGreaterThanOrEqual(1);
    const waiting = await agent.api.get(t("?responseBreached=true&pageSize=100"));
    expect(waiting.body.items.map((x: { id: string }) => x.id)).toContain(ticket.id);
    expect(waiting.body.total).toBe(stats.body.responseBreached);

    await requester.api.post(t(`/${ticket.number}/comments`), { body: "Any update?" });
    expect((await agent.api.get(t(`/${ticket.number}`))).body.responseBreached).toBe(true);

    await agent.api.post(t(`/${ticket.number}/comments`), { body: "Looking now" });
    fetched = await agent.api.get(t(`/${ticket.number}`));
    // Answered late: no longer waiting, so it drops out of the overdue count and filter.
    expect(fetched.body.firstResponseAt).toBeTruthy();
    const after = await agent.api.get(t("/stats"));
    expect(after.body.responseBreached).toBe(stats.body.responseBreached - 1);
    expect((await agent.api.get(t("?responseBreached=true&pageSize=100"))).body.items.map((x: { id: string }) => x.id)).not.toContain(ticket.id);

    const onTime = (await requester.api.post(t(), { title: "Quick reply", priority: "URGENT" })).body;
    await agent.api.post(t(`/${onTime.number}/comments`), { body: "On it" });
    expect((await agent.api.get(t(`/${onTime.number}`))).body.responseBreached).toBe(false);
  });
});

describe("pause on hold", () => {
  test("on hold stops the clock: not breached, not in the breached filter, counted as paused", async () => {
    const ticket = (await requester.api.post(t(), { title: "Waiting on vendor", priority: "URGENT", assigneeId: agent.id })).body;
    await prisma.ticket.update({ where: { id: ticket.id }, data: { dueAt: new Date(Date.now() - MIN) } });
    expect((await agent.api.get(t(`/${ticket.number}`))).body.slaBreached).toBe(true);

    const held = await agent.api.post(t(`/${ticket.number}/status`), { status: "ON_HOLD" });
    expect(held.status).toBe(200);
    expect(held.body.slaPaused).toBe(true);
    expect(held.body.slaBreached).toBe(false);

    const breached = await agent.api.get(t("?breached=true&pageSize=100"));
    expect(breached.body.items.some((x: { id: string }) => x.id === ticket.id)).toBe(false);
    const stats = await agent.api.get(t("/stats"));
    expect(stats.body.paused).toBeGreaterThanOrEqual(1);

    const dashboard = await agent.api.get("/me/dashboard");
    const mine = dashboard.body.myTickets.find((x: { id: string }) => x.id === ticket.id);
    expect(mine).toMatchObject({ slaPaused: true, slaBreached: false });

    const overview = await agent.api.get(`/organisations/${orgId}/analytics/overview`);
    expect(overview.body.tickets.breached).toBe(0);
  });

  test("resuming pushes targets out by the time spent on hold and records it", async () => {
    const ticket = (await requester.api.post(t(), { title: "Resume me", priority: "HIGH", assigneeId: agent.id })).body;
    await agent.api.post(t(`/${ticket.number}/status`), { status: "ON_HOLD" });
    await pausedMinutesAgo(ticket.id, 90);

    const resumed = await agent.api.post(t(`/${ticket.number}/status`), { status: "IN_PROGRESS" });
    expect(resumed.status).toBe(200);
    expect(resumed.body.slaPaused).toBe(false);
    const shift = ms(resumed.body.dueAt) - ms(ticket.dueAt);
    expect(shift).toBeGreaterThanOrEqual(90 * MIN);
    expect(shift).toBeLessThan(91 * MIN);
    expect(ms(resumed.body.responseDueAt) - ms(ticket.responseDueAt)).toBe(shift);

    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(row.slaPausedAt).toBeNull();
    expect(row.slaPausedMinutes).toBe(90);
    const event = await prisma.ticketEvent.findFirstOrThrow({ where: { ticketId: ticket.id, type: "STATUS_CHANGED" }, orderBy: { createdAt: "desc" } });
    expect(event.metadata).toMatchObject({ from: "ON_HOLD", to: "IN_PROGRESS", slaPausedMinutes: 90 });

    // Time already spent on hold survives a later priority change.
    const raised = await agent.api.patch(t(`/${ticket.number}`), { priority: "URGENT" });
    expect(ms(raised.body.dueAt) - ms(ticket.createdAt)).toBe((240 + 90) * MIN);
  });

  test("resolving straight from hold clears the pause without breaching", async () => {
    const ticket = (await requester.api.post(t(), { title: "Resolved while held", assigneeId: agent.id })).body;
    await agent.api.post(t(`/${ticket.number}/status`), { status: "ON_HOLD" });
    await pausedMinutesAgo(ticket.id, 30);
    const resolved = await agent.api.post(t(`/${ticket.number}/status`), { status: "RESOLVED", resolutionNote: "Vendor fixed it" });
    expect(resolved.status).toBe(200);
    expect(resolved.body.slaPaused).toBe(false);
    expect(resolved.body.slaBreached).toBe(false);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).slaPausedMinutes).toBe(30);
  });

  test("with business hours, time on hold outside working time costs nothing", async () => {
    // A schedule with no working day today or yesterday: an hour on hold "now" is outside hours.
    const today = new Date().getUTCDay();
    const days = [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== today && d !== (today + 6) % 7);
    await admin.api.put(sla(), { businessHours: { enabled: true, timezone: "UTC", days, start: "09:00", end: "17:00" } });

    const ticket = (await requester.api.post(t(), { title: "Held off hours", assigneeId: agent.id })).body;
    await agent.api.post(t(`/${ticket.number}/status`), { status: "ON_HOLD" });
    await pausedMinutesAgo(ticket.id, 60);
    const resumed = await agent.api.post(t(`/${ticket.number}/status`), { status: "OPEN" });
    expect(resumed.body.dueAt).toBe(ticket.dueAt);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).slaPausedMinutes).toBe(0);

    await admin.api.put(sla(), { businessHours: { enabled: false, timezone: "UTC", days, start: "09:00", end: "17:00" } });
  });
});
