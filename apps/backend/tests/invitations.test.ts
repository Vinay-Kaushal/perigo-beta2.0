import { describe, expect, test } from "bun:test";
import { prisma } from "../lib/prisma";
import { outbox } from "../lib/mailer";
import { addMember, createOrg, notificationsFor, recordEvents, registerUser, request, tokenFromUrl, useTestServer } from "./helpers";

useTestServer();

describe("invite → accept → approve", () => {
  test("full flow: email sent, invitee accepts, admins are notified, approval grants membership", async () => {
    const owner = await registerUser("Owner");
    const admin = await registerUser("Admin");
    const invitee = await registerUser("Invitee");
    const org = await createOrg(owner, { name: "Initech" });
    await addMember(owner, org.id, admin, "ADMIN");

    outbox.length = 0;
    const invite = await owner.api.post(`/organisations/${org.id}/invitations`, { email: invitee.email.toUpperCase(), message: "Welcome!" });
    expect(invite.status).toBe(201);
    expect(invite.body.email).toBe(invitee.email);
    expect(invite.body.status).toBe("PENDING");
    expect(invite.body.emailed).toBe(true);

    // Email went to the invitee with the same link, HTML-escaped.
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.to).toBe(invitee.email);
    expect(outbox[0]!.text).toContain(invite.body.inviteUrl);
    const token = tokenFromUrl(invite.body.inviteUrl);

    // Only a hash is stored.
    const row = await prisma.invitation.findUniqueOrThrow({ where: { id: invite.body.id } });
    expect(row.tokenHash).not.toContain(token);

    // Public preview works without auth.
    const preview = await request("GET", `/invitations/${token}`);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ organisationName: "Initech", invitedByName: "Owner", status: "PENDING", requiresApproval: true, message: "Welcome!" });

    // Invitee already had an account → in-app heads-up.
    expect((await notificationsFor(invitee)).map((n) => n.type)).toContain("INVITATION_RECEIVED");

    const accepted = await invitee.api.post(`/invitations/${token}/accept`);
    expect(accepted.status).toBe(202);
    expect(accepted.body.status).toBe("AWAITING_APPROVAL");

    // Not a member yet.
    expect((await invitee.api.get(`/organisations/${org.id}`)).status).toBe(404);
    const pending = await invitee.api.get("/me/join-requests");
    expect(pending.body[0]).toMatchObject({ status: "AWAITING_APPROVAL", organisation: { id: org.id } });

    // Both approvers were notified.
    for (const approver of [owner, admin]) {
      const n = (await notificationsFor(approver)).find((x) => x.type === "JOIN_REQUEST");
      expect(n?.link).toBe(`/orgs/${org.id}/members?tab=requests`);
    }

    const queue = await admin.api.get(`/organisations/${org.id}/invitations?status=AWAITING_APPROVAL`);
    expect(queue.body).toHaveLength(1);
    expect(queue.body[0].acceptedBy.id).toBe(invitee.id);

    const events = await recordEvents(`org:${org.id}`);
    const approved = await admin.api.post(`/organisations/${org.id}/invitations/${invite.body.id}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.role).toBe("MEMBER");
    expect(await events.find((e) => e.type === "MEMBER_JOINED")).toHaveLength(1);
    await events.close();

    const membership = await invitee.api.get(`/organisations/${org.id}`);
    expect(membership.status).toBe(200);
    expect(membership.body.myRole).toBe("MEMBER");
    expect((await notificationsFor(invitee)).map((n) => n.type)).toContain("JOIN_APPROVED");

    // The link is spent.
    expect((await invitee.api.post(`/invitations/${token}/accept`)).status).toBe(410);
  });

  test("rejection notifies the requester and grants nothing", async () => {
    const owner = await registerUser("Owner");
    const invitee = await registerUser("Invitee");
    const org = await createOrg(owner);
    const invite = await owner.api.post(`/organisations/${org.id}/invitations`, { email: invitee.email });
    await invitee.api.post(`/invitations/${tokenFromUrl(invite.body.inviteUrl)}/accept`);

    const rejected = await owner.api.post(`/organisations/${org.id}/invitations/${invite.body.id}/reject`, { reason: "Wrong team" });
    expect(rejected.status).toBe(204);
    expect((await invitee.api.get(`/organisations/${org.id}`)).status).toBe(404);
    const n = (await notificationsFor(invitee)).find((x) => x.type === "JOIN_REJECTED");
    expect(n?.body).toBe("Wrong team");

    // Can't approve after rejecting.
    expect((await owner.api.post(`/organisations/${org.id}/invitations/${invite.body.id}/approve`)).status).toBe(409);
  });

  test("orgs that don't require approval admit admin invitees immediately", async () => {
    const owner = await registerUser("Owner");
    const invitee = await registerUser("Invitee");
    const org = await createOrg(owner);
    await owner.api.patch(`/organisations/${org.id}`, { requireJoinApproval: false });

    const invite = await owner.api.post(`/organisations/${org.id}/invitations`, { email: invitee.email, role: "ADMIN" });
    const accepted = await invitee.api.post(`/invitations/${tokenFromUrl(invite.body.inviteUrl)}/accept`);
    expect(accepted.status).toBe(201);
    expect(accepted.body.status).toBe("ACCEPTED");
    expect((await invitee.api.get(`/organisations/${org.id}`)).body.myRole).toBe("ADMIN");
    expect((await notificationsFor(owner)).map((n) => n.type)).toContain("INVITATION_ACCEPTED");
  });

  test("invites sent by plain members always need admin approval", async () => {
    const owner = await registerUser("Owner");
    const member = await registerUser("Member");
    const invitee = await registerUser("Friend");
    const org = await createOrg(owner);
    await owner.api.patch(`/organisations/${org.id}`, { requireJoinApproval: false });
    await addMember(owner, org.id, member);

    expect((await member.api.post(`/organisations/${org.id}/invitations`, { email: invitee.email, role: "ADMIN" })).status).toBe(403);
    const invite = await member.api.post(`/organisations/${org.id}/invitations`, { email: invitee.email });
    expect(invite.status).toBe(201);
    const accepted = await invitee.api.post(`/invitations/${tokenFromUrl(invite.body.inviteUrl)}/accept`);
    expect(accepted.status).toBe(202);
  });
});

describe("invitation security", () => {
  test("a forwarded link can't be redeemed by a different account", async () => {
    const owner = await registerUser("Owner");
    const invitee = await registerUser("Invitee");
    const thief = await registerUser("Thief");
    const org = await createOrg(owner);
    const invite = await owner.api.post(`/organisations/${org.id}/invitations`, { email: invitee.email });
    const token = tokenFromUrl(invite.body.inviteUrl);

    const stolen = await thief.api.post(`/invitations/${token}/accept`);
    expect(stolen.status).toBe(403);
    expect((await thief.api.get(`/organisations/${org.id}`)).status).toBe(404);
    // Still usable by the right person.
    expect((await invitee.api.post(`/invitations/${token}/accept`)).status).toBe(202);
  });

  test("accepting requires authentication; unknown or malformed tokens are 404", async () => {
    expect((await request("POST", "/invitations/whatever/accept")).status).toBe(401);
    expect((await request("GET", "/invitations/short")).status).toBe(404);
    expect((await request("GET", `/invitations/${"a".repeat(43)}`)).status).toBe(404);
  });

  test("expired invitations are marked and refused", async () => {
    const owner = await registerUser("Owner");
    const invitee = await registerUser("Invitee");
    const org = await createOrg(owner);
    const invite = await owner.api.post(`/organisations/${org.id}/invitations`, { email: invitee.email });
    await prisma.invitation.update({ where: { id: invite.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const token = tokenFromUrl(invite.body.inviteUrl);
    expect((await request("GET", `/invitations/${token}`)).body.status).toBe("EXPIRED");
    expect((await invitee.api.post(`/invitations/${token}/accept`)).status).toBe(410);

    // Resend issues a new token and revives it; the old link stays dead.
    const resent = await owner.api.post(`/organisations/${org.id}/invitations/${invite.body.id}/resend`);
    expect(resent.status).toBe(200);
    const newToken = tokenFromUrl(resent.body.inviteUrl);
    expect(newToken).not.toBe(token);
    expect((await request("GET", `/invitations/${token}`)).status).toBe(404);
    expect((await invitee.api.post(`/invitations/${newToken}/accept`)).status).toBe(202);
  });

  test("re-inviting replaces the live invite; revoked links stop working", async () => {
    const owner = await registerUser("Owner");
    const invitee = await registerUser("Invitee");
    const org = await createOrg(owner);
    const first = await owner.api.post(`/organisations/${org.id}/invitations`, { email: invitee.email });
    const second = await owner.api.post(`/organisations/${org.id}/invitations`, { email: invitee.email, role: "ADMIN" });
    expect(second.status).toBe(201);
    expect((await invitee.api.post(`/invitations/${tokenFromUrl(first.body.inviteUrl)}/accept`)).status).toBe(410);

    expect((await owner.api.delete(`/organisations/${org.id}/invitations/${second.body.id}`)).status).toBe(204);
    expect((await invitee.api.post(`/invitations/${tokenFromUrl(second.body.inviteUrl)}/accept`)).status).toBe(410);

    // Revoke/re-invite cycles used to crash on a unique constraint.
    for (let i = 0; i < 3; i++) {
      const again = await owner.api.post(`/organisations/${org.id}/invitations`, { email: invitee.email });
      expect(again.status).toBe(201);
      expect((await owner.api.delete(`/organisations/${org.id}/invitations/${again.body.id}`)).status).toBe(204);
    }
  });

  test("existing members can't be invited; accepted-but-pending people can't be double-invited", async () => {
    const owner = await registerUser("Owner");
    const member = await registerUser("Member");
    const pendingUser = await registerUser("Pending");
    const org = await createOrg(owner);
    await addMember(owner, org.id, member);
    expect((await owner.api.post(`/organisations/${org.id}/invitations`, { email: member.email })).status).toBe(409);

    const invite = await owner.api.post(`/organisations/${org.id}/invitations`, { email: pendingUser.email });
    await pendingUser.api.post(`/invitations/${tokenFromUrl(invite.body.inviteUrl)}/accept`);
    expect((await owner.api.post(`/organisations/${org.id}/invitations`, { email: pendingUser.email })).status).toBe(409);
  });

  test("approval queue and actions are admin-only and org-scoped", async () => {
    const ownerA = await registerUser("OwnerA");
    const ownerB = await registerUser("OwnerB");
    const member = await registerUser("Member");
    const invitee = await registerUser("Invitee");
    const orgA = await createOrg(ownerA);
    const orgB = await createOrg(ownerB);
    await addMember(ownerA, orgA.id, member);

    const invite = await ownerB.api.post(`/organisations/${orgB.id}/invitations`, { email: invitee.email });
    await invitee.api.post(`/invitations/${tokenFromUrl(invite.body.inviteUrl)}/accept`);

    expect((await member.api.get(`/organisations/${orgA.id}/invitations`)).status).toBe(403);
    // OwnerA can't approve orgB's request by going through orgA.
    expect((await ownerA.api.post(`/organisations/${orgA.id}/invitations/${invite.body.id}/approve`)).status).toBe(404);
    expect((await ownerA.api.delete(`/organisations/${orgA.id}/invitations/${invite.body.id}`)).status).toBe(404);
    expect((await invitee.api.get(`/organisations/${orgA.id}`)).status).toBe(404);
    expect((await invitee.api.get(`/organisations/${orgB.id}`)).status).toBe(404);
  });

  test("email content escapes HTML from org and inviter names", async () => {
    const owner = await registerUser("Owner");
    await owner.api.patch("/auth/me", { name: "<script>alert(1)</script>" });
    const org = await createOrg(owner, { name: "<img src=x onerror=alert(1)>" });
    outbox.length = 0;
    await owner.api.post(`/organisations/${org.id}/invitations`, { email: "someone@example.com" });
    expect(outbox[0]!.html).not.toContain("<script>");
    expect(outbox[0]!.html).not.toContain("<img");
    expect(outbox[0]!.html).toContain("&lt;script&gt;");
  });

  test("declining ends the invitation", async () => {
    const owner = await registerUser("Owner");
    const invitee = await registerUser("Invitee");
    const org = await createOrg(owner);
    const invite = await owner.api.post(`/organisations/${org.id}/invitations`, { email: invitee.email });
    const token = tokenFromUrl(invite.body.inviteUrl);
    expect((await invitee.api.post(`/invitations/${token}/decline`)).status).toBe(204);
    expect((await invitee.api.post(`/invitations/${token}/accept`)).status).toBe(410);
  });
});
