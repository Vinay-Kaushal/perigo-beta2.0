import { isValidTimezone, localParts, zonedToUtc } from "./businessHours";

/**
 * Date-range filters as people mean them: calendar days in the organisation's
 * timezone, with both ends inclusive. "2026-09-01 to 2026-09-30" covers the
 * whole of the 30th in Asia/Kolkata, not up to midnight UTC. Full ISO
 * timestamps are accepted too, as exact instants.
 */
export class DateRangeError extends Error {}

export interface ResolvedRange {
  /** Inclusive lower bound. */
  gte?: Date;
  /** Exclusive upper bound. */
  lt?: Date;
}

export type Granularity = "day" | "week" | "month";

interface LocalDate {
  year: number;
  month: number;
  day: number;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export function parseLocalDate(value: string): LocalDate | null {
  const m = DATE_ONLY.exec(value);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return { year, month, day };
}

export const formatLocalDate = (d: LocalDate) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

export function addDays(d: LocalDate, days: number): LocalDate {
  const probe = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return { year: probe.getUTCFullYear(), month: probe.getUTCMonth() + 1, day: probe.getUTCDate() };
}

/** Today's calendar date in a timezone. */
export function todayIn(timezone: string, now = new Date()): LocalDate {
  const p = localParts(now, timezone);
  return { year: p.year, month: p.month, day: p.day };
}

const startOfLocalDay = (d: LocalDate, tz: string) => zonedToUtc(d.year, d.month, d.day, 0, tz);

function bound(value: string, tz: string, edge: "from" | "to"): Date {
  const local = parseLocalDate(value);
  if (local) return startOfLocalDay(edge === "from" ? local : addDays(local, 1), tz);
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const instant = new Date(value);
    if (!Number.isNaN(instant.getTime())) return edge === "from" ? instant : new Date(instant.getTime() + 1);
  }
  throw new DateRangeError(`"${value}" isn't a valid date — use YYYY-MM-DD`);
}

export function resolveDateRange(input: { from?: string; to?: string }, timezone: string, { maxDays }: { maxDays?: number } = {}): ResolvedRange {
  if (!isValidTimezone(timezone)) throw new DateRangeError(`Unknown timezone "${timezone}"`);
  const range: ResolvedRange = {
    ...(input.from ? { gte: bound(input.from, timezone, "from") } : {}),
    ...(input.to ? { lt: bound(input.to, timezone, "to") } : {}),
  };
  if (range.gte && range.lt && range.gte >= range.lt) throw new DateRangeError("The start date must be on or before the end date");
  if (maxDays && range.gte && range.lt && range.lt.getTime() - range.gte.getTime() > maxDays * DAY_MS + 2 * 60 * 60 * 1000) {
    // (The two-hour allowance absorbs DST shifts; a range is a whole number of local days.)
    throw new DateRangeError(`Choose a range of at most ${maxDays} days`);
  }
  return range;
}

/** For Prisma `where` clauses; undefined when the range is open on both ends. */
export function rangeFilter(range: ResolvedRange) {
  return range.gte || range.lt ? { ...(range.gte ? { gte: range.gte } : {}), ...(range.lt ? { lt: range.lt } : {}) } : undefined;
}

export function granularityFor(days: number): Granularity {
  return days <= 62 ? "day" : days <= 366 ? "week" : "month";
}

/**
 * Bucket keys covering a closed-day range, matching Postgres date_trunc in the
 * org's timezone: days, ISO weeks (keyed by their Monday) or months (keyed by the 1st).
 */
export function bucketKeys(from: LocalDate, to: LocalDate, granularity: Granularity): string[] {
  const keys: string[] = [];
  let cursor = from;
  if (granularity === "week") {
    const weekday = new Date(Date.UTC(from.year, from.month - 1, from.day)).getUTCDay();
    cursor = addDays(from, -((weekday + 6) % 7));
  } else if (granularity === "month") {
    cursor = { year: from.year, month: from.month, day: 1 };
  }
  const end = formatLocalDate(to);
  while (formatLocalDate(cursor) <= end) {
    keys.push(formatLocalDate(cursor));
    cursor =
      granularity === "day"
        ? addDays(cursor, 1)
        : granularity === "week"
          ? addDays(cursor, 7)
          : { year: cursor.month === 12 ? cursor.year + 1 : cursor.year, month: cursor.month === 12 ? 1 : cursor.month + 1, day: 1 };
    if (keys.length > 2000) break;
  }
  return keys;
}

export const daysBetween = (from: LocalDate, to: LocalDate) =>
  Math.round((Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) / DAY_MS) + 1;

/** "YYYY-MM-DD HH:mm" in a timezone — how exports show timestamps. */
export function formatLocalDateTime(instant: Date | null | undefined, timezone: string) {
  if (!instant) return "";
  const p = localParts(instant, timezone);
  return `${formatLocalDate(p)} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

export function formatLocalDay(instant: Date | null | undefined, timezone: string) {
  return instant ? formatLocalDate(localParts(instant, timezone)) : "";
}
