import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { outbox, setTestTransport } from "../lib/mailer";
import { deadLetters, MAX_ATTEMPTS, runEmailWorkerTick } from "../services/emailQueue";
import { addMember, createOrg, registerUser, registerUsers, request, useTestServer, type TestUser } from "./helpers";

useTestServer();

let owner: TestUser, alice: TestUser, bob: TestUser;
let orgId: string;
const t = (p = "") => `/organisations/${orgId}/tickets${p}`;
const mailsTo = (u: TestUser) => outbox.filter((m) => m.to === u.email && !m.subject.startsWith("Verify") && !m.subject.includes("invited you"));

beforeAll(async () => {
  [owner, alice, bob] = await registerUsers("Owner", "Alice", "Bob");
  orgId = (await createOrg(owner, { name: "Mail Co" })).id;
  await addMember(owner, orgId, alice);
  await addMember(owner, orgId, bob);
  await runEmailWorkerTick(); // flush anything queued during setup
  outbox.length = 0;
});

afterEach(() => setTestTransport(null));

describe("notification emails", () => {
  test("an assignment is emailed after the batch window, with the ticket link", async () => {
    const ticket = (await alice.api.post(t(), { title: "Server room too hot", assigneeId: bob.id })).body;
    expect(mailsTo(bob)).toHaveLength(0); // queued, not sent inline

    const stats = await runEmailWorkerTick(Date.now() + 1000);
    expect(stats.sent).toBeGreaterThanOrEqual(1);
    const [mail] = mailsTo(bob);
    expect(mail!.subject).toBe(`Alice assigned ${ticket.key} to you`);
    expect(mail!.text).toContain(`/orgs/${orgId}/tickets/${ticket.number}`);
    expect(mail!.headers?.["List-Unsubscribe"]).toContain("/email/unsubscribe?token=");
  });

  test("several notifications for one person become a single digest", async () => {
    await runEmailWorkerTick(Date.now() + 1000);
    outbox.length = 0;
    for (let i = 0; i < 3; i++) await alice.api.post(t(), { title: `Batch ticket ${i}`, assigneeId: bob.id });
    await runEmailWorkerTick(Date.now() + 1000);
    const mails = mailsTo(bob);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.subject).toBe("3 new updates in perigo");
  });

  test("notifications already read in the app aren't emailed", async () => {
    outbox.length = 0;
    await alice.api.post(t(), { title: "Read before email", assigneeId: bob.id });
    expect((await bob.api.post("/me/notifications/read-all")).status).toBe(204);
    const stats = await runEmailWorkerTick(Date.now() + 1000);
    expect(mailsTo(bob)).toHaveLength(0);
    expect(stats.skipped).toBeGreaterThanOrEqual(1);
  });

  test("the batch window holds emails until it's due", async () => {
    outbox.length = 0;
    await alice.api.post(t(), { title: "Due later", assigneeId: bob.id });
    // Simulate a window that hasn't elapsed yet.
    await redis().zadd("email:flush", "XX", Date.now() + 60_000, bob.id);
    await runEmailWorkerTick(Date.now());
    expect(mailsTo(bob)).toHaveLength(0);
    await runEmailWorkerTick(Date.now() + 61_000);
    expect(mailsTo(bob)).toHaveLength(1);
  });

  test("unverified addresses never receive notification emails", async () => {
    const unverified = await registerUser("Unverified", { verify: false });
    await prisma.organisationMember.create({ data: { userId: unverified.id, organisationId: orgId, role: "MEMBER" } });
    outbox.length = 0;
    await owner.api.post(t(), { title: "For unverified", assigneeId: unverified.id });
    await runEmailWorkerTick(Date.now() + 1000);
    expect(outbox.filter((m) => m.to === unverified.email)).toHaveLength(0);
    // …but they still get the in-app notification.
    const inbox = await unverified.api.get("/me/notifications");
    expect(inbox.body.items.some((n: { type: string }) => n.type === "TICKET_ASSIGNED")).toBe(true);
  });

  test("ticket activity is in-app only by default (email is opt-in)", async () => {
    const ticket = (await alice.api.post(t(), { title: "Quiet activity", assigneeId: bob.id })).body;
    await runEmailWorkerTick(Date.now() + 1000);
    outbox.length = 0;
    await alice.api.post(t(`/${ticket.number}/comments`), { body: "Just an update" });
    await runEmailWorkerTick(Date.now() + 1000);
    expect(mailsTo(bob)).toHaveLength(0);
    expect((await bob.api.get("/me/notifications?limit=5")).body.items[0].type).toBe("TICKET_COMMENTED");
  });
});

