import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes, randomUUID } from "crypto";
import Redis from "ioredis";
import { prisma } from "db/client";
import { createWsServer } from "../server";

const ORIGIN = "http://localhost:3000";
const redis = new Redis(process.env.REDIS_URL!);
let server: Awaited<ReturnType<typeof createWsServer>>;

type Frame = { type: string; [k: string]: any };

async function seed() {
  const suffix = randomUUID().slice(0, 8);
  const mkUser = (name: string) =>
    prisma.user.create({ data: { email: `${name}-${suffix}@ws.test`, name, passwordHash: "x" } });
  const [owner, member, outsider] = await Promise.all([mkUser("owner"), mkUser("member"), mkUser("outsider")]);
  const org = await prisma.organisation.create({ data: { name: "WS Org", slug: `ws-${suffix}` } });
  const ownerM = await prisma.organisationMember.create({ data: { userId: owner.id, organisationId: org.id, role: "OWNER" } });
  const memberM = await prisma.organisationMember.create({ data: { userId: member.id, organisationId: org.id, role: "MEMBER" } });
  const board = await prisma.board.create({ data: { name: "B", organisationId: org.id } });
  const privateBoard = await prisma.board.create({ data: { name: "Private", organisationId: org.id } });
  await prisma.boardMember.create({ data: { boardId: board.id, organisationMemberId: memberM.id } });
  return { owner, member, outsider, org, board, privateBoard, ownerM, memberM };
}

async function ticketFor(user: { id: string; email: string; name: string }) {
  const ticket = randomBytes(24).toString("base64url");
  await redis.set(`ws:ticket:${ticket}`, JSON.stringify({ userId: user.id, email: user.email, name: user.name }), "EX", 30);
  return ticket;
}

/** Status the server gives an upgrade attempt — used to assert rejections. */
async function upgradeStatus(ticket: string, origin = ORIGIN) {
  const res = await fetch(`http://127.0.0.1:${server.port}/?ticket=${ticket}`, {
    headers: { Origin: origin, Upgrade: "websocket", Connection: "Upgrade" },
  });
  return res.status;
}

/** Connects and buffers frames so tests can await specific messages. */
async function connect(user: { id: string; email: string; name: string }) {
  const ticket = await ticketFor(user);
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/?ticket=${ticket}`, { headers: { Origin: ORIGIN } } as never);
  const frames: Frame[] = [];
  const closed = new Promise<number>((resolve) => ws.addEventListener("close", (e) => resolve(e.code)));
  ws.addEventListener("message", (e) => frames.push(JSON.parse(String(e.data))));
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("connection failed")), { once: true });
  });
  const next = async (predicate: (f: Frame) => boolean, timeoutMs = 1500) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const idx = frames.findIndex(predicate);
      if (idx !== -1) return frames.splice(idx, 1)[0]!;
      await Bun.sleep(10);
    }
    throw new Error(`Timed out waiting for frame. Got: ${JSON.stringify(frames)}`);
  };
  const none = async (predicate: (f: Frame) => boolean, waitMs = 300) => {
    await Bun.sleep(waitMs);
    return !frames.some(predicate);
  };
  const send = (msg: unknown) => ws.send(JSON.stringify(msg));
  await next((f) => f.type === "ready");
  return { ws, frames, next, none, send, closed };
}

const publish = (channel: string, type: string, data: unknown = {}) => {
  const [scope, targetId] = channel.split(":");
  return redis.publish(channel, JSON.stringify({ scope, targetId, type, actorId: null, data, timestamp: new Date().toISOString() }));
};

beforeAll(async () => {
  server = await createWsServer({ port: 0, redisUrl: process.env.REDIS_URL!, allowedOrigins: [ORIGIN], messagesPerSecond: 20, log: () => {} });
});

afterAll(async () => {
  await server.close();
  await redis.quit();
});

describe("connection auth", () => {
  test("rejects missing, bogus, and reused tickets", async () => {
    const { owner } = await seed();
    expect(await upgradeStatus("nope")).toBe(401);
    expect(await upgradeStatus(randomBytes(24).toString("base64url"))).toBe(401);

    const ticket = await ticketFor(owner);
    expect(await redis.exists(`ws:ticket:${ticket}`)).toBe(1);
    // A real handshake redeems it...
    const first = new WebSocket(`ws://127.0.0.1:${server.port}/?ticket=${ticket}`, { headers: { Origin: ORIGIN } } as never);
    await new Promise((resolve) => first.addEventListener("open", resolve, { once: true }));
    // ...and it can't be used twice.
    expect(await redis.exists(`ws:ticket:${ticket}`)).toBe(0);
    expect(await upgradeStatus(ticket)).toBe(401);
    first.close();
  });

  test("rejects disallowed origins", async () => {
    const { owner } = await seed();
    const ticket = await ticketFor(owner);
    expect(await upgradeStatus(ticket, "https://evil.example")).toBe(403);
    // A rejected origin doesn't burn the ticket.
    expect(await redis.exists(`ws:ticket:${ticket}`)).toBe(1);
  });
});

