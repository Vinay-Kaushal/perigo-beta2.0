import { describe, expect, test } from "bun:test";
import { computeGoalProgress, elapsedFraction } from "../../domain/goals";

const periodStart = new Date("2026-01-01T00:00:00Z");
const periodEnd = new Date("2026-01-31T00:00:00Z");
const midway = new Date("2026-01-16T00:00:00Z");
const before = new Date("2025-12-15T00:00:00Z");
const after = new Date("2026-02-10T00:00:00Z");

describe("elapsedFraction", () => {
  test("clamps to [0, 1]", () => {
    expect(elapsedFraction(periodStart, periodEnd, before)).toBe(0);
    expect(elapsedFraction(periodStart, periodEnd, after)).toBe(1);
    expect(elapsedFraction(periodStart, periodEnd, midway)).toBeCloseTo(0.5, 5);
  });

  test("zero-length periods don't divide by zero", () => {
    expect(elapsedFraction(periodStart, periodStart, before)).toBe(0);
    expect(elapsedFraction(periodStart, periodStart, after)).toBe(1);
  });
});

describe("BUDGET goals (stay under)", () => {
  const goal = { type: "BUDGET" as const, periodStart, periodEnd };

  test("on track when spend follows the calendar", () => {
    expect(computeGoalProgress(goal, 400, 1000, midway).health).toBe("ON_TRACK");
  });

  test("at risk when spending runs well ahead of the calendar", () => {
    expect(computeGoalProgress(goal, 700, 1000, midway).health).toBe("AT_RISK");
    expect(computeGoalProgress(goal, 950, 1000, midway).health).toBe("AT_RISK");
  });

  test("off track once over budget, even after the period", () => {
    expect(computeGoalProgress(goal, 1200, 1000, midway).health).toBe("OFF_TRACK");
    expect(computeGoalProgress(goal, 1200, 1000, after).health).toBe("OFF_TRACK");
  });

  test("achieved when the period ends within budget", () => {
    const p = computeGoalProgress(goal, 800, 1000, after);
    expect(p.health).toBe("ACHIEVED");
    expect(p.percent).toBe(80);
  });

  test("not started before the period", () => {
    expect(computeGoalProgress(goal, 0, 1000, before).health).toBe("NOT_STARTED");
  });
});

describe("METRIC goals (reach)", () => {
  const goal = { type: "METRIC" as const, periodStart, periodEnd };

  test("achieved as soon as the target is met", () => {
    expect(computeGoalProgress(goal, 100, 100, midway).health).toBe("ACHIEVED");
    expect(computeGoalProgress(goal, 150, 100, midway).percent).toBe(150);
  });

  test("health tracks the gap to linear progress", () => {
    expect(computeGoalProgress(goal, 45, 100, midway).health).toBe("ON_TRACK");
    expect(computeGoalProgress(goal, 30, 100, midway).health).toBe("AT_RISK");
    expect(computeGoalProgress(goal, 10, 100, midway).health).toBe("OFF_TRACK");
  });

  test("missed when the period ends short", () => {
    expect(computeGoalProgress(goal, 60, 100, after).health).toBe("MISSED");
  });

  test("reports the expected percent for the UI", () => {
    expect(computeGoalProgress(goal, 50, 100, midway).expectedPercent).toBe(50);
  });
});
