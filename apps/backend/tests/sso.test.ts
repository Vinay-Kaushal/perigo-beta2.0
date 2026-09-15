import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPair } from "jose";
import { prisma } from "../lib/prisma";
import { outbox } from "../lib/mailer";
import { resetEnvCache } from "../lib/env";
import { setTxtResolver } from "../lib/dnsTxt";
import { decryptSecret } from "../lib/crypto";
import { totpAt } from "../lib/totp";
import { invalidateSsoPolicyCache } from "../services/ssoPolicy";
import { PASSWORD, addMember, client, createOrg, registerUser, request, useTestServer, type TestUser } from "./helpers";
import { startMockOidc, type MockOidc } from "./support/mockOidc";

useTestServer();

const DOMAIN = "acme-sso.test";
let idp: MockOidc;
let owner: TestUser, admin: TestUser, alice: TestUser;
let orgId: string;
const txt = new Map<string, string[]>();
const org = (path: string) => `/organisations/${orgId}${path}`;

beforeAll(async () => {
  idp = await startMockOidc();
  setTxtResolver(async (name) => txt.get(name) ?? []);
  owner = await registerUser("SsoOwner", { domain: DOMAIN });
  admin = await registerUser("SsoAdmin");
  alice = await registerUser("Alice", { domain: DOMAIN });
  orgId = (await createOrg(owner, { name: "Acme SSO" })).id;
  await addMember(owner, orgId, admin, "ADMIN");
  await addMember(owner, orgId, alice);
});

afterAll(() => {
  idp.stop();
  setTxtResolver(null);
});

const sessionCookie = (headers: Headers) => headers.getSetCookie().find((c) => c.startsWith("perigo_session="))?.split(";")[0];
const stateCookie = (headers: Headers) => headers.getSetCookie().find((c) => c.startsWith("perigo_sso_state="))?.split(";")[0];

/**
 * Drives a whole browser round-trip: our redirect to the IdP, the user
 * "signing in" there, and the IdP's redirect back to our callback.
 */
async function ssoRoundTrip(startPath: string, idpUser: { email: string; sub?: string; name?: string }, opts: { token?: string; dropStateCookie?: boolean } = {}) {
  const start = await request("GET", startPath, { redirect: "manual", token: opts.token });
  const location = start.headers.get("location") ?? "";
  if (!location.startsWith(idp.issuer)) return { start, callback: null, location };
  const authorize = new URL(location);
  const cookie = stateCookie(start.headers);

  const form = new URLSearchParams(authorize.searchParams);
  form.set("email", idpUser.email);
  if (idpUser.sub) form.set("sub", idpUser.sub);
  if (idpUser.name) form.set("name", idpUser.name);
  const approved = await fetch(`${idp.issuer}/authorize`, { method: "POST", body: form, redirect: "manual" });
  const back = new URL(approved.headers.get("location")!);

  const callback = await request("GET", `/auth/sso/callback${back.search}`, {
    redirect: "manual",
    headers: cookie && !opts.dropStateCookie ? { Cookie: cookie } : {},
  });
  return { start, callback, location: callback.headers.get("location") ?? "", authorize, back };
}

async function configureSso(overrides: Record<string, unknown> = {}) {
  return owner.api.put(org("/sso"), {
    issuer: idp.issuer,
    clientId: idp.clientId,
    clientSecret: idp.clientSecret,
    enabled: true,
    enforce: false,
    autoProvision: false,
    ...overrides,
  });
}

