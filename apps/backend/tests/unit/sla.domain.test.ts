import { describe, expect, test } from "bun:test";
import { ALWAYS_OPEN, type BusinessSchedule } from "../../domain/businessHours";
import { DEFAULT_SLA, initialTargets, resolvePolicies, resume, retarget, type SlaContext } from "../../domain/sla";
import { isResponseBreached, isSlaBreached } from "../../domain/tickets";

const utc = (s: string) => new Date(`${s}Z`);
const nineToFive: BusinessSchedule = { enabled: true, timezone: "UTC", days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", holidays: [] };
const ctx = (schedule: BusinessSchedule, rows: Parameters<typeof resolvePolicies>[0] = []): SlaContext => ({ schedule, policies: resolvePolicies(rows) });

describe("policies", () => {
  test("defaults fill in anything an org hasn't customised", () => {
    const policies = resolvePolicies([{ priority: "HIGH", firstResponseMinutes: 15, resolutionMinutes: 90 }]);
    expect(policies.HIGH).toEqual({ firstResponseMinutes: 15, resolutionMinutes: 90 });
    expect(policies.LOW).toEqual(DEFAULT_SLA.LOW);
  });
});

describe("targets", () => {
  test("24/7: plain offsets from creation", () => {
    const t = initialTargets(ctx(ALWAYS_OPEN), "URGENT", utc("2026-09-18T22:00:00"));
    expect(t.responseDueAt.toISOString()).toBe("2026-09-18T22:30:00.000Z");
    expect(t.dueAt.toISOString()).toBe("2026-09-19T02:00:00.000Z");
  });

  test("business hours: a Friday-evening urgent ticket is due Monday", () => {
    const t = initialTargets(ctx(nineToFive), "URGENT", utc("2026-09-18T18:00:00"));
    expect(t.responseDueAt.toISOString()).toBe("2026-09-21T09:30:00.000Z");
    expect(t.dueAt.toISOString()).toBe("2026-09-21T13:00:00.000Z");
  });

  test("priority changes are measured from creation and keep paused time", () => {
    const c = ctx(nineToFive);
    const ticket = { createdAt: utc("2026-09-14T09:00:00"), slaPausedMinutes: 60, firstResponseAt: null };
    const r = retarget(c, ticket, "URGENT");
    // 4h budget + 1h paused from Monday 09:00 → 14:00
    expect(r.dueAt.toISOString()).toBe("2026-09-14T14:00:00.000Z");
    expect(r.responseDueAt!.toISOString()).toBe("2026-09-14T10:30:00.000Z");
    // Once responded, the response target is left alone.
    expect(retarget(c, { ...ticket, firstResponseAt: utc("2026-09-14T09:10:00") }, "URGENT")).not.toHaveProperty("responseDueAt");
  });
});

describe("pause and resume", () => {
  test("resuming shifts both targets by the business time spent on hold", () => {
    const c = ctx(nineToFive);
    // On hold Monday 16:00 → Tuesday 10:00 = 1h Monday + 1h Tuesday = 120 business minutes.
    const result = resume(
      c,
      { slaPausedAt: utc("2026-09-14T16:00:00"), slaPausedMinutes: 30, dueAt: utc("2026-09-15T12:00:00"), responseDueAt: utc("2026-09-14T17:00:00"), firstResponseAt: null },
      utc("2026-09-15T10:00:00")
    );
    expect(result.pausedMinutes).toBe(120);
    expect(result.slaPausedMinutes).toBe(150);
    expect(result.slaPausedAt).toBeNull();
    expect(result.dueAt!.toISOString()).toBe("2026-09-15T14:00:00.000Z");
    // 17:00 Monday + 2 business hours → Tuesday 11:00
    expect(result.responseDueAt!.toISOString()).toBe("2026-09-15T11:00:00.000Z");
  });

  test("a weekend on hold costs no SLA time", () => {
    const result = resume(
      ctx(nineToFive),
      { slaPausedAt: utc("2026-09-18T17:00:00"), slaPausedMinutes: 0, dueAt: utc("2026-09-21T12:00:00"), responseDueAt: null, firstResponseAt: null },
      utc("2026-09-21T09:00:00")
    );
    expect(result.pausedMinutes).toBe(0);
    expect(result.dueAt!.toISOString()).toBe("2026-09-21T12:00:00.000Z");
  });

  test("not paused: nothing changes; responded tickets keep their response target", () => {
    expect(resume(ctx(ALWAYS_OPEN), { slaPausedAt: null, slaPausedMinutes: 0, dueAt: null, responseDueAt: null, firstResponseAt: null }, new Date())).toEqual({});
    const r = resume(
      ctx(ALWAYS_OPEN),
      { slaPausedAt: utc("2026-09-14T10:00:00"), slaPausedMinutes: 0, dueAt: utc("2026-09-14T12:00:00"), responseDueAt: utc("2026-09-14T10:30:00"), firstResponseAt: utc("2026-09-14T10:05:00") },
      utc("2026-09-14T11:00:00")
    );
    expect(r).not.toHaveProperty("responseDueAt");
    expect(r.dueAt!.toISOString()).toBe("2026-09-14T13:00:00.000Z");
  });
});

describe("breach checks", () => {
  const now = utc("2026-09-14T12:00:00");
  const past = utc("2026-09-14T11:00:00");

  test("paused and on-hold tickets never breach", () => {
    expect(isSlaBreached({ status: "OPEN", dueAt: past }, now)).toBe(true);
    expect(isSlaBreached({ status: "ON_HOLD", dueAt: past }, now)).toBe(false);
    expect(isSlaBreached({ status: "OPEN", dueAt: past, slaPausedAt: past }, now)).toBe(false);
  });

  test("response breach needs no first response yet", () => {
    expect(isResponseBreached({ status: "NEW", dueAt: null, responseDueAt: past, firstResponseAt: null }, now)).toBe(true);
    expect(isResponseBreached({ status: "NEW", dueAt: null, responseDueAt: past, firstResponseAt: past }, now)).toBe(false);
    expect(isResponseBreached({ status: "ON_HOLD", dueAt: null, responseDueAt: past, firstResponseAt: null }, now)).toBe(false);
    expect(isResponseBreached({ status: "RESOLVED", dueAt: null, responseDueAt: past, firstResponseAt: null }, now)).toBe(false);
  });
});
