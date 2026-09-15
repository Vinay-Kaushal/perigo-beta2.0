import { beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { outbox } from "../lib/mailer";
import { totpAt } from "../lib/totp";
import { PASSWORD, addMember, client, createOrg, registerUser, request, useTestServer, type TestUser } from "./helpers";

useTestServer();

/** Lets a test use another code right away, as if the next 30-second window had arrived. */
const forgetLastStep = (userId: string) => prisma.user.update({ where: { id: userId }, data: { mfaLastStep: null } });

async function enableMfa(user: TestUser) {
  const setup = await user.api.post("/auth/mfa/setup");
  expect(setup.status).toBe(200);
  const enabled = await user.api.post("/auth/mfa/enable", { code: totpAt(setup.body.secret, Date.now()) });
  expect(enabled.status).toBe(200);
  await forgetLastStep(user.id);
  return { secret: setup.body.secret as string, recoveryCodes: enabled.body.recoveryCodes as string[] };
}

const passwordLogin = (email: string, password = PASSWORD) => request("POST", "/auth/login", { body: { email, password } });

describe("turning 2FA on", () => {
  test("setup → confirm with a code → recovery codes, with an email alert", async () => {
    const user = await registerUser("Setup");
    expect((await user.api.get("/auth/mfa")).body).toEqual({ enabled: false, enabledAt: null, recoveryCodesRemaining: 0 });

    const setup = await user.api.post("/auth/mfa/setup");
    expect(setup.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.body.otpauthUri).toStartWith("otpauth://totp/perigo%3A");
    expect(setup.body.qrSvg).toStartWith("<svg");

    const wrong = await user.api.post("/auth/mfa/enable", { code: "000000" });
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe("INVALID_MFA_CODE");

    const enabled = await user.api.post("/auth/mfa/enable", { code: totpAt(setup.body.secret, Date.now()) });
    expect(enabled.status).toBe(200);
    expect(enabled.body.recoveryCodes).toHaveLength(10);
    // This session proved the second factor, so it's reissued with that recorded.
    expect(enabled.headers.getSetCookie().some((c) => c.startsWith("perigo_session="))).toBe(true);

    const status = await user.api.get("/auth/mfa");
    expect(status.body).toMatchObject({ enabled: true, recoveryCodesRemaining: 10 });
    expect(outbox.some((m) => m.to === user.email && m.subject === "Two-factor authentication is on")).toBe(true);
    expect((await user.api.post("/auth/mfa/setup")).status).toBe(409);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.mfaSecret).not.toContain(setup.body.secret);
    const codes = await prisma.mfaRecoveryCode.findMany({ where: { userId: user.id } });
    expect(codes.every((c) => !enabled.body.recoveryCodes.includes(c.codeHash))).toBe(true);
  });

  test("a pending setup expires and can't be confirmed without one", async () => {
    const user = await registerUser("NoSetup");
    const res = await user.api.post("/auth/mfa/enable", { code: "123456" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("MFA_SETUP_EXPIRED");
  });
});

describe("signing in with 2FA", () => {
  let user: TestUser;
  let secret: string;
  let recoveryCodes: string[];

  beforeAll(async () => {
    user = await registerUser("Login");
    ({ secret, recoveryCodes } = await enableMfa(user));
  });

  test("the password alone yields a challenge, not a session", async () => {
    const res = await passwordLogin(user.email);
    expect(res.status).toBe(200);
    expect(res.body.mfaRequired).toBe(true);
    expect(res.body.mfaToken).toBeString();
    expect(res.body.token).toBeUndefined();
    expect(res.headers.getSetCookie().some((c) => c.startsWith("perigo_session="))).toBe(false);

    // A wrong password never reveals that 2FA is on.
    const bad = await passwordLogin(user.email, "Wrong-password-1");
    expect(bad.status).toBe(401);
    expect(bad.body.mfaRequired).toBeUndefined();
  });

  test("a correct code completes sign-in; the same code can't be replayed", async () => {
    const first = await passwordLogin(user.email);
    const wrong = await request("POST", "/auth/mfa/verify", { body: { mfaToken: first.body.mfaToken, code: "000000" } });
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe("INVALID_MFA_CODE");

    const code = totpAt(secret, Date.now());
    const ok = await request("POST", "/auth/mfa/verify", { body: { mfaToken: first.body.mfaToken, code } });
    expect(ok.status).toBe(200);
    expect(ok.body.user.id).toBe(user.id);
    const me = await client(ok.body.token).get("/auth/me");
    expect(me.body.session).toEqual({ methods: ["pwd", "otp"], sso: false });
    expect(me.body.mfaEnabledAt).toBeString();

    // The challenge is single-use…
    expect((await request("POST", "/auth/mfa/verify", { body: { mfaToken: first.body.mfaToken, code } })).status).toBe(401);
    // …and so is the code, even on a fresh challenge.
    const second = await passwordLogin(user.email);
    const replay = await request("POST", "/auth/mfa/verify", { body: { mfaToken: second.body.mfaToken, code } });
    expect(replay.status).toBe(401);
    await forgetLastStep(user.id);
  });

  test("concurrent use of one code succeeds at most once", async () => {
    const [a, b] = await Promise.all([passwordLogin(user.email), passwordLogin(user.email)]);
    const code = totpAt(secret, Date.now());
    const results = await Promise.all([
      request("POST", "/auth/mfa/verify", { body: { mfaToken: a.body.mfaToken, code } }),
      request("POST", "/auth/mfa/verify", { body: { mfaToken: b.body.mfaToken, code } }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    await forgetLastStep(user.id);
  });

  test("recovery codes work once each and trigger an alert", async () => {
    const challenge = await passwordLogin(user.email);
    const res = await request("POST", "/auth/mfa/verify", { body: { mfaToken: challenge.body.mfaToken, recoveryCode: recoveryCodes[0]!.toUpperCase() } });
    expect(res.status).toBe(200);
    expect((await client(res.body.token).get("/auth/me")).body.session.methods).toEqual(["pwd", "rec"]);
    expect(outbox.some((m) => m.to === user.email && m.subject === "A recovery code was used to sign in" && m.text.includes("9 unused"))).toBe(true);

    const again = await passwordLogin(user.email);
    const reused = await request("POST", "/auth/mfa/verify", { body: { mfaToken: again.body.mfaToken, recoveryCode: recoveryCodes[0] } });
    expect(reused.status).toBe(401);
    expect((await user.api.get("/auth/mfa")).body.recoveryCodesRemaining).toBe(9);
  });

  test("too many wrong codes burn the challenge", async () => {
    const challenge = await passwordLogin(user.email);
    for (let i = 0; i < 5; i++) {
      expect((await request("POST", "/auth/mfa/verify", { body: { mfaToken: challenge.body.mfaToken, code: "000000" } })).status).toBe(401);
    }
    const locked = await request("POST", "/auth/mfa/verify", { body: { mfaToken: challenge.body.mfaToken, code: totpAt(secret, Date.now()) } });
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe("MFA_CHALLENGE_EXPIRED");
    expect((await request("POST", "/auth/mfa/verify", { body: { mfaToken: challenge.body.mfaToken, code: totpAt(secret, Date.now()) } })).status).toBe(401);
  });

  test("signing out everywhere invalidates challenges issued before it", async () => {
    const challenge = await passwordLogin(user.email);
    const fresh = await passwordLogin(user.email);
    const session = await request("POST", "/auth/mfa/verify", { body: { mfaToken: fresh.body.mfaToken, code: totpAt(secret, Date.now()) } });
    await forgetLastStep(user.id);
    expect((await client(session.body.token).post("/auth/logout-all")).status).toBe(204);
    const res = await request("POST", "/auth/mfa/verify", { body: { mfaToken: challenge.body.mfaToken, code: totpAt(secret, Date.now()) } });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("MFA_CHALLENGE_EXPIRED");
    const relogin = await passwordLogin(user.email);
    const done = await request("POST", "/auth/mfa/verify", { body: { mfaToken: relogin.body.mfaToken, code: totpAt(secret, Date.now()) } });
    expect(done.status).toBe(200);
    user = { ...user, token: done.body.token, api: client(done.body.token) };
    await forgetLastStep(user.id);
  });

  test("malformed verify requests are rejected", async () => {
    expect((await request("POST", "/auth/mfa/verify", { body: { mfaToken: "short", code: "123456" } })).status).toBe(401);
    expect((await request("POST", "/auth/mfa/verify", { body: { mfaToken: "x".repeat(40) } })).status).toBe(400);
    expect((await request("POST", "/auth/mfa/verify", { body: { mfaToken: "x".repeat(40), code: "123456", recoveryCode: "abcde-fghjk" } })).status).toBe(400);
  });

  test("regenerating recovery codes needs an authenticator code and voids the old ones", async () => {
    expect((await user.api.post("/auth/mfa/recovery-codes", { code: "000000" })).status).toBe(400);
    const res = await user.api.post("/auth/mfa/recovery-codes", { code: totpAt(secret, Date.now()) });
    expect(res.status).toBe(200);
    expect(res.body.recoveryCodes).toHaveLength(10);
    await forgetLastStep(user.id);

    const challenge = await passwordLogin(user.email);
    expect((await request("POST", "/auth/mfa/verify", { body: { mfaToken: challenge.body.mfaToken, recoveryCode: recoveryCodes[1] } })).status).toBe(401);
    expect((await request("POST", "/auth/mfa/verify", { body: { mfaToken: challenge.body.mfaToken, recoveryCode: res.body.recoveryCodes[0] } })).status).toBe(200);
  });

  test("turning 2FA off needs a code, alerts, and restores password-only sign-in", async () => {
    expect((await user.api.post("/auth/mfa/disable", { code: "000000" })).status).toBe(400);
    const off = await user.api.post("/auth/mfa/disable", { code: totpAt(secret, Date.now()) });
    expect(off.status).toBe(200);
    expect(outbox.some((m) => m.to === user.email && m.subject === "Two-factor authentication is off")).toBe(true);
    expect(await prisma.mfaRecoveryCode.count({ where: { userId: user.id } })).toBe(0);
    const login = await passwordLogin(user.email);
    expect(login.body.token).toBeString();
    expect(login.body.mfaRequired).toBeUndefined();
  });
});

describe("organisations that require 2FA", () => {
  let owner: TestUser, member: TestUser, leaver: TestUser;
  let orgId: string;
  let memberSecret: string;
  let boardId: string;

  beforeAll(async () => {
    owner = await registerUser("PolicyOwner");
    member = await registerUser("PolicyMember");
    leaver = await registerUser("PolicyLeaver");
    orgId = (await createOrg(owner, { name: "Strict Co" })).id;
    await addMember(owner, orgId, member);
    await addMember(owner, orgId, leaver);
    boardId = (await owner.api.post(`/organisations/${orgId}/boards`, { name: "Roadmap" })).body.id;
    await owner.api.post(`/boards/${boardId}/members`, { userId: member.id });
    const board = await owner.api.get(`/boards/${boardId}`);
    const task = await owner.api.post(`/boards/${boardId}/tasks`, { title: "Ship 2FA", statusId: board.body.taskStatuses[0].id, assigneeIds: [member.id] });
    expect(task.status).toBe(201);
    await owner.api.post(`/organisations/${orgId}/tickets`, { title: "Visible only with 2FA", assigneeId: member.id });
  });

  test("only an owner who has 2FA can require it", async () => {
    expect((await member.api.patch(`/organisations/${orgId}/security`, { requireMfa: true })).status).toBe(403);
    const blocked = await owner.api.patch(`/organisations/${orgId}/security`, { requireMfa: true });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("MFA_NOT_ENABLED");

    const { secret } = await enableMfa(owner);
    void secret;
    const socketEvents: string[] = [];
    const sub = redis().duplicate();
    await sub.subscribe(`user:${member.id}`);
    sub.on("message", (_c, m) => socketEvents.push(JSON.parse(m).type));

    const ok = await owner.api.patch(`/organisations/${orgId}/security`, { requireMfa: true });
    expect(ok.status).toBe(200);
    expect(ok.body.requireMfa).toBe(true);
    expect(ok.body.mfa.withoutMfa.map((u: { id: string }) => u.id).sort()).toEqual([member.id, leaver.id].sort());
    await Bun.sleep(100);
    expect(socketEvents).toContain("ACCESS_CHANGED");
    await sub.quit();
    expect(await prisma.auditLog.count({ where: { organisationId: orgId, action: "security.mfa_required" } })).toBe(1);
  });

  test("members without 2FA are locked out of org content, but can still leave", async () => {
    const res = await member.api.get(`/organisations/${orgId}/tickets`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("MFA_REQUIRED");
    expect(res.body.details.organisation).toMatchObject({ id: orgId, name: "Strict Co" });
    expect((await member.api.get(`/organisations/${orgId}`)).status).toBe(403);
    expect((await member.api.get(`/boards/${boardId}`)).status).toBe(403);

    const list = await member.api.get("/organisations");
    expect(list.body.find((o: { id: string }) => o.id === orgId).locked).toBe(true);
    const dash = await member.api.get("/me/dashboard");
    expect(dash.body.orgs.find((o: { id: string }) => o.id === orgId).locked).toBe(true);
    expect(dash.body.tickets.assignedOpen).toBe(0);
    expect(dash.body.tasks.open).toBe(0);

    // The owner (with 2FA) is unaffected.
    expect((await owner.api.get(`/organisations/${orgId}/tickets`)).status).toBe(200);

    expect((await leaver.api.delete(`/organisations/${orgId}/members/me`)).status).toBe(204);
  });

  test("notifications from a locked org are hidden until 2FA is on", async () => {
    const before = await member.api.get("/me/notifications");
    expect(before.body.items.every((n: { organisation: { id: string } | null }) => n.organisation?.id !== orgId)).toBe(true);
    expect(await prisma.notification.count({ where: { userId: member.id, organisationId: orgId } })).toBeGreaterThan(0);

    ({ secret: memberSecret } = await enableMfa(member));
    const after = await member.api.get("/me/notifications");
    expect(after.body.items.some((n: { organisation: { id: string } | null }) => n.organisation?.id === orgId)).toBe(true);
    expect((await member.api.get(`/organisations/${orgId}/tickets`)).status).toBe(200);
    expect((await member.api.get(`/boards/${boardId}`)).status).toBe(200);
    const unlocked = (await member.api.get("/me/dashboard")).body;
    expect(unlocked.tickets.assignedOpen).toBe(1);
    expect(unlocked.tasks.open).toBe(1);
  });

  test("members can't turn 2FA off while an org requires it", async () => {
    const res = await member.api.post("/auth/mfa/disable", { code: totpAt(memberSecret, Date.now()) });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("MFA_REQUIRED_BY_ORG");
    expect(res.body.error).toContain("Strict Co");
  });

  test("websocket tickets carry what the realtime service needs to apply the policy", async () => {
    const res = await member.api.post("/auth/ws-ticket");
    const stored = JSON.parse((await redis().get(`ws:ticket:${res.body.ticket}`))!);
    expect(stored).toMatchObject({ userId: member.id, ssoConnectionId: null });
  });

  test("admins can read the security overview; members and outsiders can't", async () => {
    const outsider = await registerUser("PolicyOutsider");
    expect((await owner.api.get(`/organisations/${orgId}/security`)).status).toBe(200);
    expect((await member.api.get(`/organisations/${orgId}/security`)).status).toBe(403);
    expect((await outsider.api.get(`/organisations/${orgId}/security`)).status).toBe(404);
  });
});
