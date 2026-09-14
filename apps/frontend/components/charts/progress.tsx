import { cn } from "@/lib/utils";

/**
 * Goal meter: fill = actual progress (capped visually at 100%), a tick marks
 * where linear progress would be today. Health color always ships with a text badge.
 */
export function ProgressMeter({ percent, expected, color, className }: { percent: number; expected?: number; color: string; className?: string }) {
  const fill = Math.min(100, Math.max(0, percent));
  return (
    <div className={cn("relative h-2 w-full rounded-full bg-surface-muted", className)} role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-2 rounded-full" style={{ width: `${fill}%`, background: color }} />
      {expected !== undefined && expected > 0 && expected < 100 && (
        <span className="absolute -top-1 h-4 w-0.5 rounded bg-ink-muted/60" style={{ left: `${expected}%` }} title={`Expected by today: ${Math.round(expected)}%`} />
      )}
    </div>
  );
}
