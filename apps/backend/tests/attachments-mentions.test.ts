import { beforeAll, describe, expect, test } from "bun:test";
import { readdir } from "fs/promises";
import path from "path";
import { prisma } from "../lib/prisma";
import { addMember, createOrg, notificationsFor, recordEvents, registerUsers, request, useTestServer, type TestUser } from "./helpers";

useTestServer();

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 7)]);
const PDF = Buffer.from("%PDF-1.7\n1 0 obj << >> endobj\ntrailer\n%%EOF");

let owner: TestUser, alice: TestUser, bob: TestUser, outsider: TestUser;
let orgId: string;
const t = (path = "") => `/organisations/${orgId}/tickets${path}`;
const mention = (u: TestUser) => `@[${u.name}](${u.id})`;

function upload(user: TestUser, ticketNumber: number, fileName: string, bytes: Uint8Array, headers: Record<string, string> = {}) {
  return request("POST", t(`/${ticketNumber}/attachments`), {
    token: user.token,
    raw: bytes,
    headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(fileName), ...headers },
  });
}

async function storedFiles() {
  const root = process.env.UPLOAD_DIR!;
  const dirs = await readdir(root).catch(() => []);
  const files = await Promise.all(dirs.map((d) => readdir(path.join(root, d)).catch(() => [])));
  return files.flat();
}

beforeAll(async () => {
  [owner, alice, bob, outsider] = await registerUsers("Owner", "Alice", "Bob", "Outsider");
  orgId = (await createOrg(owner)).id;
  await addMember(owner, orgId, alice);
  await addMember(owner, orgId, bob);
});

