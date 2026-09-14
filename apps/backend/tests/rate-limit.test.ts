import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { hasCredentials, rateLimit } from "../middleware/rateLimit";
import { client, registerUser, request, useTestServer } from "./helpers";
import { redis } from "../lib/redis";

useTestServer();

describe("rateLimit middleware", () => {
  let server: Server;
  let base = "";

  beforeAll(async () => {
    const app = express();
    app.get(
      "/limited",
      rateLimit({ name: `probe-${Date.now()}`, windowSec: 60, max: () => 3, key: (req) => String(req.headers["x-who"]), skip: (req) => req.headers["x-skip"] === "1" }),
      (_req, res) => res.json({ ok: true })
    );
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const hit = (who: string, headers: Record<string, string> = {}) => fetch(`${base}/limited`, { headers: { "x-who": who, ...headers } });

  test("blocks after the limit, per identity, with standard headers", async () => {
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await hit("alice")).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
    const blocked = await hit("alice");
    expect(blocked.headers.get("retry-after")).toBeString();
    expect(blocked.headers.get("ratelimit-remaining")).toBe("0");
    // Another identity (e.g. a colleague behind the same NAT) is unaffected.
    expect((await hit("bob")).status).toBe(200);
  });

  test("skip bypasses the limiter", async () => {
    for (let i = 0; i < 5; i++) expect((await hit("carol", { "x-skip": "1" })).status).toBe(200);
  });
});

describe("credential detection", () => {
  const req = (headers: Record<string, string>) => ({ headers }) as unknown as import("express").Request;
  test("bearer tokens and the session cookie count as credentials", () => {
    expect(hasCredentials(req({ authorization: "Bearer abc" }))).toBe(true);
    expect(hasCredentials(req({ cookie: "theme=dark; perigo_session=xyz" }))).toBe(true);
    expect(hasCredentials(req({ cookie: "not_perigo_session=1" }))).toBe(false);
    expect(hasCredentials(req({ authorization: "Basic abc" }))).toBe(false);
    expect(hasCredentials(req({}))).toBe(false);
  });
});

describe("authenticated traffic", () => {
  test("many users from one IP are counted per user, never against the shared IP bucket", async () => {
    const users = await Promise.all([registerUser("NatA"), registerUser("NatB")]);
    const ipCount = async () => {
      const keys = await redis().keys("rl:global:*");
      const values = keys.length ? await redis().mget(...keys) : [];
      return values.reduce((sum, v) => sum + Number(v ?? 0), 0);
    };
    const before = await ipCount();
    for (let i = 0; i < 5; i++) for (const u of users) expect((await u.api.get("/auth/me")).status).toBe(200);
    expect(await ipCount()).toBe(before);

    const userKeys = await redis().keys("rl:user:*");
    for (const u of users) expect(userKeys.some((k) => k.startsWith(`rl:user:${u.id}:`))).toBe(true);
  });

  // Keep last: it exhausts this IP's bad-credential budget for the rest of the file.
  test("flooding with bad credentials is throttled per IP", async () => {
    let last = 0;
    for (let i = 0; i < 70 && last !== 429; i++) {
      last = (await client(`garbage-token-${i}`).get("/auth/me")).status;
    }
    expect(last).toBe(429);
    // Anonymous (no credentials) traffic is on a separate bucket.
    expect((await request("GET", "/health")).status).toBe(200);
  });
});
