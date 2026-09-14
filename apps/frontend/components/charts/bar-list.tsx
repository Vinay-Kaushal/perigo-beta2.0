"use client";

import { useState } from "react";

/**
 * Horizontal bars for one series of magnitudes by category. Single hue, value
 * at the bar tip, 4px rounded data-end, per-bar hover/focus tooltip.
 */
export function BarList({
  items,
  format = (v) => String(v),
  color = "var(--series-1)",
  emptyLabel = "No data yet",
  ariaLabel,
}: {
  items: Array<{ label: React.ReactNode; key: string; value: number; hint?: string }>;
  format?: (value: number) => string;
  color?: string;
  emptyLabel?: string;
  ariaLabel: string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const max = Math.max(0, ...items.map((i) => i.value));
  if (items.length === 0 || max === 0) return <p className="py-6 text-center text-[13px] text-ink-faint">{emptyLabel}</p>;

  return (
    <ul className="space-y-2.5" aria-label={ariaLabel}>
      {items.map((item) => {
        const pct = Math.max(1.5, (item.value / max) * 100);
        return (
          <li
            key={item.key}
            tabIndex={0}
            className="group relative grid grid-cols-[minmax(80px,140px)_1fr] items-center gap-3 rounded outline-none"
            onPointerEnter={() => setActive(item.key)}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive(item.key)}
            onBlur={() => setActive(null)}
          >
            <span className="truncate text-[13px] text-ink-muted">{item.label}</span>
            <div className="flex items-center gap-2">
              <div className="h-3 min-w-0 flex-1">
                <div
                  className="h-3 rounded-r transition-opacity"
                  style={{ width: `${pct}%`, background: color, opacity: active && active !== item.key ? 0.55 : 1 }}
                />
              </div>
              <span className="tabular w-16 shrink-0 text-right text-[13px] font-medium text-ink">{format(item.value)}</span>
            </div>
            {active === item.key && item.hint && (
              <div className="pointer-events-none absolute -top-8 left-[150px] z-10 whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink shadow-pop">
                {item.hint}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