describe("verified domains", () => {
  test("owners claim a domain and prove it with a DNS TXT record", async () => {
    expect((await admin.api.post(org("/domains"), { domain: DOMAIN })).status).toBe(403);
    expect((await owner.api.post(org("/domains"), { domain: "not a domain" })).status).toBe(400);
    expect((await owner.api.post(org("/domains"), { domain: "-bad.example" })).status).toBe(400);

    const added = await owner.api.post(org("/domains"), { domain: ` ${DOMAIN.toUpperCase()} ` });
    expect(added.status).toBe(201);
    const domain = added.body.domains[0];
    expect(domain).toMatchObject({ domain: DOMAIN, verifiedAt: null });
    expect(domain.record.name).toBe(`_perigo-challenge.${DOMAIN}`);
    expect(domain.record.value).toStartWith("perigo-domain-verification=");

    const early = await owner.api.post(org(`/domains/${domain.id}/verify`));
    expect(early.status).toBe(422);
    expect(early.body.code).toBe("DOMAIN_NOT_VERIFIED");

    txt.set(domain.record.name, ["v=spf1 -all", domain.record.value]);
    const verified = await owner.api.post(org(`/domains/${domain.id}/verify`));
    expect(verified.status).toBe(200);
    expect(verified.body.domains[0].verifiedAt).toBeString();
    expect(await prisma.auditLog.count({ where: { organisationId: orgId, action: "domain.verified" } })).toBe(1);
  });

  test("a domain can only be verified by one organisation", async () => {
    const rival = await registerUser("Rival");
    const rivalOrg = await createOrg(rival, { name: "Squatter" });
    const claim = await rival.api.post(`/organisations/${rivalOrg.id}/domains`, { domain: DOMAIN });
    expect(claim.status).toBe(201);
    const record = claim.body.domains[0].record;
    txt.set(record.name, [...(txt.get(record.name) ?? []), record.value]);
    const res = await rival.api.post(`/organisations/${rivalOrg.id}/domains/${claim.body.domains[0].id}/verify`);
    expect(res.status).toBe(409);
    // Another org's domain id is not reachable through this org.
    expect((await owner.api.post(org(`/domains/${claim.body.domains[0].id}/verify`))).status).toBe(404);
  });
});

describe("configuring the connection", () => {
  test("validates the issuer by discovery and never returns or logs the secret", async () => {
    expect((await admin.api.put(org("/sso"), { issuer: idp.issuer, clientId: "x", clientSecret: "y", enabled: true, enforce: false, autoProvision: false })).status).toBe(403);
    const noSecret = await owner.api.put(org("/sso"), { issuer: idp.issuer, clientId: idp.clientId, enabled: true, enforce: false, autoProvision: false });
    expect(noSecret.status).toBe(400);
    const unreachable = await configureSso({ issuer: "http://localhost:1" });
    expect(unreachable.status).toBe(422);
    expect(unreachable.body.code).toBe("SSO_DISCOVERY_FAILED");

    const res = await configureSso();
    expect(res.status).toBe(200);
    expect(res.body.sso).toMatchObject({ issuer: idp.issuer, clientId: idp.clientId, hasClientSecret: true, enabled: true, enforce: false, testedAt: null });
    expect(res.body.callbackUrl).toBe("http://localhost:4000/auth/sso/callback");

    const row = await prisma.ssoConnection.findUniqueOrThrow({ where: { organisationId: orgId } });
    expect(row.clientSecret).not.toContain(idp.clientSecret);
    expect(decryptSecret(row.clientSecret)).toBe(idp.clientSecret);
    const audits = await prisma.auditLog.findMany({ where: { organisationId: orgId, action: { startsWith: "sso." } } });
    expect(JSON.stringify(audits)).not.toContain(idp.clientSecret);
  });

  test("issuers on private networks are refused unless the operator allows them", async () => {
    process.env.SSO_ALLOW_PRIVATE_NETWORK = "false";
    resetEnvCache();
    try {
      const res = await configureSso({ clientSecret: "another-secret" });
      expect(res.status).toBe(422);
      expect(res.body.error).toContain("private or reserved address");
    } finally {
      process.env.SSO_ALLOW_PRIVATE_NETWORK = "true";
      resetEnvCache();
    }
  });

  test("enforcement needs a successful test first", async () => {
    const res = await configureSso({ enforce: true });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("Test the connection");
  });

  test("owners can test the connection without changing their session", async () => {
    expect((await admin.api.get(org("/sso/test"))).status).toBe(403);
    const { callback, location } = await ssoRoundTrip(org("/sso/test"), { email: "tester@acme-sso.test" }, { token: owner.token });
    expect(callback!.status).toBe(302);
    expect(location).toBe(`http://localhost:3000/orgs/${orgId}/settings?sso_test=ok&email=tester%40acme-sso.test#sso`);
    expect(sessionCookie(callback!.headers)).toBeUndefined();
    expect((await prisma.ssoConnection.findUniqueOrThrow({ where: { organisationId: orgId } })).testedAt).not.toBeNull();
    // No account was created or linked by a test.
    expect(await prisma.user.count({ where: { email: "tester@acme-sso.test" } })).toBe(0);
    expect(await prisma.ssoIdentity.count()).toBe(0);
  });

  test("changing credentials clears the test result", async () => {
    await configureSso({ clientSecret: idp.clientSecret });
    expect((await owner.api.get(org("/security"))).body.sso.testedAt).toBeNull();
    await ssoRoundTrip(org("/sso/test"), { email: "tester@acme-sso.test" }, { token: owner.token });
    expect((await owner.api.get(org("/security"))).body.sso.testedAt).toBeString();
    // Toggling options alone keeps it.
    const toggled = await owner.api.put(org("/sso"), { issuer: idp.issuer, clientId: idp.clientId, enabled: true, enforce: false, autoProvision: false });
    expect(toggled.body.sso.testedAt).toBeString();
  });
});

