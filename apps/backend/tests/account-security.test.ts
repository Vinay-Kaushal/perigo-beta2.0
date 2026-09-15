import { describe, expect, test } from "bun:test";
import { prisma } from "../lib/prisma";
import { outbox } from "../lib/mailer";
import { PASSWORD, createOrg, registerUser, request, tokenFromOutbox, tokenFromUrl, uid, useTestServer } from "./helpers";

useTestServer();

/** Pulls the session cookie out of a Set-Cookie header. */
function sessionCookie(headers: Headers) {
  const raw = headers.getSetCookie().find((c) => c.startsWith("perigo_session="));
  return raw ? { raw, pair: raw.split(";")[0]! } : null;
}

describe("browser sessions (httpOnly cookie)", () => {
  test("login sets an httpOnly, SameSite=Lax cookie that authenticates reads", async () => {
    const u = await registerUser("Cookie");
    const res = await request("POST", "/auth/login", { body: { email: u.email, password: PASSWORD } });
    const cookie = sessionCookie(res.headers);
    expect(cookie).not.toBeNull();
    expect(cookie!.raw).toContain("HttpOnly");
    expect(cookie!.raw).toContain("SameSite=Lax");
    expect(cookie!.raw).toContain("Path=/");

    const me = await request("GET", "/auth/me", { headers: { Cookie: cookie!.pair } });
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(u.email);
  });

  test("cookie-authenticated writes require the CSRF header", async () => {
    const u = await registerUser("Csrf");
    const cookie = sessionCookie((await request("POST", "/auth/login", { body: { email: u.email, password: PASSWORD } })).headers)!;

    const forged = await request("POST", "/organisations", { headers: { Cookie: cookie.pair }, body: { name: "Forged", slug: `forged-${uid()}` } });
    expect(forged.status).toBe(403);
    expect(forged.body.code).toBe("CSRF");

    const forgedPut = await request("PUT", `/organisations/${uid()}/sla`, { headers: { Cookie: cookie.pair }, body: { resetPolicies: ["LOW"] } });
    expect(forgedPut.status).toBe(403);
    expect(forgedPut.body.code).toBe("CSRF");

    const wrongValue = await request("PATCH", "/auth/me", { headers: { Cookie: cookie.pair, "X-CSRF-Protection": "yes" }, body: { name: "x" } });
    expect(wrongValue.status).toBe(403);

    const ok = await request("POST", "/organisations", {
      headers: { Cookie: cookie.pair, "X-CSRF-Protection": "1" },
      body: { name: "Legit", slug: `legit-${uid()}` },
    });
    expect(ok.status).toBe(201);
  });

  test("bearer-token clients are unaffected by the CSRF rule", async () => {
    const u = await registerUser("Bearer");
    expect((await u.api.patch("/auth/me", { name: "Still works" })).status).toBe(200);
  });

  test("CORS allows credentials and the CSRF header for the app origin only", async () => {
    const preflight = await request("OPTIONS", "/organisations", {
      headers: { Origin: "http://localhost:3000", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,x-csrf-protection" },
    });
    expect(preflight.headers.get("access-control-allow-credentials")).toBe("true");
    expect(preflight.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("x-csrf-protection");
    expect(preflight.headers.get("access-control-allow-methods")).toContain("PUT");

    const evil = await request("OPTIONS", "/organisations", { headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" } });
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("logout clears the cookie; logout-all also revokes the token server-side", async () => {
    const u = await registerUser("Logout");
    const login = await request("POST", "/auth/login", { body: { email: u.email, password: PASSWORD } });
    const cookie = sessionCookie(login.headers)!;

    const out = await request("POST", "/auth/logout", { headers: { Cookie: cookie.pair } });
    expect(out.status).toBe(204);
    expect(sessionCookie(out.headers)?.raw).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/);

    const all = await request("POST", "/auth/logout-all", { headers: { Cookie: cookie.pair, "X-CSRF-Protection": "1" } });
    expect(all.status).toBe(204);
    expect((await request("GET", "/auth/me", { headers: { Cookie: cookie.pair } })).status).toBe(401);
  });
});

describe("email verification", () => {
  test("new accounts get a verification email; unverified users can't create orgs or invite", async () => {
    const u = await registerUser("Unverified", { verify: false });
    expect((await u.api.get("/auth/me")).body.emailVerifiedAt).toBeNull();
    const email = outbox.find((m) => m.to === u.email)!;
    expect(email.subject).toContain("Verify");

    const blocked = await u.api.post("/organisations", { name: "Nope", slug: `nope-${uid()}` });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("EMAIL_NOT_VERIFIED");

    const token = tokenFromOutbox(u.email, "/verify-email");
    expect((await request("POST", "/auth/verify-email", { body: { token } })).status).toBe(200);
    expect((await u.api.get("/auth/me")).body.emailVerifiedAt).toBeString();
    expect((await u.api.post("/organisations", { name: "Now OK", slug: `ok-${uid()}` })).status).toBe(201);

    // Single use.
    expect((await request("POST", "/auth/verify-email", { body: { token } })).status).toBe(400);
  });

  test("resending invalidates the previous link; expired links fail", async () => {
    const u = await registerUser("Resend", { verify: false });
    const first = tokenFromOutbox(u.email, "/verify-email");
    expect((await u.api.post("/auth/resend-verification")).body.sent).toBe(true);
    const second = tokenFromOutbox(u.email, "/verify-email");
    expect(second).not.toBe(first);
    expect((await request("POST", "/auth/verify-email", { body: { token: first } })).status).toBe(400);

    await prisma.authToken.updateMany({ where: { userId: u.id, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await request("POST", "/auth/verify-email", { body: { token: second } })).status).toBe(400);
  });

  test("accepting an emailed invitation verifies the address", async () => {
    const owner = await registerUser("Owner");
    const invitee = await registerUser("Invitee", { verify: false });
    const org = await createOrg(owner);
    const invite = await owner.api.post(`/organisations/${org.id}/invitations`, { email: invitee.email });
    expect((await invitee.api.post(`/invitations/${tokenFromUrl(invite.body.inviteUrl)}/accept`)).status).toBe(202);
    expect((await invitee.api.get("/auth/me")).body.emailVerifiedAt).toBeString();
  });

  test("tokens of the wrong type are rejected", async () => {
    const u = await registerUser("Types");
    await request("POST", "/auth/forgot-password", { body: { email: u.email } });
    const resetToken = tokenFromOutbox(u.email, "/reset-password");
    expect((await request("POST", "/auth/verify-email", { body: { token: resetToken } })).status).toBe(400);
  });
});

describe("password reset", () => {
  test("same response whether or not the account exists", async () => {
    const u = await registerUser("Forgot");
    const known = await request("POST", "/auth/forgot-password", { body: { email: u.email } });
    const unknown = await request("POST", "/auth/forgot-password", { body: { email: `ghost-${uid()}@example.com` } });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual(unknown.body);
    expect(outbox.some((m) => m.to.startsWith("ghost-"))).toBe(false);
  });

  test("reset changes the password, signs out every session, and is single-use", async () => {
    const u = await registerUser("Reset");
    await request("POST", "/auth/forgot-password", { body: { email: u.email } });
    const token = tokenFromOutbox(u.email, "/reset-password");

    expect((await request("POST", "/auth/reset-password", { body: { token, newPassword: "short" } })).status).toBe(400);
    const res = await request("POST", "/auth/reset-password", { body: { token, newPassword: "Fresh-password-9" } });
    expect(res.status).toBe(204);

    expect((await u.api.get("/auth/me")).status).toBe(401);
    expect((await request("POST", "/auth/login", { body: { email: u.email, password: PASSWORD } })).status).toBe(401);
    expect((await request("POST", "/auth/login", { body: { email: u.email, password: "Fresh-password-9" } })).status).toBe(200);
    expect((await request("POST", "/auth/reset-password", { body: { token, newPassword: "Another-pass-8" } })).status).toBe(400);
  });

  test("requesting a new link invalidates older ones; expired links fail", async () => {
    const u = await registerUser("Relink");
    await request("POST", "/auth/forgot-password", { body: { email: u.email } });
    const first = tokenFromOutbox(u.email, "/reset-password");
    await request("POST", "/auth/forgot-password", { body: { email: u.email } });
    const second = tokenFromOutbox(u.email, "/reset-password");
    expect((await request("POST", "/auth/reset-password", { body: { token: first, newPassword: "Whatever-pass-1" } })).status).toBe(400);

    await prisma.authToken.updateMany({ where: { userId: u.id, type: "PASSWORD_RESET", usedAt: null }, data: { expiresAt: new Date(Date.now() - 1) } });
    expect((await request("POST", "/auth/reset-password", { body: { token: second, newPassword: "Whatever-pass-1" } })).status).toBe(400);
  });

  test("concurrent redemptions of one link succeed at most once", async () => {
    const u = await registerUser("Race");
    await request("POST", "/auth/forgot-password", { body: { email: u.email } });
    const token = tokenFromOutbox(u.email, "/reset-password");
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => request("POST", "/auth/reset-password", { body: { token, newPassword: `Racer-pass-${i}a` } }))
    );
    expect(results.filter((r) => r.status === 204)).toHaveLength(1);
  });

  test("only hashes are stored", async () => {
    const u = await registerUser("Hashes");
    await request("POST", "/auth/forgot-password", { body: { email: u.email } });
    const token = tokenFromOutbox(u.email, "/reset-password");
    const rows = await prisma.authToken.findMany({ where: { userId: u.id } });
    expect(rows.every((r) => r.tokenHash !== token && r.tokenHash.length === 64)).toBe(true);
  });
});
