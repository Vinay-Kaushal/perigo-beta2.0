import { describe, expect, test } from "bun:test";
import { addMember, createOrg, recordEvents, registerUser, uid, useTestServer } from "./helpers";

useTestServer();

async function memberId(api: ReturnType<typeof import("./helpers").client>, orgId: string, userId: string) {
  const res = await api.get(`/organisations/${orgId}/members`);
  return (res.body as Array<{ id: string; userId: string }>).find((m) => m.userId === userId)!.id;
}

describe("organisations", () => {
  test("creator becomes owner; slugs are unique and validated", async () => {
    const owner = await registerUser("Owner");
    const org = await createOrg(owner);
    const got = await owner.api.get(`/organisations/${org.id}`);
    expect(got.status).toBe(200);
    expect(got.body.myRole).toBe("OWNER");
    expect(got.body.requireJoinApproval).toBe(true);

    const dup = await owner.api.post("/organisations", { name: "Other", slug: org.slug });
    expect(dup.status).toBe(409);
    const bad = await owner.api.post("/organisations", { name: "Bad", slug: "Has Spaces!" });
    expect(bad.status).toBe(400);
  });

  test("lists only my organisations", async () => {
    const a = await registerUser("A");
    const b = await registerUser("B");
    const orgA = await createOrg(a);
    await createOrg(b);
    const list = await a.api.get("/organisations");
    expect(list.body.map((o: { id: string }) => o.id)).toEqual([orgA.id]);
  });

  test("non-members get 404 (org ids can't be probed)", async () => {
    const owner = await registerUser("Owner");
    const stranger = await registerUser("Stranger");
    const org = await createOrg(owner);
    for (const path of ["", "/members", "/tickets", "/expenses", "/goals", "/teams", "/analytics/overview"]) {
      expect((await stranger.api.get(`/organisations/${org.id}${path}`)).status).toBe(404);
    }
    expect((await stranger.api.get(`/organisations/not-a-uuid`)).status).toBe(404);
  });

  test("members list never exposes credentials", async () => {
    const owner = await registerUser("Owner");
    const member = await registerUser("Member");
    const org = await createOrg(owner);
    await addMember(owner, org.id, member);
    const res = await member.api.get(`/organisations/${org.id}/members`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(Object.keys(res.body[0].user).sort()).toEqual(["avatarUrl", "email", "id", "name"]);
  });

  test("settings: admins can update, members cannot; validation applies", async () => {
    const owner = await registerUser("Owner");
    const admin = await registerUser("Admin");
    const member = await registerUser("Member");
    const org = await createOrg(owner);
    await addMember(owner, org.id, admin, "ADMIN");
    await addMember(owner, org.id, member);

    expect((await member.api.patch(`/organisations/${org.id}`, { name: "Hacked" })).status).toBe(403);
    const ok = await admin.api.patch(`/organisations/${org.id}`, { ticketPrefix: "ops", currency: "eur", requireJoinApproval: false });
    expect(ok.status).toBe(200);
    expect(ok.body.ticketPrefix).toBe("OPS");
    expect(ok.body.currency).toBe("EUR");
    expect((await admin.api.patch(`/organisations/${org.id}`, { currency: "EUROS" })).status).toBe(400);
  });

  test("deleting requires the owner role and slug confirmation", async () => {
    const owner = await registerUser("Owner");
    const admin = await registerUser("Admin");
    const org = await createOrg(owner);
    await addMember(owner, org.id, admin, "ADMIN");

    expect((await admin.api.delete(`/organisations/${org.id}`, { confirmSlug: org.slug })).status).toBe(403);
    expect((await owner.api.delete(`/organisations/${org.id}`, { confirmSlug: "wrong" })).status).toBe(400);
    const events = await recordEvents(`user:${admin.id}`);
    expect((await owner.api.delete(`/organisations/${org.id}`, { confirmSlug: org.slug })).status).toBe(204);
    expect((await owner.api.get(`/organisations/${org.id}`)).status).toBe(404);
    expect(await events.find((e) => e.type === "ACCESS_REVOKED")).toHaveLength(1);
    await events.close();
  });
});

describe("roles and membership", () => {
  test("only owners change roles; the last owner can't be demoted", async () => {
    const owner = await registerUser("Owner");
    const admin = await registerUser("Admin");
    const member = await registerUser("Member");
    const org = await createOrg(owner);
    await addMember(owner, org.id, admin, "ADMIN");
    await addMember(owner, org.id, member);

    const memberMid = await memberId(owner.api, org.id, member.id);
    const ownerMid = await memberId(owner.api, org.id, owner.id);

    expect((await admin.api.patch(`/organisations/${org.id}/members/${memberMid}`, { role: "ADMIN" })).status).toBe(403);
    expect((await owner.api.patch(`/organisations/${org.id}/members/${ownerMid}`, { role: "MEMBER" })).status).toBe(409);

    const promoted = await owner.api.patch(`/organisations/${org.id}/members/${memberMid}`, { role: "OWNER" });
    expect(promoted.status).toBe(200);
    // With a second owner, the first may step down.
    expect((await owner.api.patch(`/organisations/${org.id}/members/${ownerMid}`, { role: "ADMIN" })).status).toBe(200);
  });

  test("admins can remove members but not other admins or owners", async () => {
    const owner = await registerUser("Owner");
    const admin = await registerUser("Admin");
    const admin2 = await registerUser("Admin2");
    const member = await registerUser("Member");
    const org = await createOrg(owner);
    await addMember(owner, org.id, admin, "ADMIN");
    await addMember(owner, org.id, admin2, "ADMIN");
    await addMember(owner, org.id, member);

    expect((await admin.api.delete(`/organisations/${org.id}/members/${await memberId(owner.api, org.id, admin2.id)}`)).status).toBe(403);
    expect((await admin.api.delete(`/organisations/${org.id}/members/${await memberId(owner.api, org.id, owner.id)}`)).status).toBe(403);
    expect((await member.api.delete(`/organisations/${org.id}/members/${await memberId(owner.api, org.id, admin.id)}`)).status).toBe(403);

    const events = await recordEvents(`user:${member.id}`);
    expect((await admin.api.delete(`/organisations/${org.id}/members/${await memberId(owner.api, org.id, member.id)}`)).status).toBe(204);
    expect((await member.api.get(`/organisations/${org.id}`)).status).toBe(404);
    expect(await events.find((e) => e.type === "ACCESS_REVOKED")).toHaveLength(1);
    await events.close();
  });

  test("removing a member unassigns their open tickets", async () => {
    const owner = await registerUser("Owner");
    const member = await registerUser("Member");
    const org = await createOrg(owner);
    await addMember(owner, org.id, member);
    const ticket = await owner.api.post(`/organisations/${org.id}/tickets`, { title: "Printer on fire", assigneeId: member.id });
    expect(ticket.body.assigneeId).toBe(member.id);

    await owner.api.delete(`/organisations/${org.id}/members/${await memberId(owner.api, org.id, member.id)}`);
    const after = await owner.api.get(`/organisations/${org.id}/tickets/${ticket.body.number}`);
    expect(after.body.assigneeId).toBeNull();
  });

  test("member ids from another organisation can't be targeted (IDOR)", async () => {
    const ownerA = await registerUser("OwnerA");
    const ownerB = await registerUser("OwnerB");
    const victim = await registerUser("Victim");
    const orgA = await createOrg(ownerA);
    const orgB = await createOrg(ownerB);
    await addMember(ownerB, orgB.id, victim);
    const victimMid = await memberId(ownerB.api, orgB.id, victim.id);

    // ownerA is OWNER of orgA and tries to act on orgB's membership row through orgA's URL.
    expect((await ownerA.api.patch(`/organisations/${orgA.id}/members/${victimMid}`, { role: "OWNER" })).status).toBe(404);
    expect((await ownerA.api.delete(`/organisations/${orgA.id}/members/${victimMid}`)).status).toBe(404);
    expect((await victim.api.get(`/organisations/${orgB.id}`)).status).toBe(200);
  });

  test("leaving: members can leave, the sole owner can't", async () => {
    const owner = await registerUser("Owner");
    const member = await registerUser("Member");
    const org = await createOrg(owner);
    await addMember(owner, org.id, member);
    expect((await owner.api.delete(`/organisations/${org.id}/members/me`)).status).toBe(409);
    expect((await member.api.delete(`/organisations/${org.id}/members/me`)).status).toBe(204);
    expect((await member.api.get(`/organisations/${org.id}`)).status).toBe(404);
  });

  test("there's no back door to add members without an invitation", async () => {
    const owner = await registerUser("Owner");
    const outsider = await registerUser("Outsider");
    const org = await createOrg(owner);
    const res = await owner.api.post(`/organisations/${org.id}/members`, { userId: outsider.id });
    expect(res.status).toBe(404);
    expect((await outsider.api.get(`/organisations/${org.id}`)).status).toBe(404);
  });
});

describe("audit log", () => {
  test("records security-relevant changes, visible to admins only", async () => {
    const owner = await registerUser("Owner");
    const member = await registerUser("Member");
    const org = await createOrg(owner, { slug: `audit-${uid()}` });
    await addMember(owner, org.id, member);
    const mid = await memberId(owner.api, org.id, member.id);
    await owner.api.patch(`/organisations/${org.id}/members/${mid}`, { role: "ADMIN" });

    expect((await member.api.get(`/organisations/${org.id}/audit-logs`)).status).toBe(200); // now an admin
    const logs = await owner.api.get(`/organisations/${org.id}/audit-logs`);
    const actions = logs.body.items.map((l: { action: string }) => l.action);
    expect(actions).toEqual(
      expect.arrayContaining(["organisation.created", "invitation.created", "invitation.accepted", "invitation.approved", "member.role_changed"])
    );
    const roleChange = logs.body.items.find((l: { action: string }) => l.action === "member.role_changed");
    expect(roleChange.metadata).toEqual({ from: "MEMBER", to: "ADMIN" });
    expect(roleChange.actor.id).toBe(owner.id);

    const plain = await registerUser("Plain");
    await addMember(owner, org.id, plain);
    expect((await plain.api.get(`/organisations/${org.id}/audit-logs`)).status).toBe(403);
  });
});