describe("signing in with SSO", () => {
  test("an existing account on a verified domain signs in and gets linked", async () => {
    const { start, callback, location, authorize } = await ssoRoundTrip(`/auth/sso/start?email=${encodeURIComponent(alice.email)}&next=/orgs/${orgId}/tickets`, { email: alice.email, sub: "idp-alice" });
    expect(start.status).toBe(302);
    expect(authorize!.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize!.searchParams.get("login_hint")).toBe(alice.email);
    expect(authorize!.searchParams.get("nonce")).toBeString();
    expect(stateCookie(start.headers)).toBeString();
    expect(start.headers.getSetCookie().find((c) => c.startsWith("perigo_sso_state="))).toContain("HttpOnly");

    expect(callback!.status).toBe(302);
    expect(location).toBe(`http://localhost:3000/orgs/${orgId}/tickets`);
    const cookie = sessionCookie(callback!.headers)!;
    const me = await request("GET", "/auth/me", { headers: { Cookie: cookie } });
    expect(me.body).toMatchObject({ id: alice.id, session: { methods: ["sso"], sso: true } });
    const identity = await prisma.ssoIdentity.findFirstOrThrow({ where: { subject: "idp-alice" } });
    expect(identity.userId).toBe(alice.id);
  });

  test("the IdP subject keeps identifying the same account", async () => {
    const renamed = `alice.renamed@${DOMAIN}`;
    const { callback } = await ssoRoundTrip(`/auth/sso/start?email=${encodeURIComponent(alice.email)}`, { email: renamed, sub: "idp-alice" });
    const me = await request("GET", "/auth/me", { headers: { Cookie: sessionCookie(callback!.headers)! } });
    expect(me.body.id).toBe(alice.id);
    expect(await prisma.user.count({ where: { email: renamed } })).toBe(0);
  });

  test("the IdP can't sign anyone in on a domain its org hasn't verified (no account takeover)", async () => {
    const victim = await registerUser("Victim", { domain: "other-company.test" });
    const { callback, location } = await ssoRoundTrip(`/auth/sso/start?email=${encodeURIComponent(alice.email)}`, { email: victim.email, sub: "attacker" });
    expect(location).toBe("http://localhost:3000/login?sso_error=domain_not_verified");
    expect(sessionCookie(callback!.headers)).toBeUndefined();
    expect(await prisma.ssoIdentity.count({ where: { subject: "attacker" } })).toBe(0);
  });

  test("the flow is bound to the browser that started it (login CSRF)", async () => {
    const { callback, location } = await ssoRoundTrip(`/auth/sso/start?email=${encodeURIComponent(alice.email)}`, { email: alice.email, sub: "idp-alice" }, { dropStateCookie: true });
    expect(location).toBe("http://localhost:3000/login?sso_error=state_mismatch");
    expect(sessionCookie(callback!.headers)).toBeUndefined();
  });

  test("a state can't be replayed", async () => {
    const { back, start } = await ssoRoundTrip(`/auth/sso/start?email=${encodeURIComponent(alice.email)}`, { email: alice.email, sub: "idp-alice" });
    const replay = await request("GET", `/auth/sso/callback${back!.search}`, { redirect: "manual", headers: { Cookie: stateCookie(start.headers)! } });
    expect(replay.headers.get("location")).toBe("http://localhost:3000/login?sso_error=expired");
    expect(sessionCookie(replay.headers)).toBeUndefined();
  });

  test("tampered ID tokens are rejected", async () => {
    const { privateKey: rogueKey } = await generateKeyPair("RS256");
    const cases: Array<[string, NonNullable<MockOidc["state"]["nextIdToken"]>]> = [
      ["forged signature", { signWith: rogueKey }],
      ["wrong audience", { claims: { aud: "someone-else" } }],
      ["wrong issuer", { claims: { iss: "http://evil.example" } }],
      ["wrong nonce", { claims: { nonce: "replayed-nonce" } }],
      ["expired", { claims: { exp: Math.floor(Date.now() / 1000) - 600, iat: Math.floor(Date.now() / 1000) - 900 } }],
    ];
    for (const [label, tamper] of cases) {
      idp.state.nextIdToken = tamper;
      const { callback, location } = await ssoRoundTrip(`/auth/sso/start?email=${encodeURIComponent(alice.email)}`, { email: alice.email, sub: "idp-alice" });
      expect({ label, location }).toEqual({ label, location: "http://localhost:3000/login?sso_error=token_exchange_failed" });
      expect(sessionCookie(callback!.headers)).toBeUndefined();
    }
  });

  test("unknown people need auto-provisioning; with it they join as members", async () => {
    const newcomer = `newcomer@${DOMAIN}`;
    const denied = await ssoRoundTrip(`/auth/sso/start?email=${newcomer}`, { email: newcomer, sub: "idp-newcomer", name: "New Comer" });
    expect(denied.location).toBe("http://localhost:3000/login?sso_error=no_account");
    expect(await prisma.user.count({ where: { email: newcomer } })).toBe(0);

    await owner.api.put(org("/sso"), { issuer: idp.issuer, clientId: idp.clientId, enabled: true, enforce: false, autoProvision: true });
    const { callback } = await ssoRoundTrip(`/auth/sso/start?email=${newcomer}`, { email: newcomer, sub: "idp-newcomer", name: "New Comer" });
    const me = await request("GET", "/auth/me", { headers: { Cookie: sessionCookie(callback!.headers)! } });
    expect(me.body).toMatchObject({ email: newcomer, name: "New Comer" });
    expect(me.body.emailVerifiedAt).toBeString();
    const membership = await prisma.organisationMember.findFirstOrThrow({ where: { organisationId: orgId, user: { email: newcomer } } });
    expect(membership.role).toBe("MEMBER");
    expect(await prisma.auditLog.count({ where: { organisationId: orgId, action: "sso.member_provisioned" } })).toBe(1);
    // Provisioned accounts have no usable password.
    expect((await request("POST", "/auth/login", { body: { email: newcomer, password: PASSWORD } })).status).toBe(401);
  });

  test("domains without SSO, disabled connections and bad input go back to login", async () => {
    expect((await request("GET", "/auth/sso/start?email=someone@nowhere.test", { redirect: "manual" })).headers.get("location")).toBe("http://localhost:3000/login?sso_error=not_configured");
    expect((await request("GET", "/auth/sso/start?email=not-an-email", { redirect: "manual" })).headers.get("location")).toBe("http://localhost:3000/login?sso_error=invalid_email");
    const evilNext = await ssoRoundTrip(`/auth/sso/start?email=${encodeURIComponent(alice.email)}&next=//evil.example`, { email: alice.email, sub: "idp-alice" });
    expect(evilNext.location).toBe("http://localhost:3000/dashboard");

    await owner.api.put(org("/sso"), { issuer: idp.issuer, clientId: idp.clientId, enabled: false, enforce: false, autoProvision: true });
    invalidateSsoPolicyCache();
    expect((await request("GET", `/auth/sso/start?email=${encodeURIComponent(alice.email)}`, { redirect: "manual" })).headers.get("location")).toBe("http://localhost:3000/login?sso_error=not_configured");
    await owner.api.put(org("/sso"), { issuer: idp.issuer, clientId: idp.clientId, enabled: true, enforce: false, autoProvision: true });
  });
});