describe("attachments", () => {
  test("upload, list on the ticket, download with safe headers", async () => {
    const ticket = (await alice.api.post(t(), { title: "Screenshot of the error" })).body;
    const events = await recordEvents(`org:${orgId}`);

    const res = await upload(alice, ticket.number, "error screen.png", PNG);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ fileName: "error screen.png", contentType: "image/png", size: PNG.length, isImage: true });
    expect(res.body.uploader.id).toBe(alice.id);
    expect(res.body).not.toHaveProperty("storageKey");
    expect(await events.find((e) => e.type === "TICKET_UPDATED" && e.data.id === ticket.id)).toHaveLength(1);
    await events.close();

    const detail = await bob.api.get(t(`/${ticket.number}`));
    expect(detail.body.attachments.map((a: { id: string }) => a.id)).toEqual([res.body.id]);
    expect(detail.body.events.some((e: { type: string }) => e.type === "ATTACHMENT_ADDED")).toBe(true);

    const url = t(`/${ticket.number}/attachments/${res.body.id}`);
    const got = await request("GET", url, { token: bob.token });
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("image/png");
    expect(got.headers.get("content-disposition")).toStartWith('attachment; filename="error screen.png"');
    expect(got.headers.get("x-content-type-options")).toBe("nosniff");
    expect(got.headers.get("content-security-policy")).toContain("sandbox");

    const inline = await request("GET", `${url}?inline=1`, { token: bob.token });
    expect(inline.headers.get("content-disposition")).toStartWith("inline;");
  });

  test("downloaded bytes are identical to the upload", async () => {
    const ticket = (await alice.api.post(t(), { title: "PDF round trip" })).body;
    const up = await upload(alice, ticket.number, "invoice.pdf", PDF);
    const res = await request("GET", t(`/${ticket.number}/attachments/${up.body.id}`), { token: alice.token });
    expect(res.status).toBe(200);
    // Compare what's in storage byte-for-byte with what was uploaded.
    const row = await prisma.ticketAttachment.findUniqueOrThrow({ where: { id: up.body.id } });
    const { storage } = await import("../lib/storage");
    const chunks: Buffer[] = [];
    for await (const chunk of await storage().get(row.storageKey)) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).equals(PDF)).toBe(true);
    // Stored under a random key, not the user's file name.
    expect(row.storageKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("rejects disallowed types, spoofed contents, empty and oversized files", async () => {
    const ticket = (await alice.api.post(t(), { title: "Bad uploads" })).body;
    expect((await upload(alice, ticket.number, "logo.svg", Buffer.from("<svg onload=alert(1)>"))).status).toBe(415);
    expect((await upload(alice, ticket.number, "page.html", Buffer.from("<script>alert(1)</script>"))).status).toBe(415);
    const spoofed = await upload(alice, ticket.number, "cat.png", Buffer.from("<html><script>alert(document.cookie)</script></html>"));
    expect(spoofed.status).toBe(415);
    expect(spoofed.body.code).toBe("FILE_TYPE_MISMATCH");
    expect((await upload(alice, ticket.number, "tiny.png", Buffer.from("GIF8"))).status).toBe(415); // shorter than the sniff window
    expect((await upload(alice, ticket.number, "empty.txt", new Uint8Array())).status).toBe(400);
    const big = await upload(alice, ticket.number, "huge.txt", Buffer.alloc(64 * 1024 + 1, 0x41));
    expect(big.status).toBe(413);
    expect((await request("POST", t(`/${ticket.number}/attachments`), { token: alice.token, raw: PNG, headers: { "Content-Type": "application/octet-stream" } })).status).toBe(400);
    expect((await alice.api.get(t(`/${ticket.number}`))).body.attachments).toHaveLength(0);
  });

  test("path tricks in file names can't escape storage", async () => {
    const ticket = (await alice.api.post(t(), { title: "Traversal attempt" })).body;
    const res = await upload(alice, ticket.number, "../../../../etc/passwd.txt", Buffer.from("root:x:0:0"));
    expect(res.status).toBe(201);
    expect(res.body.fileName).toBe("passwd.txt");
  });

  test("per-ticket limit and closed tickets", async () => {
    const ticket = (await alice.api.post(t(), { title: "Limit test", assigneeId: bob.id })).body;
    for (let i = 0; i < 5; i++) expect((await upload(alice, ticket.number, `f${i}.txt`, Buffer.from(`file ${i}`))).status).toBe(201);
    expect((await upload(alice, ticket.number, "f6.txt", Buffer.from("one too many"))).status).toBe(409);

    const closedTicket = (await alice.api.post(t(), { title: "Closed ticket" })).body;
    await owner.api.post(t(`/${closedTicket.number}/status`), { status: "CANCELLED" });
    expect((await upload(alice, closedTicket.number, "late.txt", Buffer.from("late"))).status).toBe(409);
  });

  test("isolation: other orgs can't list, download or delete", async () => {
    const ticket = (await alice.api.post(t(), { title: "Private file" })).body;
    const up = await upload(alice, ticket.number, "secret.txt", Buffer.from("top secret"));
    const other = await createOrg(outsider);
    const viaOther = `/organisations/${other.id}/tickets/${ticket.id}/attachments/${up.body.id}`;
    expect((await request("GET", viaOther, { token: outsider.token })).status).toBe(404);
    expect((await request("GET", t(`/${ticket.number}/attachments/${up.body.id}`), { token: outsider.token })).status).toBe(404);
    expect((await request("DELETE", t(`/${ticket.number}/attachments/${up.body.id}`), { token: outsider.token })).status).toBe(404);

    // An attachment id from another ticket in the same org isn't reachable through this ticket.
    const otherTicket = (await alice.api.post(t(), { title: "Another ticket" })).body;
    expect((await request("GET", t(`/${otherTicket.number}/attachments/${up.body.id}`), { token: alice.token })).status).toBe(404);
  });

  test("only the uploader or an admin deletes; files are removed from storage", async () => {
    const ticket = (await alice.api.post(t(), { title: "Delete files" })).body;
    const up = await upload(alice, ticket.number, "remove-me.txt", Buffer.from("bye"));
    const row = await prisma.ticketAttachment.findUniqueOrThrow({ where: { id: up.body.id } });
    expect(await storedFiles()).toContain(row.storageKey);

    expect((await bob.api.delete(t(`/${ticket.number}/attachments/${up.body.id}`))).status).toBe(403);
    expect((await owner.api.delete(t(`/${ticket.number}/attachments/${up.body.id}`))).status).toBe(204);
    expect(await storedFiles()).not.toContain(row.storageKey);
    const logs = await owner.api.get(`/organisations/${orgId}/audit-logs?action=attachment.`);
    expect(logs.body.items[0].metadata.fileName).toBe("remove-me.txt");
  });

  test("deleting a ticket deletes its files", async () => {
    const ticket = (await alice.api.post(t(), { title: "Ticket with files" })).body;
    const up = await upload(alice, ticket.number, "a.txt", Buffer.from("a"));
    const key = (await prisma.ticketAttachment.findUniqueOrThrow({ where: { id: up.body.id } })).storageKey;
    expect((await owner.api.delete(t(`/${ticket.number}`))).status).toBe(204);
    expect(await storedFiles()).not.toContain(key);
  });

  test("comments can carry the author's own uploads, once", async () => {
    const ticket = (await alice.api.post(t(), { title: "Comment attachments" })).body;
    const mine = (await upload(alice, ticket.number, "log.txt", Buffer.from("stack trace"))).body;
    const bobs = (await upload(bob, ticket.number, "bob.txt", Buffer.from("bob's file"))).body;

    expect((await alice.api.post(t(`/${ticket.number}/comments`), { body: "", attachmentIds: [bobs.id] })).status).toBe(400);
    const comment = await alice.api.post(t(`/${ticket.number}/comments`), { attachmentIds: [mine.id] });
    expect(comment.status).toBe(201);
    expect(comment.body.attachments.map((a: { id: string }) => a.id)).toEqual([mine.id]);
    // Can't reuse it on a second comment.
    expect((await alice.api.post(t(`/${ticket.number}/comments`), { body: "again", attachmentIds: [mine.id] })).status).toBe(400);
    // Rolled back: the failed comment wasn't created.
    const detail = await alice.api.get(t(`/${ticket.number}`));
    expect(detail.body.comments).toHaveLength(1);
    expect(detail.body.comments[0].attachments[0].fileName).toBe("log.txt");
    expect((await alice.api.post(t(`/${ticket.number}/comments`), { body: "" })).status).toBe(400);
  });
});

