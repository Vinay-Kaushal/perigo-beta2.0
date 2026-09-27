import { afterAll, beforeAll, expect } from "bun:test";
import type { Server } from "http";
import type { AddressInfo } from "net";
import Redis from "ioredis";
import { createApp } from "../app";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { outbox } from "../lib/mailer";

/** Fields that must never appear in any API response. */
const SECRET_FIELDS = ["passwordHash", "tokenVersion", "tokenHash", "mfaSecret", "mfaLastStep", "codeHash", "clientSecret", "verificationToken"];

let server: Server | null = null;
let baseUrl = "";
let counter = 0;

export const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export async function resetDatabase() {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  }
  await redis().flushdb();
  outbox.length = 0;
}

/** Call at the top of every integration test file. */
export function useTestServer() {
  beforeAll(async () => {
    await resetDatabase();
    if (!server) {
      server = createApp().listen(0);
      await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    }
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = null;
  });
}

export interface ApiResponse<T = any> {
  status: number;
  body: T;
  headers: Headers;
  text: string;
}

export async function request<T = any>(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string>; raw?: string | Uint8Array; redirect?: "manual" } = {}
): Promise<ApiResponse<T>> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(opts.body !== undefined || typeof opts.raw === "string" ? { "Content-Type": "application/json" } : {}),
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...opts.headers,
    },
    body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    ...(opts.redirect ? { redirect: opts.redirect } : {}),
  });
  const contentType = res.headers.get("content-type") ?? "";
  const binary = !contentType.startsWith("text/csv") && (contentType.includes("application/pdf") || contentType.startsWith("image/") || !!res.headers.get("content-disposition"));
  const text = binary ? "" : await res.text();
  let body: any = text;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    /* not JSON */
  }
  // Global safety net: every test doubles as a data-leak check.
  for (const field of SECRET_FIELDS) {
    if (text.includes(`"${field}"`)) {
      throw new Error(`Response to ${method} ${path} leaked "${field}": ${text.slice(0, 300)}`);
    }
  }
  return { status: res.status, body, headers: res.headers, text };
}

export function client(token?: string) {
  return {
    token,
    get: <T = any>(path: string) => request<T>("GET", path, { token }),
    post: <T = any>(path: string, body?: unknown) => request<T>("POST", path, { token, body: body ?? {} }),
    patch: <T = any>(path: string, body?: unknown) => request<T>("PATCH", path, { token, body: body ?? {} }),
    put: <T = any>(path: string, body?: unknown) => request<T>("PUT", path, { token, body: body ?? {} }),
    delete: <T = any>(path: string, body?: unknown) => request<T>("DELETE", path, { token, body }),
  };
}

export type Client = ReturnType<typeof client>;
export interface TestUser {
  id: string;
  email: string;
  name: string;
  token: string;
  api: Client;
}

export const PASSWORD = "Sup3r-secret-pass";

/** The token from the most recent email to `to` whose link contains `path` (e.g. "/verify-email"). */
export function tokenFromOutbox(to: string, path: string) {
  const message = [...outbox].reverse().find((m) => m.to === to && m.text.includes(path));
  const token = message?.text.match(new RegExp(`${path}\\?token=([A-Za-z0-9_-]+)`))?.[1];
  if (!token) throw new Error(`No ${path} email for ${to}`);
  return token;
}

/** Registers and (by default) verifies the email through the real emailed link. */
export async function registerUser(name = "User", opts: { verify?: boolean; domain?: string } = {}): Promise<TestUser> {
  const email = `${name.toLowerCase().replace(/\W+/g, "")}-${uid()}@${opts.domain ?? "example.com"}`;
  const res = await request("POST", "/auth/register", { body: { email, password: PASSWORD, name } });
  expect(res.status).toBe(201);
  if (opts.verify !== false) {
    const verified = await request("POST", "/auth/verify-email", { body: { token: tokenFromOutbox(email, "/verify-email") } });
    expect(verified.status).toBe(200);
  }
  return { id: res.body.user.id, email, name, token: res.body.token, api: client(res.body.token) };
}

export async function registerUsers<const N extends readonly string[]>(...names: N): Promise<{ -readonly [K in keyof N]: TestUser }> {
  return Promise.all(names.map((n) => registerUser(n))) as never;
}

export async function createOrg(owner: TestUser, overrides: Record<string, unknown> = {}) {
  const res = await owner.api.post("/organisations", { name: "Acme Corp", slug: `acme-${uid()}`, ...overrides });
  expect(res.status).toBe(201);
  return res.body as { id: string; slug: string; name: string; ticketPrefix: string };
}

/** Runs the real invite → accept → approve flow so membership tests exercise production code. */
export async function addMember(owner: TestUser, orgId: string, user: TestUser, role: "MEMBER" | "ADMIN" | "OWNER" = "MEMBER") {
  const invite = await owner.api.post(`/organisations/${orgId}/invitations`, {
    email: user.email,
    role: role === "OWNER" ? "ADMIN" : role,
  });
  expect(invite.status).toBe(201);
  const token = tokenFromUrl(invite.body.inviteUrl);
  const accepted = await user.api.post(`/invitations/${token}/accept`);
  expect([201, 202]).toContain(accepted.status);
  if (accepted.status === 202) {
    const approved = await owner.api.post(`/organisations/${orgId}/invitations/${invite.body.id}/approve`);
    expect(approved.status).toBe(200);
  }
  if (role === "OWNER") {
    const member = await prisma.organisationMember.findUniqueOrThrow({
      where: { userId_organisationId: { userId: user.id, organisationId: orgId } },
    });
    const promoted = await owner.api.patch(`/organisations/${orgId}/members/${member.id}`, { role: "OWNER" });
    expect(promoted.status).toBe(200);
  }
}

export function tokenFromUrl(url: string) {
  const token = url.split("/invitations/")[1];
  if (!token) throw new Error(`No token in ${url}`);
  return token;
}

/** Records realtime events published to Redis on the given pattern (e.g. "org:*"). */
export async function recordEvents(pattern: string) {
  const sub = new Redis(process.env.REDIS_URL!);
  const events: Array<{ channel: string; type: string; data: any; actorId: string | null }> = [];
  sub.on("pmessage", (_p, channel, message) => {
    const payload = JSON.parse(message);
    events.push({ channel, type: payload.type, data: payload.data, actorId: payload.actorId });
  });
  await sub.psubscribe(pattern);
  return {
    events,
    /** Waits briefly for async delivery, then returns matching events. */
    async find(predicate: (e: (typeof events)[number]) => boolean, timeoutMs = 1000) {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        const found = events.filter(predicate);
        if (found.length) return found;
        await Bun.sleep(20);
      }
      return events.filter(predicate);
    },
    close: () => sub.quit(),
  };
}

export async function notificationsFor(user: TestUser) {
  const res = await user.api.get("/me/notifications?limit=100");
  expect(res.status).toBe(200);
  return res.body.items as Array<{ type: string; title: string; body: string | null; link: string | null; readAt: string | null; id: string }>;
}
