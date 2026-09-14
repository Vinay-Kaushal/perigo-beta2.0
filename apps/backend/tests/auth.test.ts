import { describe, expect, test } from "bun:test";
import jwt from "jsonwebtoken";
import { PASSWORD, client, registerUser, request, uid, useTestServer } from "./helpers";
import { redis } from "../lib/redis";

useTestServer();

describe("registration", () => {
  test("creates an account and returns a working token", async () => {
    const email = `new-${uid()}@example.com`;
    const res = await request("POST", "/auth/register", { body: { email, password: PASSWORD, name: "Ada" } });
    expect(res.status).toBe(201);
    expect(res.body.user).toEqual({ id: expect.any(String), email, name: "Ada", avatarUrl: null, emailVerifiedAt: null });

    const me = await client(res.body.token).get("/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(email);
  });

  test("normalises email case and rejects duplicates", async () => {
    const email = `Case-${uid()}@Example.com`;
    const first = await request("POST", "/auth/register", { body: { email, password: PASSWORD, name: "A" } });
    expect(first.body.user.email).toBe(email.toLowerCase());
    const dup = await request("POST", "/auth/register", { body: { email: email.toUpperCase(), password: PASSWORD, name: "B" } });
    expect(dup.status).toBe(409);
  });

  test.each([
    ["short", "a1"],
    ["no digit", "abcdefghij"],
    ["no letter", "1234567890"],
    ["too long", `a1${"x".repeat(80)}`],
  ])("rejects weak password (%s)", async (_label, password) => {
    const res = await request("POST", "/auth/register", { body: { email: `w-${uid()}@example.com`, password, name: "W" } });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });

  test("rejects invalid email", async () => {
    const res = await request("POST", "/auth/register", { body: { email: "not-an-email", password: PASSWORD, name: "X" } });
    expect(res.status).toBe(400);
  });
});

describe("login", () => {
  test("succeeds with correct credentials, case-insensitive email", async () => {
    const u = await registerUser("Login");
    const res = await request("POST", "/auth/login", { body: { email: u.email.toUpperCase(), password: PASSWORD } });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeString();
  });

  test("same generic error for wrong password and unknown email", async () => {
    const u = await registerUser("Login");
    const wrong = await request("POST", "/auth/login", { body: { email: u.email, password: "Wrong-pass-1" } });
    const unknown = await request("POST", "/auth/login", { body: { email: `nobody-${uid()}@example.com`, password: PASSWORD } });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toBe(unknown.body.error);
  });

  test("Google sign-in reports not configured rather than crashing", async () => {
    const res = await request("POST", "/auth/google", { body: { idToken: "x" } });
    expect(res.status).toBe(501);
  });
});

describe("tokens and sessions", () => {
  test("requests without or with garbage tokens are rejected", async () => {
    expect((await request("GET", "/auth/me")).status).toBe(401);
    expect((await client("garbage").get("/auth/me")).status).toBe(401);
  });

  test("tokens signed with another secret, alg=none, or wrong audience are rejected", async () => {
    const u = await registerUser("Forge");
    const forged = jwt.sign({ email: u.email, tv: 0 }, "some-other-secret-some-other-secret", {
      subject: u.id,
      issuer: "perigo",
      audience: "perigo-api",
    });
    expect((await client(forged).get("/auth/me")).status).toBe(401);

    const none = jwt.sign({ sub: u.id, email: u.email, tv: 0, iss: "perigo", aud: "perigo-api" }, "", { algorithm: "none" });
    expect((await client(none).get("/auth/me")).status).toBe(401);

    const wrongAud = jwt.sign({ email: u.email, tv: 0 }, process.env.JWT_SECRET!, { subject: u.id, issuer: "perigo", audience: "other" });
    expect((await client(wrongAud).get("/auth/me")).status).toBe(401);
  });

  test("changing password signs out other sessions and returns a fresh token", async () => {
    const u = await registerUser("Rotate");
    const other = await request("POST", "/auth/login", { body: { email: u.email, password: PASSWORD } });

    const wrong = await u.api.post("/auth/change-password", { currentPassword: "Nope-nope-1", newPassword: "Brand-new-pass-2" });
    expect(wrong.status).toBe(400);

    const res = await u.api.post("/auth/change-password", { currentPassword: PASSWORD, newPassword: "Brand-new-pass-2" });
    expect(res.status).toBe(200);

    expect((await u.api.get("/auth/me")).status).toBe(401);
    expect((await client(other.body.token).get("/auth/me")).status).toBe(401);
    expect((await client(res.body.token).get("/auth/me")).status).toBe(200);

    const oldLogin = await request("POST", "/auth/login", { body: { email: u.email, password: PASSWORD } });
    expect(oldLogin.status).toBe(401);
  });

  test("sign out everywhere revokes the current token", async () => {
    const u = await registerUser("Everywhere");
    expect((await u.api.post("/auth/logout-all")).status).toBe(204);
    expect((await u.api.get("/auth/me")).status).toBe(401);
  });

  test("websocket tickets are short-lived and bound to the user", async () => {
    const u = await registerUser("Socket");
    const res = await u.api.post("/auth/ws-ticket");
    expect(res.status).toBe(201);
    const stored = await redis().get(`ws:ticket:${res.body.ticket}`);
    expect(JSON.parse(stored!).userId).toBe(u.id);
    const ttl = await redis().ttl(`ws:ticket:${res.body.ticket}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30);
  });
});

describe("profile", () => {
  test("updates name and only accepts http(s) avatar URLs", async () => {
    const u = await registerUser("Profile");
    const ok = await u.api.patch("/auth/me", { name: "Renamed", avatarUrl: "https://example.com/a.png" });
    expect(ok.status).toBe(200);
    expect(ok.body.name).toBe("Renamed");

    const xss = await u.api.patch("/auth/me", { avatarUrl: "javascript:alert(1)" });
    expect(xss.status).toBe(400);
  });
});

describe("HTTP hardening", () => {
  test("sets security headers and a request id, hides the framework", async () => {
    const res = await request("GET", "/health");
    expect(res.headers.get("x-powered-by")).toBeNull();
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("x-request-id")).toBeString();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  test("CORS only reflects allowed origins", async () => {
    const allowed = await request("GET", "/health", { headers: { Origin: "http://localhost:3000" } });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    const evil = await request("GET", "/health", { headers: { Origin: "https://evil.example" } });
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("malformed JSON is a 400, not a 500", async () => {
    const res = await request("POST", "/auth/login", { raw: "{not json" });
    expect(res.status).toBe(400);
  });

  test("oversized bodies are rejected", async () => {
    const res = await request("POST", "/auth/login", { raw: JSON.stringify({ email: "a@b.co", password: "x".repeat(300_000) }) });
    expect(res.status).toBe(413);
  });

  test("unknown routes return 404 for authenticated callers and 401 for anonymous ones", async () => {
    const u = await registerUser("Routes");
    expect((await u.api.get("/definitely-not-a-route")).status).toBe(404);
    expect((await request("GET", "/definitely-not-a-route")).status).toBe(401);
  });

  test("login is rate limited per IP + email", async () => {
    const original = process.env.RATE_LIMIT_AUTH_MAX;
    // env() is cached, so exercise the limiter by exceeding the configured test max on one identity.
    const email = `limited-${uid()}@example.com`;
    const max = Number(original);
    let last = 0;
    for (let i = 0; i <= max; i++) {
      last = (await request("POST", "/auth/login", { body: { email, password: "Wrong-pass-1" } })).status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
    // A different identity isn't affected.
    const other = await request("POST", "/auth/login", { body: { email: `other-${uid()}@example.com`, password: "Wrong-pass-1" } });
    expect(other.status).toBe(401);
  }, 60_000);
});