describe("browser uploads", () => {
  test("CORS preflight allows the headers a browser upload sends", async () => {
    const preflight = await request("OPTIONS", t("/1/attachments"), {
      headers: {
        Origin: "http://localhost:3000",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-csrf-protection,x-file-name",
      },
    });
    const allowed = (preflight.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    for (const header of ["content-type", "x-csrf-protection", "x-file-name"]) expect(allowed).toContain(header);
    expect(preflight.headers.get("access-control-allow-credentials")).toBe("true");
  });
});

describe("mentions", () => {
  test("mentioning a member notifies them once and makes them a watcher", async () => {
    const ticket = (await alice.api.post(t(), { title: "Mention flow" })).body;
    const comment = await alice.api.post(t(`/${ticket.number}/comments`), { body: `${mention(bob)} can you take a look?` });
    expect(comment.status).toBe(201);

    const bobs = (await notificationsFor(bob)).filter((n) => n.link?.endsWith(`/tickets/${ticket.number}`));
    expect(bobs.map((n) => n.type)).toEqual(["MENTIONED"]);
    expect(bobs[0]!.title).toBe(`Alice mentioned you in a comment on ${ticket.key}`);
    expect(bobs[0]!.body).toBe("@Bob can you take a look?");
    expect((await bob.api.get(t(`/${ticket.number}`))).body.isWatching).toBe(true);

    // Bob is now a watcher, but still gets a single notification per comment.
    await alice.api.post(t(`/${ticket.number}/comments`), { body: `${mention(bob)} ping again` });
    const after = (await notificationsFor(bob)).filter((n) => n.link?.endsWith(`/tickets/${ticket.number}`));
    expect(after).toHaveLength(2);
  });

  test("mentions of non-members and self are ignored without leaking anything", async () => {
    const ticket = (await alice.api.post(t(), { title: "Ignore mentions" })).body;
    const res = await alice.api.post(t(`/${ticket.number}/comments`), { body: `${mention(outsider)} ${mention(alice)} hello` });
    expect(res.status).toBe(201);
    expect((await notificationsFor(outsider)).some((n) => n.type === "MENTIONED")).toBe(false);
    expect((await notificationsFor(alice)).some((n) => n.type === "MENTIONED" && n.link?.endsWith(`/${ticket.number}`))).toBe(false);
    expect(await prisma.ticketWatcher.count({ where: { ticketId: ticket.id, userId: outsider.id } })).toBe(0);
  });

  test("editing a comment only notifies newly mentioned people", async () => {
    const ticket = (await alice.api.post(t(), { title: "Edit mentions" })).body;
    const comment = (await alice.api.post(t(`/${ticket.number}/comments`), { body: `${mention(bob)} first` })).body;
    await alice.api.patch(t(`/${ticket.number}/comments/${comment.id}`), { body: `${mention(bob)} ${mention(owner)} edited` });
    const bobMentions = (await notificationsFor(bob)).filter((n) => n.type === "MENTIONED" && n.link?.endsWith(`/${ticket.number}`));
    const ownerMentions = (await notificationsFor(owner)).filter((n) => n.type === "MENTIONED" && n.link?.endsWith(`/${ticket.number}`));
    expect(bobMentions).toHaveLength(1);
    expect(ownerMentions).toHaveLength(1);
  });

  test("mentions in the ticket description notify on create and on edit", async () => {
    const ticket = (await alice.api.post(t(), { title: "Description mention", description: `Need ${mention(bob)} on this` })).body;
    expect((await notificationsFor(bob)).some((n) => n.title === `Alice mentioned you in ${ticket.key}`)).toBe(true);
    await alice.api.patch(t(`/${ticket.number}`), { description: `Need ${mention(bob)} and ${mention(owner)}` });
    const ownerN = (await notificationsFor(owner)).filter((n) => n.title === `Alice mentioned you in ${ticket.key}`);
    const bobN = (await notificationsFor(bob)).filter((n) => n.title === `Alice mentioned you in ${ticket.key}`);
    expect(ownerN).toHaveLength(1);
    expect(bobN).toHaveLength(1);
  });

  test("task comment mentions only reach people who can see the board", async () => {
    const board = (await owner.api.post(`/organisations/${orgId}/boards`, { name: "Mentions board" })).body;
    await owner.api.post(`/boards/${board.id}/members`, { userId: alice.id });
    const task = (await alice.api.post(`/boards/${board.id}/tasks`, { statusId: board.taskStatuses[0].id, title: "Mention task" })).body;
    await alice.api.post(`/tasks/${task.id}/comments`, { content: `${mention(bob)} ${mention(owner)} thoughts?` });
    expect((await notificationsFor(owner)).some((n) => n.type === "MENTIONED" && n.link === `/boards/${board.id}?task=${task.id}`)).toBe(true);
    // Bob is an org member but not on the board.
    expect((await notificationsFor(bob)).some((n) => n.link === `/boards/${board.id}?task=${task.id}`)).toBe(false);
  });
});