describe("enforcing SSO", () => {
  let aliceSsoCookie: string;
  let alicePasswordToken: string;

  beforeAll(async () => {
    alicePasswordToken = (await request("POST", "/auth/login", { body: { email: alice.email, password: PASSWORD } })).body.token;
    const res = await owner.api.put(org("/sso"), { issuer: idp.issuer, clientId: idp.clientId, enabled: true, enforce: true, autoProvision: true });
    expect(res.status).toBe(200);
    expect(res.body.sso.enforce).toBe(true);
    const { callback } = await ssoRoundTrip(`/auth/sso/start?email=${encodeURIComponent(alice.email)}`, { email: alice.email, sub: "idp-alice" });
    aliceSsoCookie = sessionCookie(callback!.headers)!;
  });

  afterEach(() => invalidateSsoPolicyCache());

  test("password sign-in is refused for the domain — identically for right, wrong and unknown accounts", async () => {
    const attempts = await Promise.all([
      request("POST", "/auth/login", { body: { email: alice.email, password: PASSWORD } }),
      request("POST", "/auth/login", { body: { email: alice.email, password: "Wrong-password-1" } }),
      request("POST", "/auth/login", { body: { email: `ghost@${DOMAIN}`, password: PASSWORD } }),
    ]);
    for (const res of attempts) {
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: "SSO_REQUIRED", details: { organisation: { name: "Acme SSO" } } });
    }
    // Other domains are unaffected.
    expect((await request("POST", "/auth/login", { body: { email: admin.email, password: PASSWORD } })).status).toBe(200);
  });

  test("existing password sessions stop working; SSO sessions keep working", async () => {
    const old = await client(alicePasswordToken).get("/auth/me");
    expect(old.status).toBe(401);
    expect(old.body.code).toBe("SSO_REQUIRED");
    expect((await request("GET", `/organisations/${orgId}/tickets`, { headers: { Cookie: aliceSsoCookie } })).status).toBe(200);
  });

  test("owners on the domain keep password access as a break-glass", async () => {
    const res = await request("POST", "/auth/login", { body: { email: owner.email, password: PASSWORD } });
    expect(res.status).toBe(200);
    expect((await client(res.body.token).get(org("/security"))).status).toBe(200);
  });

  test("password resets aren't sent to accounts that must use SSO", async () => {
    outbox.length = 0;
    await request("POST", "/auth/forgot-password", { body: { email: alice.email } });
    await request("POST", "/auth/forgot-password", { body: { email: owner.email } });
    expect(outbox.some((m) => m.to === alice.email)).toBe(false);
    expect(outbox.some((m) => m.to === owner.email)).toBe(true);
  });

  test("an SSO session satisfies the org's 2FA requirement; a password session doesn't", async () => {
    const setup = await owner.api.post("/auth/mfa/setup");
    await owner.api.post("/auth/mfa/enable", { code: totpAt(setup.body.secret, Date.now()) });
    const ownerSession = await request("POST", "/auth/login", { body: { email: owner.email, password: PASSWORD } });
    expect(ownerSession.body.mfaRequired).toBe(true);
    await prisma.user.update({ where: { id: owner.id }, data: { mfaLastStep: null } });
    const verified = await request("POST", "/auth/mfa/verify", { body: { mfaToken: ownerSession.body.mfaToken, code: totpAt(setup.body.secret, Date.now()) } });
    const ownerApi = client(verified.body.token);
    expect((await ownerApi.patch(org("/security"), { requireMfa: true })).status).toBe(200);

    // Alice has no 2FA, but her SSO session comes from this org's IdP.
    expect((await request("GET", `/organisations/${orgId}/tickets`, { headers: { Cookie: aliceSsoCookie } })).status).toBe(200);
    // The admin (another domain, password session, no 2FA) is locked out.
    const adminRes = await admin.api.get(`/organisations/${orgId}/tickets`);
    expect(adminRes.body.code).toBe("MFA_REQUIRED");
    await ownerApi.patch(org("/security"), { requireMfa: false });
  });

  test("removing the last verified domain switches enforcement off", async () => {
    const security = await owner.api.get(org("/security"));
    const ownerToken = (await request("POST", "/auth/login", { body: { email: owner.email, password: PASSWORD } })).body;
    void ownerToken;
    const domainId = security.body.domains.find((d: { domain: string }) => d.domain === DOMAIN).id;
    const res = await owner.api.delete(org(`/domains/${domainId}`));
    expect(res.status).toBe(200);
    expect(res.body.sso.enforce).toBe(false);
    expect((await request("POST", "/auth/login", { body: { email: alice.email, password: PASSWORD } })).status).toBe(200);
    // And without a verified domain, nobody can sign in through the IdP.
    const { location } = await ssoRoundTrip(`/auth/sso/start?email=${encodeURIComponent(alice.email)}`, { email: alice.email, sub: "idp-alice" });
    expect(location).toBe("http://localhost:3000/login?sso_error=not_configured");
  });

  test("deleting the connection removes linked identities", async () => {
    expect((await admin.api.delete(org("/sso"))).status).toBe(403);
    const res = await owner.api.delete(org("/sso"));
    expect(res.status).toBe(200);
    expect(res.body.sso).toBeNull();
    expect(await prisma.ssoIdentity.count()).toBe(0);
    expect((await owner.api.delete(org("/sso"))).status).toBe(404);
  });
});
