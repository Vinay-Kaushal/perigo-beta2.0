import { beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "../lib/prisma";
import { addMember, createOrg, registerUsers, request, type TestUser, useTestServer } from "./helpers";

useTestServer();

let owner: TestUser, member: TestUser, outsider: TestUser;
let org: { id: string; slug: string };
const t = (path = "") => `/organisations/${org.id}/tickets${path}`;
const EVIL = '=HYPERLINK("https://evil.example","Click")';

/** RFC 4180, enough for the exports under test. */
function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(cell), (cell = "");
    else if (c === "\r" && text[i + 1] === "\n") row.push(cell), rows.push(row), (row = []), (cell = ""), i++;
    else cell += c;
  }
  return rows;
}

async function ticketAt(user: TestUser, body: Record<string, unknown>, fields: { createdAt: string; resolvedAt?: string }) {
  const res = await user.api.post(t(), body);
  expect(res.status).toBe(201);
  await prisma.ticket.update({
    where: { id: res.body.id },
    data: { createdAt: new Date(fields.createdAt), ...(fields.resolvedAt ? { resolvedAt: new Date(fields.resolvedAt) } : {}) },
  });
  return res.body as { id: string; key: string; number: number };
}

let late14: { key: string }, early15: { key: string }, early16: { key: string };

beforeAll(async () => {
  [owner, member, outsider] = await registerUsers("Owner", "Member", "Outsider");
  org = await createOrg(owner);
  await addMember(owner, org.id, member);
  await prisma.organisation.update({ where: { id: org.id }, data: { timezone: "Asia/Kolkata" } });
  // 23:30, 00:30 and 00:10 local (UTC+5:30).
  late14 = await ticketAt(member, { title: "Late on the 14th" }, { createdAt: "2026-09-14T18:00:00Z" });
  early15 = await ticketAt(member, { title: EVIL, priority: "HIGH", assigneeId: member.id }, { createdAt: "2026-09-14T19:00:00Z", resolvedAt: "2026-09-15T19:00:00Z" });
  early16 = await ticketAt(member, { title: "Just after midnight on the 16th" }, { createdAt: "2026-09-15T18:40:00Z" });
});

describe("date-range filters on the queue", () => {
  test("calendar days are the org's, inclusive", async () => {
    const keys = async (qs: string) => (await member.api.get(t(`?${qs}`))).body.items.map((i: { key: string }) => i.key).sort();
    expect(await keys("from=2026-09-15&to=2026-09-15")).toEqual([early15.key]);
    expect(await keys("from=2026-09-15")).toEqual([early15.key, early16.key].sort());
    expect(await keys("to=2026-09-14")).toEqual([late14.key]);
    // Resolved 00:30 on the 16th, local.
    expect(await keys("from=2026-09-16&to=2026-09-16&dateField=resolved")).toEqual([early15.key]);
    expect(await keys("from=2026-09-15&to=2026-09-15&dateField=due")).toEqual([]);
  });

  test("bad ranges are 400s, not 500s", async () => {
    for (const qs of ["from=2026-02-30", "to=yesterday", "from=2026-09-10&to=2026-09-01", "from=2000-01-01&to=2026-01-01"]) {
      const res = await member.api.get(t(`?${qs}`));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_DATE_RANGE");
    }
    expect((await member.api.get(t("?dateField=password"))).body.code).toBe("VALIDATION_FAILED");
    expect((await member.api.get(t(`?from=${"9".repeat(41)}`))).status).toBe(400);
  });
});

describe("CSV export", () => {
  test("streams the filtered queue with safe headers, local times and neutralised formulas", async () => {
    const res = await member.api.get(t("/export.csv?from=2026-09-15&to=2026-09-15"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="${org.slug}-tickets-2026-09-15_2026-09-15.csv"`);

    const [header, ...rows] = parseCsv(res.text);
    expect(header).toContain("Created (Asia/Kolkata)");
    expect(rows).toHaveLength(1);
    const row = Object.fromEntries(header!.map((h, i) => [h, rows[0]![i]]));
    expect(row).toMatchObject({
      Key: early15.key,
      Title: `'${EVIL}`,
      Priority: "High",
      Assignee: "Member",
      "Assignee email": member.email,
      "Created (Asia/Kolkata)": "2026-09-15 00:30",
      "Resolved (Asia/Kolkata)": "2026-09-16 00:30",
      Comments: "0",
    });
  });

  test("is audited with the row count and filters", async () => {
    await member.api.get(t("/export.csv?priority=HIGH"));
    const log = await prisma.auditLog.findFirst({ where: { organisationId: org.id, action: "export.tickets", actorId: member.id }, orderBy: { createdAt: "desc" } });
    expect(log?.metadata).toEqual({ rows: 1, filters: { priority: "HIGH" } });
  });

  test("outsiders and anonymous callers get nothing", async () => {
    expect((await outsider.api.get(t("/export.csv"))).status).toBe(404);
    expect((await request("GET", t("/export.csv"))).status).toBe(401);
  });

  test("bad ranges fail before any CSV is sent", async () => {
    const res = await member.api.get(t("/export.csv?from=2026-09-10&to=2026-09-01"));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_DATE_RANGE");
  });
});

describe("large exports", () => {
  let big: { id: string; slug: string };
  let bigOwner: TestUser;

  async function seed(count: number, from = 1) {
    await prisma.ticket.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        organisationId: big.id,
        number: from + i,
        title: `Bulk ${from + i}`,
        requesterId: bigOwner.id,
        createdById: bigOwner.id,
        // Every third ticket has no SLA target, so nulls-last ordering is exercised across batches.
        dueAt: (from + i) % 3 === 0 ? null : new Date(Date.UTC(2026, 0, 1) + (from + i) * 60_000),
      })),
    });
  }

  beforeAll(async () => {
    [bigOwner] = await registerUsers("Bulk owner");
    big = await createOrg(bigOwner);
    await seed(1100);
  });

  test("spans many batches, keeps the requested order and loses no rows", async () => {
    const res = await bigOwner.api.get(`/organisations/${big.id}/tickets/export.csv?sort=dueAt&order=asc`);
    expect(res.status).toBe(200);
    const [, ...rows] = parseCsv(res.text);
    expect(rows).toHaveLength(1100);
    expect(new Set(rows.map((r) => r[0])).size).toBe(1100);
    const due = rows.map((r) => r[14]!);
    const firstBlank = due.indexOf("");
    expect(due.slice(0, firstBlank)).toEqual([...due.slice(0, firstBlank)].sort());
    expect(due.slice(firstBlank).every((d) => d === "")).toBe(true);
  });

  test("refuses beyond EXPORT_MAX_ROWS rather than truncating", async () => {
    await seed(101, 1101);
    const res = await bigOwner.api.get(`/organisations/${big.id}/tickets/export.csv`);
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: "EXPORT_TOO_LARGE", details: { max: 1200 } });
    // Narrowing the filters brings it back under the cap.
    expect((await bigOwner.api.get(`/organisations/${big.id}/tickets/export.csv?q=1201`)).status).toBe(200);
  });
});

test("exports are rate limited per user", async () => {
  const [u] = await registerUsers("Exporter");
  const own = await createOrg(u!);
  const url = `/organisations/${own.id}/tickets/export.csv`;
  const statuses: number[] = [];
  for (let i = 0; i < 11; i++) statuses.push((await u!.api.get(url)).status);
  expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
  expect(statuses[10]).toBe(429);
});