describe("preferences", () => {
  test("defaults, validation and updates", async () => {
    const prefs = await alice.api.get("/me/notification-preferences");
    expect(prefs.status).toBe(200);
    expect(prefs.body.emailVerified).toBe(true);
    const byCategory = Object.fromEntries(prefs.body.categories.map((c: { category: string }) => [c.category, c]));
    expect(byCategory.ASSIGNMENTS).toMatchObject({ inApp: true, email: true, label: "Assignments" });
    expect(byCategory.TICKET_UPDATES.email).toBe(false);

    expect((await alice.api.patch("/me/notification-preferences", { categories: [{ category: "NOPE", email: true }] })).status).toBe(400);
    expect((await alice.api.patch("/me/notification-preferences", { categories: [{ category: "MENTIONS" }] })).status).toBe(400);

    const updated = await alice.api.patch("/me/notification-preferences", { categories: [{ category: "TICKET_UPDATES", email: true }, { category: "MENTIONS", inApp: false }] });
    expect(updated.status).toBe(200);
    const after = Object.fromEntries(updated.body.categories.map((c: { category: string }) => [c.category, c]));
    expect(after.TICKET_UPDATES).toMatchObject({ inApp: true, email: true });
    expect(after.MENTIONS).toMatchObject({ inApp: false, email: true });
  });

  test("in-app off: no notification row or live push; email still arrives", async () => {
    await bob.api.patch("/me/notification-preferences", { categories: [{ category: "ASSIGNMENTS", inApp: false, email: true }] });
    await bob.api.post("/me/notifications/read-all");
    outbox.length = 0;
    const ticket = (await alice.api.post(t(), { title: "Email only", assigneeId: bob.id })).body;
    expect((await bob.api.get("/me/notifications/unread-count")).body.count).toBe(0);
    await runEmailWorkerTick(Date.now() + 1000);
    expect(mailsTo(bob).map((m) => m.subject)).toEqual([`Alice assigned ${ticket.key} to you`]);
    await bob.api.patch("/me/notification-preferences", { categories: [{ category: "ASSIGNMENTS", inApp: true }] });
  });

  test("email switched off after queueing is respected at send time", async () => {
    outbox.length = 0;
    await alice.api.post(t(), { title: "Changed my mind", assigneeId: bob.id });
    await bob.api.patch("/me/notification-preferences", { categories: [{ category: "ASSIGNMENTS", email: false }] });
    await runEmailWorkerTick(Date.now() + 1000);
    expect(mailsTo(bob)).toHaveLength(0);
    await bob.api.patch("/me/notification-preferences", { categories: [{ category: "ASSIGNMENTS", email: true }] });
  });

  test("preferences are private to each user", async () => {
    expect((await request("GET", "/me/notification-preferences")).status).toBe(401);
  });
});

