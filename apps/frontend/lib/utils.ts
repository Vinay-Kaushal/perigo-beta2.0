import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, formatDistanceToNowStrict, isToday, isYesterday } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function money(amount: number, currency = "USD", compact = false) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: compact ? 1 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function number(n: number, digits = 0) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(n);
}

export function relativeTime(date: string | Date) {
  return formatDistanceToNowStrict(new Date(date), { addSuffix: true });
}

export function shortDate(date: string | Date) {
  const d = new Date(date);
  if (isToday(d)) return `Today, ${format(d, "HH:mm")}`;
  if (isYesterday(d)) return `Yesterday, ${format(d, "HH:mm")}`;
  return format(d, d.getFullYear() === new Date().getFullYear() ? "MMM d" : "MMM d, yyyy");
}

export function fullDate(date: string | Date) {
  return format(new Date(date), "MMM d, yyyy 'at' HH:mm");
}

/** "in 3h" / "2d overdue" — how SLAs read at a glance. */
export function dueLabel(dueAt: string | null | undefined) {
  if (!dueAt) return null;
  const diff = new Date(dueAt).getTime() - Date.now();
  const abs = Math.abs(diff);
  const unit =
    abs < 3_600_000
      ? `${Math.max(1, Math.round(abs / 60_000))}m`
      : abs < 48 * 3_600_000
        ? `${Math.round(abs / 3_600_000)}h`
        : `${Math.round(abs / 86_400_000)}d`;
  return diff < 0 ? { text: `${unit} overdue`, overdue: true } : { text: `due in ${unit}`, overdue: false };
}

/**
 * A policy duration in words: "30 min", "4 hours", "1h 30m", "3 days". With
 * business hours on, days are ambiguous (a "day" is a working day, not 24h),
 * so durations stay in hours.
 */
export function durationLabel(minutes: number, { business = false } = {}) {
  if (minutes < 60) return `${minutes} min`;
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (!business && minutes % 1440 === 0) return plural(minutes / 1440, "day");
  if (minutes % 60 === 0) return plural(minutes / 60, "hour");
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function titleCase(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}