describe("subscriptions", () => {
  test("enforces org and board access rules", async () => {
    const { member, outsider, org, board, privateBoard } = await seed();
    const m = await connect(member);
    m.send({ type: "subscribe", channel: `org:${org.id}` });
    expect((await m.next((f) => f.type.startsWith("subscribe"))).type).toBe("subscribed");
    m.send({ type: "subscribe", channel: `board:${board.id}` });
    expect((await m.next((f) => f.type.startsWith("subscribe"))).type).toBe("subscribed");
    m.send({ type: "subscribe", channel: `board:${privateBoard.id}` });
    expect((await m.next((f) => f.type.startsWith("subscribe"))).type).toBe("subscribe_denied");

    const o = await connect(outsider);
    o.send({ type: "subscribe", channel: `org:${org.id}` });
    expect((await o.next((f) => f.type.startsWith("subscribe"))).type).toBe("subscribe_denied");
    o.send({ type: "subscribe", channel: `user:${member.id}` });
    expect((await o.next((f) => f.type.startsWith("subscribe"))).reason).toBe("Invalid channel");
    m.ws.close();
    o.ws.close();
  });

  test("owners reach every board in their org", async () => {
    const { owner, privateBoard } = await seed();
    const c = await connect(owner);
    c.send({ type: "subscribe", channel: `board:${privateBoard.id}` });
    expect((await c.next((f) => f.type.startsWith("subscribe"))).type).toBe("subscribed");
    c.ws.close();
  });
});

describe("fan-out", () => {
  test("org, board and personal events reach only the right sockets", async () => {
    const { owner, member, outsider, org, board } = await seed();
    const m = await connect(member);
    const o = await connect(outsider);
    const w = await connect(owner);
    m.send({ type: "subscribe", channel: `org:${org.id}` });
    await m.next((f) => f.type === "subscribed");

    await publish(`org:${org.id}`, "TICKET_ASSIGNED", { key: "TKT-1" });
    const evt = await m.next((f) => f.type === "event");
    expect(evt.event).toMatchObject({ type: "TICKET_ASSIGNED", data: { key: "TKT-1" } });
    expect(await o.none((f) => f.type === "event")).toBe(true);
    expect(await w.none((f) => f.type === "event", 50)).toBe(true); // owner never subscribed

    await publish(`user:${member.id}`, "NOTIFICATION_CREATED", { title: "hi" });
    expect((await m.next((f) => f.type === "event")).channel).toBe(`user:${member.id}`);
    expect(await o.none((f) => f.type === "event")).toBe(true);

    await publish(`board:${board.id}`, "TASK_MOVED");
    expect(await m.none((f) => f.type === "event" && f.channel.startsWith("board:"))).toBe(true); // not subscribed to board

    for (const c of [m, o, w]) c.ws.close();
  });

  test("access revocation drops subscriptions before delivering further events", async () => {
    const { member, org, board, memberM } = await seed();
    const m = await connect(member);
    m.send({ type: "subscribe", channel: `org:${org.id}` });
    m.send({ type: "subscribe", channel: `board:${board.id}` });
    await m.next((f) => f.type === "subscribed");
    await m.next((f) => f.type === "subscribed");

    await prisma.organisationMember.delete({ where: { id: memberM.id } });
    await publish(`user:${member.id}`, "ACCESS_REVOKED", { organisationId: org.id });

    const dropped = [await m.next((f) => f.type === "unsubscribed"), await m.next((f) => f.type === "unsubscribed")];
    expect(dropped.map((d) => d.channel).sort()).toEqual([`board:${board.id}`, `org:${org.id}`].sort());
    await m.next((f) => f.type === "event" && f.event.type === "ACCESS_REVOKED");

    await publish(`org:${org.id}`, "TICKET_CREATED");
    expect(await m.none((f) => f.type === "event" && f.event.type === "TICKET_CREATED")).toBe(true);
    m.ws.close();
  });
});

