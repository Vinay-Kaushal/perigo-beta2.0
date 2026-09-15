import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { dueLabel, durationLabel, initials, money, titleCase } from "./utils";

afterEach(() => setSystemTime());

describe("dueLabel", () => {
  test("future and overdue, in minutes, hours and days", () => {
    setSystemTime(new Date("2026-01-10T12:00:00Z"));
    expect(dueLabel("2026-01-10T12:30:00Z")).toEqual({ text: "due in 30m", overdue: false });
    expect(dueLabel("2026-01-10T15:00:00Z")).toEqual({ text: "due in 3h", overdue: false });
    expect(dueLabel("2026-01-13T12:00:00Z")).toEqual({ text: "due in 3d", overdue: false });
    expect(dueLabel("2026-01-10T10:00:00Z")).toEqual({ text: "2h overdue", overdue: true });
    expect(dueLabel("2026-01-07T12:00:00Z")).toEqual({ text: "3d overdue", overdue: true });
  });

  test("no due date", () => {
    expect(dueLabel(null)).toBeNull();
    expect(dueLabel(undefined)).toBeNull();
  });
});

describe("formatting", () => {
  test("money respects currency and falls back for unknown codes", () => {
    expect(money(1234.5, "USD")).toBe("$1,234.50");
    expect(money(1234.5, "EUR")).toBe("€1,234.50");
    expect(money(2500, "USD", true)).toBe("$2.5K");
    expect(money(10, "NOTACODE")).toBe("NOTACODE 10.00");
  });

  test("titleCase and initials", () => {
    expect(titleCase("IN_PROGRESS")).toBe("In Progress");
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("  cher ")).toBe("C");
    expect(initials("")).toBe("?");
  });
});

describe("durationLabel", () => {
  test("minutes, hours, mixed and days", () => {
    expect(durationLabel(30)).toBe("30 min");
    expect(durationLabel(60)).toBe("1 hour");
    expect(durationLabel(240)).toBe("4 hours");
    expect(durationLabel(90)).toBe("1h 30m");
    expect(durationLabel(1440)).toBe("1 day");
    expect(durationLabel(4320)).toBe("3 days");
  });

  test("business time never rounds to days", () => {
    expect(durationLabel(4320, { business: true })).toBe("72 hours");
    expect(durationLabel(1440, { business: true })).toBe("24 hours");
  });
});
