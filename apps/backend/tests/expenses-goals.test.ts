import { beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "../lib/prisma";
import { addMember, registerUsers, createOrg, notificationsFor, registerUser, useTestServer, type TestUser } from "./helpers";

useTestServer();

let owner: TestUser, admin: TestUser, alice: TestUser, bob: TestUser, outsider: TestUser;
let orgId: string;
const e = (path = "") => `/organisations/${orgId}/expenses${path}`;
const g = (path = "") => `/organisations/${orgId}/goals${path}`;
const today = () => new Date().toISOString();

beforeAll(async () => {
  [owner, admin, alice, bob, outsider] = await registerUsers("Owner", "Admin", "Alice", "Bob", "Outsider");
  orgId = (await createOrg(owner)).id;
  await owner.api.patch(`/organisations/${orgId}`, { currency: "EUR" });
  await addMember(owner, orgId, admin, "ADMIN");
  await addMember(owner, orgId, alice);
  await addMember(owner, orgId, bob);
});

describe("expenses", () => {
  test("submissions start pending in the org currency and notify approvers", async () => {
    const res = await alice.api.post(e(), { title: "Team lunch", amount: 84.5, category: "Meals", date: today() });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "PENDING", currency: "EUR", amount: 84.5 });
    for (const approver of [owner, admin]) {
      expect((await notificationsFor(approver)).some((n) => n.type === "EXPENSE_SUBMITTED")).toBe(true);
    }
  });

  test("validation: positive, max two decimals, not in the future", async () => {
    expect((await alice.api.post(e(), { title: "x", amount: -1, category: "c", date: today() })).status).toBe(400);
    expect((await alice.api.post(e(), { title: "x", amount: 1.234, category: "c", date: today() })).status).toBe(400);
    const future = new Date(Date.now() + 10 * 86_400_000).toISOString();
    expect((await alice.api.post(e(), { title: "x", amount: 10, category: "c", date: future })).status).toBe(400);
  });

  test("members see only their own expenses; admins see everyone's", async () => {
    await bob.api.post(e(), { title: "Taxi", amount: 20, category: "Travel", date: today() });
    const aliceList = await alice.api.get(e());
    expect(aliceList.body.items.every((x: { createdBy: { id: string } }) => x.createdBy.id === alice.id)).toBe(true);
    const adminList = await admin.api.get(e());
    const creators = new Set(adminList.body.items.map((x: { createdBy: { id: string } }) => x.createdBy.id));
    expect(creators.has(alice.id) && creators.has(bob.id)).toBe(true);

    const bobs = adminList.body.items.find((x: { createdBy: { id: string } }) => x.createdBy.id === bob.id);
    expect((await alice.api.patch(e(`/${bobs.id}`), { title: "mine now" })).status).toBe(404);
    expect((await alice.api.delete(e(`/${bobs.id}`))).status).toBe(404);
  });

  test("approval: admins review, members can't, no self-approval for admins, owners may", async () => {
    const aliceExp = (await alice.api.post(e(), { title: "Conference ticket", amount: 300, category: "Training", date: today() })).body;
    const adminExp = (await admin.api.post(e(), { title: "Admin software", amount: 50, category: "Software", date: today() })).body;
    const ownerExp = (await owner.api.post(e(), { title: "Owner hosting", amount: 70, category: "Software", date: today() })).body;

    expect((await bob.api.post(e(`/${aliceExp.id}/approve`))).status).toBe(403);
    expect((await admin.api.post(e(`/${adminExp.id}/approve`))).status).toBe(403);
    expect((await owner.api.post(e(`/${ownerExp.id}/approve`))).status).toBe(200);

    expect((await admin.api.post(e(`/${aliceExp.id}/reject`))).status).toBe(400); // reason required
    const approved = await admin.api.post(e(`/${aliceExp.id}/approve`), { note: "OK" });
    expect(approved.body).toMatchObject({ status: "APPROVED", reviewNote: "OK" });
    expect(approved.body.reviewedBy.id).toBe(admin.id);
    expect((await admin.api.post(e(`/${aliceExp.id}/approve`))).status).toBe(409);
    expect((await notificationsFor(alice)).some((n) => n.type === "EXPENSE_APPROVED")).toBe(true);

    // Approved expenses are locked for the submitter.
    expect((await alice.api.patch(e(`/${aliceExp.id}`), { amount: 3000 })).status).toBe(409);
    expect((await alice.api.delete(e(`/${aliceExp.id}`))).status).toBe(409);
  });

  test("editing a rejected expense resubmits it", async () => {
    const exp = (await bob.api.post(e(), { title: "Gadget", amount: 999, category: "Equipment", date: today() })).body;
    await owner.api.post(e(`/${exp.id}/reject`), { note: "Too expensive" });
    expect((await notificationsFor(bob)).find((n) => n.type === "EXPENSE_REJECTED")?.body).toBe("Too expensive");
    const edited = await bob.api.patch(e(`/${exp.id}`), { amount: 199 });
    expect(edited.body).toMatchObject({ status: "PENDING", amount: 199, reviewNote: null });
  });

  test("summary is scoped and counts approved spend only", async () => {
    const adminSummary = (await admin.api.get(e("/summary"))).body;
    expect(adminSummary.scope).toBe("organisation");
    expect(adminSummary.currency).toBe("EUR");
    expect(adminSummary.byMonth).toHaveLength(6);
    const approvedTotal = await prisma.expense.aggregate({ where: { organisationId: orgId, status: "APPROVED" }, _sum: { amount: true } });
    expect(adminSummary.total).toBe(Number(approvedTotal._sum.amount));
    expect(adminSummary.pending.count).toBeGreaterThan(0);

    const aliceSummary = (await alice.api.get(e("/summary"))).body;
    expect(aliceSummary.scope).toBe("mine");
    expect(aliceSummary.total).toBe(300);
  });

  test("cross-org expense ids are invisible", async () => {
    const exp = (await alice.api.post(e(), { title: "Snacks", amount: 5, category: "Meals", date: today() })).body;
    const other = await createOrg(outsider);
    expect((await outsider.api.post(`/organisations/${other.id}/expenses/${exp.id}/approve`)).status).toBe(404);
  });
});