describe("unsubscribe", () => {
  function tokenFrom(mail: { headers?: Record<string, string> }) {
    return new URL(/<(.*)>/.exec(mail.headers!["List-Unsubscribe"]!)![1]!).searchParams.get("token")!;
  }

  test("one-click (RFC 8058) turns off that category's emails without a session", async () => {
    outbox.length = 0;
    await alice.api.post(t(), { title: "Unsubscribe me", assigneeId: bob.id });
    await runEmailWorkerTick(Date.now() + 1000);
    const token = tokenFrom(mailsTo(bob)[0]!);

    const res = await request("POST", `/email/unsubscribe?token=${encodeURIComponent(token)}`, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      raw: "List-Unsubscribe=One-Click",
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ unsubscribed: "ASSIGNMENTS" });

    const prefs = await bob.api.get("/me/notification-preferences");
    expect(prefs.body.categories.find((c: { category: string }) => c.category === "ASSIGNMENTS")).toMatchObject({ email: false, inApp: true });

    outbox.length = 0;
    await alice.api.post(t(), { title: "After unsubscribe", assigneeId: bob.id });
    await runEmailWorkerTick(Date.now() + 1000);
    expect(mailsTo(bob)).toHaveLength(0);
    await bob.api.patch("/me/notification-preferences", { categories: [{ category: "ASSIGNMENTS", email: true }] });
  });

  test("tampered or unknown tokens are rejected", async () => {
    expect((await request("POST", "/email/unsubscribe", { body: { token: "not.a.token" } })).status).toBe(400);
    expect((await request("POST", "/email/unsubscribe", { body: { token: `${bob.id}.ALL.forgedsignaturexxxxxxxxxxxxxxxxxxxxxxx` } })).status).toBe(400);
  });
});

describe("delivery failures", () => {
  test("failed sends retry with backoff, then land in the dead-letter list", async () => {
    await runEmailWorkerTick(Date.now() + 1000);
    outbox.length = 0;
    let calls = 0;
    setTestTransport(async () => {
      calls++;
      throw new Error("SMTP 421 try again later");
    });

    await alice.api.post(t(), { title: "Provider down", assigneeId: bob.id });
    let now = Date.now() + 1000;
    const first = await runEmailWorkerTick(now);
    expect(first).toMatchObject({ sent: 0, retried: 1 });

    // Not retried before the backoff elapses.
    expect((await runEmailWorkerTick(now + 1000)).retried).toBe(0);

    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      now += 60 * 60 * 1000;
      await runEmailWorkerTick(now);
    }
    expect(calls).toBe(MAX_ATTEMPTS);
    const dead = await deadLetters();
    expect(dead[0]).toMatchObject({ userId: bob.id, attempts: MAX_ATTEMPTS, error: "SMTP 421 try again later" });
    expect(await redis().zcard("email:retry")).toBe(0);
  });

  test("a transient failure succeeds on retry without duplicates", async () => {
    outbox.length = 0;
    let fail = true;
    setTestTransport(async () => {
      if (fail) {
        fail = false;
        throw new Error("timeout");
      }
    });
    await alice.api.post(t(), { title: "Flaky provider", assigneeId: bob.id });
    const now = Date.now() + 1000;
    expect((await runEmailWorkerTick(now)).retried).toBe(1);
    expect((await runEmailWorkerTick(now + 60_000)).sent).toBe(1);
    expect(mailsTo(bob)).toHaveLength(1);
  });

  test("concurrent workers never send the same batch twice", async () => {
    outbox.length = 0;
    await alice.api.post(t(), { title: "Race", assigneeId: bob.id });
    const now = Date.now() + 1000;
    await Promise.all([runEmailWorkerTick(now), runEmailWorkerTick(now), runEmailWorkerTick(now)]);
    expect(mailsTo(bob)).toHaveLength(1);
  });

  test("a failing queue never breaks the user's action", async () => {
    const client = redis() as unknown as { multi: () => unknown };
    const originalMulti = client.multi.bind(client);
    // Make every queue write fail as if Redis were unreachable.
    client.multi = () => {
      const chain: Record<string, unknown> = {};
      for (const cmd of ["rpush", "expire", "zadd", "lrange", "del", "lpush", "ltrim", "incr"]) chain[cmd] = () => chain;
      chain.exec = () => Promise.reject(new Error("redis down"));
      return chain;
    };
    try {
      const res = await alice.api.post(t(), { title: "Queue down", assigneeId: bob.id });
      expect(res.status).toBe(201);
      // The in-app notification still landed.
      const inbox = await bob.api.get("/me/notifications?limit=1");
      expect(inbox.body.items[0].type).toBe("TICKET_ASSIGNED");
    } finally {
      client.multi = originalMulti;
    }
  });
});