describe("presence", () => {
  test("board presence roster, cursors and departures", async () => {
    const { owner, member, board } = await seed();
    const a = await connect(owner);
    const b = await connect(member);
    a.send({ type: "subscribe", channel: `board:${board.id}` });
    await a.next((f) => f.type === "subscribed");
    b.send({ type: "subscribe", channel: `board:${board.id}` });
    await b.next((f) => f.type === "subscribed");

    const sync = await a.next((f) => f.type === "presence:sync" && f.users.length === 2);
    expect(sync.users.map((u: { name: string }) => u.name).sort()).toEqual(["member", "owner"]);

    b.send({ type: "presence:cursor", channel: `board:${board.id}`, x: 10.6, y: 20 });
    const cursor = await a.next((f) => f.type === "presence:cursor");
    expect(cursor).toMatchObject({ userId: member.id, x: 11, y: 20, name: "member" });

    // Garbage coordinates are dropped, not relayed.
    b.send({ type: "presence:cursor", channel: `board:${board.id}`, x: "1e999", y: {} });
    b.send({ type: "presence:cursor", channel: `board:${board.id}`, x: 1e9, y: 0 });
    expect(await a.none((f) => f.type === "presence:cursor")).toBe(true);

    b.ws.close();
    await a.next((f) => f.type === "presence:left" && f.userId === member.id);
    a.ws.close();
  });

  test("can't send presence into rooms you haven't joined", async () => {
    const { owner, outsider, board } = await seed();
    const a = await connect(owner);
    const o = await connect(outsider);
    a.send({ type: "subscribe", channel: `board:${board.id}` });
    await a.next((f) => f.type === "subscribed");
    o.send({ type: "presence:cursor", channel: `board:${board.id}`, x: 1, y: 1 });
    expect(await a.none((f) => f.type === "presence:cursor")).toBe(true);
    a.ws.close();
    o.ws.close();
  });
});

describe("abuse resistance", () => {
  test("malformed frames get an error, floods are throttled, oversized frames close the socket", async () => {
    const { owner } = await seed();
    const c = await connect(owner);
    c.ws.send("{not json");
    expect((await c.next((f) => f.type === "error")).message).toBe("Malformed message");

    for (let i = 0; i < 100; i++) c.send({ type: "ping" });
    await c.next((f) => f.type === "error" && f.message === "Rate limit exceeded");

    // Over the 16KB cap the server drops the connection (Bun closes without a 1009 frame, so the client sees 1006).
    c.ws.send("x".repeat(20 * 1024));
    const code = await Promise.race([c.closed, Bun.sleep(2000).then(() => -1)]);
    expect([1006, 1009]).toContain(code);
  });
});
