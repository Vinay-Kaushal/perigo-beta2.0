import { describe, expect, test } from "bun:test";
import {
  ALWAYS_OPEN,
  addBusinessMinutes,
  assertSchedule,
  businessMinutesBetween,
  isValidTimezone,
  isWorkingTime,
  localParts,
  zonedToUtc,
  type BusinessSchedule,
} from "../../domain/businessHours";

const utc = (s: string) => new Date(`${s}Z`);
const H = 60;

const utc9to5: BusinessSchedule = { enabled: true, timezone: "UTC", days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", holidays: [] };
const kolkata: BusinessSchedule = { ...utc9to5, timezone: "Asia/Kolkata" };
const newYork: BusinessSchedule = { ...utc9to5, timezone: "America/New_York" };

describe("24/7 schedule", () => {
  test("is plain clock arithmetic", () => {
    expect(addBusinessMinutes(utc("2026-09-18T22:00:00"), 4 * H, ALWAYS_OPEN).toISOString()).toBe("2026-09-19T02:00:00.000Z");
    expect(businessMinutesBetween(utc("2026-09-18T22:00:00"), utc("2026-09-19T02:30:00"), ALWAYS_OPEN)).toBe(270);
  });
});

describe("UTC 9–5, Mon–Fri", () => {
  test("within the same day", () => {
    // Monday 10:00 + 2h = 12:00
    expect(addBusinessMinutes(utc("2026-09-14T10:00:00"), 2 * H, utc9to5).toISOString()).toBe("2026-09-14T12:00:00.000Z");
  });

  test("rolls into the next working day", () => {
    // Monday 16:00 + 4h = 1h Monday + 3h Tuesday → Tuesday 12:00
    expect(addBusinessMinutes(utc("2026-09-14T16:00:00"), 4 * H, utc9to5).toISOString()).toBe("2026-09-15T12:00:00.000Z");
  });

  test("created outside hours starts counting at the next opening", () => {
    // Monday 20:00 + 1h → Tuesday 10:00; Tuesday 06:00 + 1h → Tuesday 10:00
    expect(addBusinessMinutes(utc("2026-09-14T20:00:00"), H, utc9to5).toISOString()).toBe("2026-09-15T10:00:00.000Z");
    expect(addBusinessMinutes(utc("2026-09-15T06:00:00"), H, utc9to5).toISOString()).toBe("2026-09-15T10:00:00.000Z");
  });

  test("skips weekends", () => {
    // Friday 16:00 + 2h → 1h Friday + 1h Monday → Monday 10:00
    expect(addBusinessMinutes(utc("2026-09-18T16:00:00"), 2 * H, utc9to5).toISOString()).toBe("2026-09-21T10:00:00.000Z");
    // Saturday → Monday 09:00 + 30m
    expect(addBusinessMinutes(utc("2026-09-19T12:00:00"), 30, utc9to5).toISOString()).toBe("2026-09-21T09:30:00.000Z");
  });

  test("skips holidays", () => {
    const withHoliday = { ...utc9to5, holidays: ["2026-09-15"] };
    expect(addBusinessMinutes(utc("2026-09-14T16:00:00"), 2 * H, withHoliday).toISOString()).toBe("2026-09-16T10:00:00.000Z");
  });

  test("exactly at closing time lands at closing, not the next morning", () => {
    expect(addBusinessMinutes(utc("2026-09-14T09:00:00"), 8 * H, utc9to5).toISOString()).toBe("2026-09-14T17:00:00.000Z");
  });

  test("multi-day budgets (3 business days = 24 business hours)", () => {
    // Wednesday 09:00 + 24h → Wed, Thu, Fri full days → Friday 17:00
    expect(addBusinessMinutes(utc("2026-09-16T09:00:00"), 24 * H, utc9to5).toISOString()).toBe("2026-09-18T17:00:00.000Z");
  });

  test("minutes between counts only working time and inverts add", () => {
    expect(businessMinutesBetween(utc("2026-09-18T16:00:00"), utc("2026-09-21T10:00:00"), utc9to5)).toBe(2 * H);
    expect(businessMinutesBetween(utc("2026-09-19T00:00:00"), utc("2026-09-20T23:59:00"), utc9to5)).toBe(0);
    expect(businessMinutesBetween(utc("2026-09-21T10:00:00"), utc("2026-09-18T16:00:00"), utc9to5)).toBe(0);
    for (const minutes of [1, 59, 480, 1234, 5000]) {
      const start = utc("2026-09-17T13:17:00");
      expect(businessMinutesBetween(start, addBusinessMinutes(start, minutes, utc9to5), utc9to5)).toBe(minutes);
    }
  });

  test("working-time check", () => {
    expect(isWorkingTime(utc("2026-09-14T09:00:00"), utc9to5)).toBe(true);
    expect(isWorkingTime(utc("2026-09-14T17:00:00"), utc9to5)).toBe(false);
    expect(isWorkingTime(utc("2026-09-19T12:00:00"), utc9to5)).toBe(false);
  });
});

describe("timezones", () => {
  test("Asia/Kolkata (UTC+5:30, no DST)", () => {
    // Monday 09:00 IST = 03:30 UTC; + 1h = 04:30 UTC
    expect(addBusinessMinutes(utc("2026-09-14T03:30:00"), H, kolkata).toISOString()).toBe("2026-09-14T04:30:00.000Z");
    // Friday 16:30 IST (11:00 UTC) + 1h → 30m Friday + 30m Monday → Monday 09:30 IST = 04:00 UTC
    expect(addBusinessMinutes(utc("2026-09-18T11:00:00"), H, kolkata).toISOString()).toBe("2026-09-21T04:00:00.000Z");
    // A Monday 08:00 UTC instant is already 13:30 local: working time in Kolkata.
    expect(isWorkingTime(utc("2026-09-14T08:00:00"), kolkata)).toBe(true);
    // Monday 20:00 UTC is Tuesday 01:30 IST — not working time.
    expect(isWorkingTime(utc("2026-09-14T20:00:00"), kolkata)).toBe(false);
  });

  test("local dates decide the weekday, not UTC dates", () => {
    // Sunday 22:00 UTC is Monday 03:30 in Kolkata; the Monday window opens at 09:00 local (03:30 UTC Monday).
    expect(addBusinessMinutes(utc("2026-09-13T22:00:00"), 30, kolkata).toISOString()).toBe("2026-09-14T04:00:00.000Z");
  });

  test("America/New_York across the DST change (Nov 1, 2026)", () => {
    // Friday Oct 30 16:00 EDT (20:00 UTC) + 2h → 1h Friday + 1h Monday Nov 2, 10:00 EST (15:00 UTC)
    expect(addBusinessMinutes(utc("2026-10-30T20:00:00"), 2 * H, newYork).toISOString()).toBe("2026-11-02T15:00:00.000Z");
    // A full working day is still 8 hours on the Monday after the change.
    expect(businessMinutesBetween(utc("2026-11-02T14:00:00"), utc("2026-11-02T22:00:00"), newYork)).toBe(8 * H);
  });

  test("24/7 across DST is real elapsed time", () => {
    const tzAlways = { ...ALWAYS_OPEN, enabled: false };
    expect(businessMinutesBetween(utc("2026-11-01T04:00:00"), utc("2026-11-01T08:00:00"), tzAlways)).toBe(240);
  });

  test("zonedToUtc and localParts round-trip", () => {
    const instant = zonedToUtc(2026, 3, 8, 12 * 60, "America/New_York"); // day DST starts
    expect(instant.toISOString()).toBe("2026-03-08T16:00:00.000Z");
    expect(localParts(instant, "America/New_York")).toMatchObject({ year: 2026, month: 3, day: 8, hour: 12, minute: 0 });
    expect(zonedToUtc(2026, 9, 14, 9 * 60, "Asia/Kolkata").toISOString()).toBe("2026-09-14T03:30:00.000Z");
  });
});

describe("validation", () => {
  test("timezones", () => {
    expect(isValidTimezone("Europe/London")).toBe(true);
    expect(isValidTimezone("Mars/Olympus")).toBe(false);
  });

  test("schedules", () => {
    expect(() => assertSchedule(utc9to5)).not.toThrow();
    expect(() => assertSchedule({ ...utc9to5, days: [] })).toThrow("working day");
    expect(() => assertSchedule({ ...utc9to5, start: "17:00", end: "09:00" })).toThrow("end after");
    expect(() => assertSchedule({ ...utc9to5, start: "9am" })).toThrow("Invalid time");
    expect(() => assertSchedule({ ...utc9to5, timezone: "Nowhere/City" })).toThrow("Unknown timezone");
    expect(() => assertSchedule({ ...utc9to5, enabled: false, days: [] })).not.toThrow();
  });

  test("a schedule with no reachable working time fails loudly instead of looping", () => {
    const allHolidays: BusinessSchedule = { ...utc9to5, days: [1], holidays: Array.from({ length: 400 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 8, 14 + i * 7));
      return d.toISOString().slice(0, 10);
    }) };
    // Only Mondays, and every Monday for ~7.5 years is a holiday.
    expect(() => addBusinessMinutes(utc("2026-09-14T00:00:00"), 60, allHolidays)).toThrow("no working time");
  });
});
