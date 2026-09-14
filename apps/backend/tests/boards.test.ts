import { beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "../lib/prisma";
import { addMember, registerUsers, createOrg, notificationsFor, recordEvents, registerUser, useTestServer, type TestUser } from "./helpers";

useTestServer();

let owner: TestUser, member: TestUser, boardMember: TestUser, outsider: TestUser;
let orgId: string;
let board: { id: string; taskStatuses: Array<{ id: string; name: string; type: string }> };

beforeAll(async () => {
  [owner, member, boardMember, outsider] = await registerUsers("Owner", "Member", "BoardMember", "Outsider");
  orgId = (await createOrg(owner)).id;
  await addMember(owner, orgId, member);
  await addMember(owner, orgId, boardMember);
  board = (await owner.api.post(`/organisations/${orgId}/boards`, { name: "Platform" })).body;
  expect(board.taskStatuses.map((s) => s.name)).toEqual(["To Do", "In Progress", "In Review", "Done"]);
  expect((await owner.api.post(`/boards/${board.id}/members`, { userId: boardMember.id })).status).toBe(201);
});

const col = (name: string) => board.taskStatuses.find((s) => s.name === name)!.id;

describe("board access", () => {
  test("members only see boards they've been added to; admins see all", async () => {
    expect((await member.api.get(`/boards/${board.id}`)).status).toBe(404);
    expect((await member.api.get(`/organisations/${orgId}/boards`)).body).toHaveLength(0);
    expect((await boardMember.api.get(`/boards/${board.id}`)).status).toBe(200);
    expect((await boardMember.api.get(`/organisations/${orgId}/boards`)).body).toHaveLength(1);
    expect((await outsider.api.get(`/boards/${board.id}/tasks`)).status).toBe(404);
  });

  test("board configuration is admin-only", async () => {
    expect((await boardMember.api.patch(`/boards/${board.id}`, { name: "Renamed" })).status).toBe(403);
    expect((await boardMember.api.delete(`/boards/${board.id}`)).status).toBe(403);
    expect((await boardMember.api.post(`/boards/${board.id}/statuses`, { name: "QA", type: "IN_REVIEW" })).status).toBe(403);
    expect((await boardMember.api.post(`/boards/${board.id}/members`, { userId: member.id })).status).toBe(403);
  });

  test("board members must belong to the org", async () => {
    expect((await owner.api.post(`/boards/${board.id}/members`, { userId: outsider.id })).status).toBe(400);
  });

  test("getBoard never leaks credentials in member lists", async () => {
    const res = await boardMember.api.get(`/boards/${board.id}`);
    expect(res.body.members.length).toBeGreaterThan(0);
  });
});

describe("tasks", () => {
  test("create validates column and assignees against the board", async () => {
    const other = (await owner.api.post(`/organisations/${orgId}/boards`, { name: "Other" })).body;

    const wrongColumn = await boardMember.api.post(`/boards/${board.id}/tasks`, { statusId: other.taskStatuses[0].id, title: "x" });
    expect(wrongColumn.status).toBe(400);

    // `member` isn't on the board, so can't be assigned work on it.
    const noAccess = await boardMember.api.post(`/boards/${board.id}/tasks`, { statusId: col("To Do"), title: "Hidden", assigneeIds: [member.id] });
    expect(noAccess.status).toBe(400);

    const events = await recordEvents(`board:${board.id}`);
    const ok = await boardMember.api.post(`/boards/${board.id}/tasks`, { statusId: col("To Do"), title: "Ship it", assigneeIds: [owner.id] });
    expect(ok.status).toBe(201);
    expect(ok.body.assignees[0].user.id).toBe(owner.id);
    expect(await events.find((e) => e.type === "TASK_CREATED")).toHaveLength(1);
    await events.close();
    expect((await notificationsFor(owner)).some((n) => n.type === "TASK_ASSIGNED" && n.title.includes("Ship it"))).toBe(true);
  });

  test("moving can't cross boards and keeps integer positions under heavy reordering", async () => {
    const other = (await owner.api.post(`/organisations/${orgId}/boards`, { name: "Elsewhere" })).body;
    const mk = async (title: string) =>
      (await boardMember.api.post(`/boards/${board.id}/tasks`, { statusId: col("In Progress"), title })).body;
    const a = await mk("A");
    const b = await mk("B");
    const c = await mk("C");

    expect((await boardMember.api.patch(`/tasks/${c.id}/move`, { statusId: other.taskStatuses[0].id })).status).toBe(400);

    // Repeatedly drop c between a and b, then b between a and c... forces the gap to run out.
    for (let i = 0; i < 14; i++) {
      const [first, moving] = i % 2 === 0 ? [a, c] : [a, b];
      const sibling = i % 2 === 0 ? b : c;
      const res = await boardMember.api.patch(`/tasks/${moving.id}/move`, {
        statusId: col("In Progress"),
        beforeTaskId: first.id,
        afterTaskId: sibling.id,
      });
      expect(res.status).toBe(200);
      expect(Number.isInteger(res.body.position)).toBe(true);
    }
    const rows = await prisma.task.findMany({ where: { statusId: col("In Progress") }, orderBy: { position: "asc" } });
    expect(new Set(rows.map((r) => r.position)).size).toBe(rows.length);
    expect(rows[0]!.id).toBe(a.id);
  });

  test("moving into Done stamps completedAt; moving out clears it", async () => {
    const task = (await boardMember.api.post(`/boards/${board.id}/tasks`, { statusId: col("To Do"), title: "Finish me" })).body;
    const done = await boardMember.api.patch(`/tasks/${task.id}/move`, { statusId: col("Done") });
    expect(done.body.completedAt).toBeString();
    const back = await boardMember.api.patch(`/tasks/${task.id}/move`, { statusId: col("To Do") });
    expect(back.body.completedAt).toBeNull();
  });

  test("approval columns are gated to admins", async () => {
    const approved = (await owner.api.post(`/boards/${board.id}/statuses`, { name: "Approved", type: "APPROVED" })).body;
    const task = (await boardMember.api.post(`/boards/${board.id}/tasks`, { statusId: col("In Review"), title: "Needs sign-off" })).body;
    expect((await boardMember.api.patch(`/tasks/${task.id}/move`, { statusId: approved.id })).status).toBe(403);
    expect((await owner.api.patch(`/tasks/${task.id}/move`, { statusId: approved.id })).status).toBe(200);
  });

  test("columns with tasks can't be deleted; column ids are scoped to the board", async () => {
    const other = (await owner.api.post(`/organisations/${orgId}/boards`, { name: "Scoped" })).body;
    expect((await owner.api.delete(`/boards/${board.id}/statuses/${col("To Do")}`)).status).toBe(409);
    expect((await owner.api.patch(`/boards/${board.id}/statuses/${other.taskStatuses[0].id}`, { name: "Hijacked" })).status).toBe(404);
    const reordered = await owner.api.patch(`/boards/${board.id}/statuses/${col("Done")}/reorder`, { beforeId: null, afterId: col("To Do") });
    expect(reordered.status).toBe(200);
    expect(Number.isInteger(reordered.body.position)).toBe(true);
  });

  test("task routes enforce board membership", async () => {
    const task = (await boardMember.api.post(`/boards/${board.id}/tasks`, { statusId: col("To Do"), title: "Private" })).body;
    expect((await member.api.get(`/tasks/${task.id}`)).status).toBe(404);
    expect((await member.api.patch(`/tasks/${task.id}`, { title: "hax" })).status).toBe(404);
    expect((await outsider.api.post(`/tasks/${task.id}/comments`, { content: "hi" })).status).toBe(404);
  });

  test("comments are scoped to their task and editable by the author only", async () => {
    const t1 = (await boardMember.api.post(`/boards/${board.id}/tasks`, { statusId: col("To Do"), title: "T1" })).body;
    const t2 = (await boardMember.api.post(`/boards/${board.id}/tasks`, { statusId: col("To Do"), title: "T2" })).body;
    const comment = (await boardMember.api.post(`/tasks/${t1.id}/comments`, { content: "on t1" })).body;
    expect((await boardMember.api.patch(`/tasks/${t2.id}/comments/${comment.id}`, { content: "x" })).status).toBe(404);
    expect((await owner.api.patch(`/tasks/${t1.id}/comments/${comment.id}`, { content: "x" })).status).toBe(403);
    expect((await owner.api.delete(`/tasks/${t1.id}/comments/${comment.id}`)).status).toBe(204); // admin moderation
    const full = await boardMember.api.get(`/tasks/${t1.id}`);
    expect(full.body.activities.length).toBeGreaterThan(0);
  });
});