describe("goals", () => {
  const period = () => ({
    periodStart: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    periodEnd: new Date(Date.now() + 25 * 86_400_000).toISOString(),
  });

  test("budget goals are admin-only and track approved spend", async () => {
    expect((await alice.api.post(g(), { title: "Travel budget", type: "BUDGET", targetValue: 1000, category: "Travel", ...period() })).status).toBe(403);
    const goal = await owner.api.post(g(), { title: "Software budget", type: "BUDGET", targetValue: 1000, category: "Software", ...period() });
    expect(goal.status).toBe(201);
    // Owner's own approved 70; admin's 50 is still pending and must not count.
    expect(goal.body.progress.current).toBe(70);
    expect(goal.body.progress.percent).toBe(7);
    expect(goal.body.progress.health).toBe("ON_TRACK");
  });

  test("metric goals update through check-ins and compute health", async () => {
    const created = await alice.api.post(g(), { title: "Onboard customers", type: "METRIC", targetValue: 20, unit: "customers", ...period() });
    expect(created.status).toBe(201);
    expect(created.body.owner.id).toBe(alice.id);

    const checkIn = await alice.api.post(g(`/${created.body.id}/check-ins`), { value: 20, note: "Hit it early" });
    expect(checkIn.status).toBe(201);
    expect(checkIn.body.goal.progress).toMatchObject({ current: 20, percent: 100, health: "ACHIEVED" });

    const detail = await alice.api.get(g(`/${created.body.id}`));
    expect(detail.body.checkIns[0]).toMatchObject({ value: 20, note: "Hit it early" });
    expect(detail.body.canManage).toBe(true);

    // Others can view but not manage.
    expect((await bob.api.get(g(`/${created.body.id}`))).body.canManage).toBe(false);
    expect((await bob.api.post(g(`/${created.body.id}/check-ins`), { value: 1 })).status).toBe(403);
    expect((await bob.api.patch(g(`/${created.body.id}`), { title: "mine" })).status).toBe(403);
    expect((await bob.api.delete(g(`/${created.body.id}`))).status).toBe(403);
    expect((await admin.api.patch(g(`/${created.body.id}`), { targetValue: 40 })).body.progress.percent).toBe(50);
  });

  test("ticket goals count resolutions automatically", async () => {
    const goal = (await admin.api.post(g(), { title: "Resolve tickets", type: "TICKETS_RESOLVED", targetValue: 2, ownerId: bob.id, ...period() })).body;
    expect(goal.progress.current).toBe(0);
    const ticket = (await alice.api.post(`/organisations/${orgId}/tickets`, { title: "Goal-tracked ticket", assigneeId: bob.id })).body;
    await bob.api.post(`/organisations/${orgId}/tickets/${ticket.number}/status`, { status: "RESOLVED", resolutionNote: "done" });
    expect((await bob.api.get(g(`/${goal.id}`))).body.progress.current).toBe(1);
    expect((await bob.api.post(g(`/${goal.id}/check-ins`), { value: 5 })).status).toBe(409);
  });

  test("validation and reference checks", async () => {
    const bad = await alice.api.post(g(), { title: "Backwards", targetValue: 5, periodStart: today(), periodEnd: new Date(Date.now() - 86_400_000).toISOString() });
    expect(bad.status).toBe(400);
    expect((await alice.api.post(g(), { title: "Owner outside", targetValue: 5, ownerId: outsider.id, ...period() })).status).toBe(400);
    const mine = await alice.api.get(g("?owner=me"));
    expect(mine.body.every((x: { ownerId: string }) => x.ownerId === alice.id)).toBe(true);
  });
});
