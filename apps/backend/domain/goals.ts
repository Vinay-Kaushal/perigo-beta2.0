import type { GoalType } from "db/client";

export type GoalHealth = "ON_TRACK" | "AT_RISK" | "OFF_TRACK" | "ACHIEVED" | "MISSED" | "NOT_STARTED";

export interface GoalProgress {
  current: number;
  target: number;
  percent: number; // 0–100+, uncapped so over-budget / over-achievement is visible
  expectedPercent: number; // where you'd be if progress were linear over the period
  health: GoalHealth;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function elapsedFraction(periodStart: Date, periodEnd: Date, now: Date) {
  const total = periodEnd.getTime() - periodStart.getTime();
  if (total <= 0) return now >= periodEnd ? 1 : 0;
  return clamp((now.getTime() - periodStart.getTime()) / total, 0, 1);
}

/**
 * BUDGET goals are "stay under": spending ahead of the calendar is the risk.
 * METRIC / TICKETS_RESOLVED goals are "reach": falling behind the calendar is.
 */
export function computeGoalProgress(
  goal: { type: GoalType; periodStart: Date; periodEnd: Date },
  current: number,
  target: number,
  now = new Date()
): GoalProgress {
  const percent = target > 0 ? (current / target) * 100 : 0;
  const elapsed = elapsedFraction(goal.periodStart, goal.periodEnd, now);
  const expectedPercent = elapsed * 100;
  const round = (n: number) => Math.round(n * 10) / 10;
  const result = (health: GoalHealth): GoalProgress => ({
    current,
    target,
    percent: round(percent),
    expectedPercent: round(expectedPercent),
    health,
  });

  const ended = now.getTime() > goal.periodEnd.getTime();
  const started = now.getTime() >= goal.periodStart.getTime();

  if (goal.type === "BUDGET") {
    if (percent > 100) return result("OFF_TRACK");
    if (ended) return result("ACHIEVED");
    if (!started) return result("NOT_STARTED");
    if (percent > 90 || percent > expectedPercent + 15) return result("AT_RISK");
    return result("ON_TRACK");
  }

  if (percent >= 100) return result("ACHIEVED");
  if (ended) return result("MISSED");
  if (!started) return result("NOT_STARTED");
  const gap = expectedPercent - percent;
  if (gap <= 10) return result("ON_TRACK");
  if (gap <= 25) return result("AT_RISK");
  return result("OFF_TRACK");
}
