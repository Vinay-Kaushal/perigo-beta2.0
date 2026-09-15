/**
 * Business-time arithmetic for SLAs, with no dependencies.
 *
 * A schedule is either 24/7 or "working days, between start and end, in a
 * timezone, except holidays". Working windows are evaluated in the org's
 * local wall-clock time, so DST changes and non-UTC offsets are handled.
 */
export interface BusinessSchedule {
  enabled: boolean;
  timezone: string;
  /** 0 = Sunday … 6 = Saturday */
  days: number[];
  /** "HH:MM", local time */
  start: string;
  end: string;
  /** "YYYY-MM-DD" local dates */
  holidays: string[];
}

export const ALWAYS_OPEN: BusinessSchedule = { enabled: false, timezone: "UTC", days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "24:00", holidays: [] };

const MINUTE = 60_000;
const MAX_DAYS_SCANNED = 366 * 5;

export function isValidTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function parseClock(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value) ?? (value === "24:00" ? [value, "24", "00"] : null);
  if (!match) throw new Error(`Invalid time "${value}" (expected HH:MM)`);
  return Number(match[1]) * 60 + Number(match[2]);
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = formatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(tz, f);
  }
  return f;
}

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

export function localParts(instant: Date, tz: string): LocalParts {
  const parts = Object.fromEntries(formatter(tz).formatToParts(instant).map((p) => [p.type, p.value]));
  return { year: +parts.year!, month: +parts.month!, day: +parts.day!, hour: +parts.hour!, minute: +parts.minute! };
}

/** Offset of `tz` from UTC at `instant`, in minutes (e.g. +330 for Asia/Kolkata). */
function offsetMinutes(instant: Date, tz: string) {
  const p = localParts(instant, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(instant.getTime() / MINUTE) * MINUTE) / MINUTE);
}

/**
 * The UTC instant for a local wall-clock time. For times skipped by a DST
 * jump this lands just after the gap; for repeated times, the first occurrence.
 */
export function zonedToUtc(year: number, month: number, day: number, minutesOfDay: number, tz: string): Date {
  const wall = Date.UTC(year, month - 1, day) + minutesOfDay * MINUTE;
  let guess = wall - offsetMinutes(new Date(wall), tz) * MINUTE;
  // Re-evaluate the offset at the guess (handles instants near a DST change).
  guess = wall - offsetMinutes(new Date(guess), tz) * MINUTE;
  return new Date(guess);
}

const dateKey = (p: { year: number; month: number; day: number }) =>
  `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;

/** Calendar step on a local date (timezone-independent arithmetic on Y/M/D). */
function nextLocalDate(p: { year: number; month: number; day: number }, delta = 1) {
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + delta));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function weekday(p: { year: number; month: number; day: number }) {
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

/** Working windows (UTC instants) for each local day, starting from the day containing `from`. */
function* windows(from: Date, schedule: BusinessSchedule) {
  const startMin = parseClock(schedule.start);
  const endMin = parseClock(schedule.end);
  const holidays = new Set(schedule.holidays);
  const days = new Set(schedule.days);
  let date: { year: number; month: number; day: number } = localParts(from, schedule.timezone);
  for (let i = 0; i < MAX_DAYS_SCANNED; i++) {
    if (days.has(weekday(date)) && !holidays.has(dateKey(date))) {
      const open = zonedToUtc(date.year, date.month, date.day, startMin, schedule.timezone);
      const close = zonedToUtc(date.year, date.month, date.day, endMin, schedule.timezone);
      if (close > open) yield { open, close };
    }
    date = nextLocalDate(date);
  }
}

export function assertSchedule(schedule: BusinessSchedule) {
  if (!schedule.enabled) return;
  if (!isValidTimezone(schedule.timezone)) throw new Error(`Unknown timezone "${schedule.timezone}"`);
  if (!schedule.days.length || schedule.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw new Error("Choose at least one working day");
  if (parseClock(schedule.end) <= parseClock(schedule.start)) throw new Error("Business hours must end after they start");
}

/** The instant `minutes` of business time after `start`. */
export function addBusinessMinutes(start: Date, minutes: number, schedule: BusinessSchedule): Date {
  if (minutes <= 0) return new Date(start);
  if (!schedule.enabled) return new Date(start.getTime() + minutes * MINUTE);

  let remaining = minutes * MINUTE;
  for (const { open, close } of windows(start, schedule)) {
    if (close <= start) continue;
    const from = Math.max(open.getTime(), start.getTime());
    const available = close.getTime() - from;
    if (remaining <= available) return new Date(from + remaining);
    remaining -= available;
  }
  throw new Error("Business schedule has no working time in the next five years");
}

/** Business minutes elapsed between two instants (0 if `to` is before `from`). */
export function businessMinutesBetween(from: Date, to: Date, schedule: BusinessSchedule): number {
  if (to <= from) return 0;
  if (!schedule.enabled) return Math.round((to.getTime() - from.getTime()) / MINUTE);

  let total = 0;
  for (const { open, close } of windows(from, schedule)) {
    if (open >= to) break;
    if (close <= from) continue;
    total += Math.min(close.getTime(), to.getTime()) - Math.max(open.getTime(), from.getTime());
  }
  return Math.round(total / MINUTE);
}

/** True when `instant` falls inside working time. */
export function isWorkingTime(instant: Date, schedule: BusinessSchedule): boolean {
  if (!schedule.enabled) return true;
  return businessMinutesBetween(instant, new Date(instant.getTime() + MINUTE), schedule) > 0;
}
