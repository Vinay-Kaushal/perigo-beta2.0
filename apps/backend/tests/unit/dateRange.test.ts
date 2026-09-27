import { describe, expect, test } from "bun:test";
import { bucketKeys, DateRangeError, daysBetween, formatLocalDateTime, formatLocalDay, granularityFor, parseLocalDate, rangeFilter, resolveDateRange, todayIn } from "../../domain/dateRange";

describe("resolveDateRange", () => {
  test("calendar days are inclusive and interpreted in the org's timezone", () => {
    const utc = resolveDateRange({ from: "2026-09-01", to: "2026-09-30" }, "UTC");
    expect(utc.gte!.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(utc.lt!.toISOString()).toBe("2026-10-01T00:00:00.000Z");

    const kolkata = resolveDateRange({ from: "2026-09-01", to: "2026-09-30" }, "Asia/Kolkata");
    expect(kolkata.gte!.toISOString()).toBe("2026-08-31T18:30:00.000Z");
    expect(kolkata.lt!.toISOString()).toBe("2026-09-30T18:30:00.000Z");
  });

  test("DST: a New York day that springs forward is 23 hours", () => {
    const r = resolveDateRange({ from: "2026-03-08", to: "2026-03-08" }, "America/New_York");
    expect(r.gte!.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(r.lt!.toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });

  test("open ends, ISO instants, and the Prisma filter shape", () => {
    expect(resolveDateRange({}, "UTC")).toEqual({});
    expect(rangeFilter({})).toBeUndefined();
    const onlyTo = resolveDateRange({ to: "2026-01-31" }, "UTC");
    expect(rangeFilter(onlyTo)).toEqual({ lt: new Date("2026-02-01T00:00:00Z") });
    const instants = resolveDateRange({ from: "2026-01-01T10:00:00Z", to: "2026-01-01T11:00:00Z" }, "Asia/Tokyo");
    expect(instants.gte!.toISOString()).toBe("2026-01-01T10:00:00.000Z");
    expect(instants.lt!.toISOString()).toBe("2026-01-01T11:00:00.001Z");
  });

  test("rejects nonsense", () => {
    for (const bad of [{ from: "2026-02-30" }, { from: "31/12/2026" }, { to: "yesterday" }, { from: "2026-13-01" }]) {
      expect(() => resolveDateRange(bad, "UTC")).toThrow(DateRangeError);
    }
    expect(() => resolveDateRange({ from: "2026-09-10", to: "2026-09-01" }, "UTC")).toThrow("on or before");
    expect(() => resolveDateRange({ from: "2026-01-01", to: "2027-01-01" }, "UTC", { maxDays: 366 })).not.toThrow();
    expect(() => resolveDateRange({ from: "2026-03-01", to: "2026-03-31" }, "America/New_York", { maxDays: 31 })).not.toThrow();
    expect(() => resolveDateRange({ from: "2026-01-01", to: "2027-01-02" }, "UTC", { maxDays: 366 })).toThrow("at most 366 days");
    expect(() => resolveDateRange({ from: "2026-01-01" }, "Mars/Base")).toThrow("timezone");
  });
});

describe("buckets", () => {
  test("granularity follows the span", () => {
    expect(granularityFor(14)).toBe("day");
    expect(granularityFor(62)).toBe("day");
    expect(granularityFor(90)).toBe("week");
    expect(granularityFor(400)).toBe("month");
  });

  test("days, ISO weeks keyed by Monday, months keyed by the 1st", () => {
    const from = parseLocalDate("2026-09-02")!; // Wednesday
    expect(bucketKeys(from, parseLocalDate("2026-09-04")!, "day")).toEqual(["2026-09-02", "2026-09-03", "2026-09-04"]);
    expect(bucketKeys(from, parseLocalDate("2026-09-15")!, "week")).toEqual(["2026-08-31", "2026-09-07", "2026-09-14"]);
    expect(bucketKeys(parseLocalDate("2026-11-20")!, parseLocalDate("2027-02-01")!, "month")).toEqual(["2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01"]);
    expect(daysBetween(parseLocalDate("2026-01-01")!, parseLocalDate("2026-12-31")!)).toBe(365);
  });
});

describe("formatting", () => {
  test("timestamps in the org's timezone", () => {
    const instant = new Date("2026-09-15T20:15:00Z");
    expect(formatLocalDateTime(instant, "UTC")).toBe("2026-09-15 20:15");
    expect(formatLocalDateTime(instant, "Asia/Kolkata")).toBe("2026-09-16 01:45");
    expect(formatLocalDay(instant, "America/Los_Angeles")).toBe("2026-09-15");
    expect(formatLocalDateTime(null, "UTC")).toBe("");
    expect(todayIn("Pacific/Kiritimati", new Date("2026-09-15T20:00:00Z"))).toEqual({ year: 2026, month: 9, day: 16 });
  });
});
