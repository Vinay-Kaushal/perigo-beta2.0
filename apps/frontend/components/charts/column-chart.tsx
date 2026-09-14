"use client";

import { useState } from "react";

/** Columns for one series over ordered periods (e.g. months). Value on hover/focus; latest column labeled. */
export function ColumnChart({
  data,
  format = (v) => String(v),
  color = "var(--series-1)",
  height = 180,
  ariaLabel,
}: {
  data: Array<{ key: string; label: string; value: number }>;
  format?: (value: number) => string;
  color?: string;
  height?: number;
  ariaLabel: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const lastIndex = data.length - 1;

  return (
    <div>
      <div className="flex items-end gap-3 border-b border-border" style={{ height }} role="list" aria-label={ariaLabel}>
        {data.map((d, i) => {
          const h = d.value === 0 ? 0 : Math.max(3, (d.value / max) * (height - 28));
          const showLabel = active === i || (active === null && i === lastIndex && d.value > 0);
          return (
            <div
              key={d.key}
              role="listitem"
              tabIndex={0}
              aria-label={`${d.label}: ${format(d.value)}`}
              className="relative flex h-full flex-1 flex-col items-center justify-end outline-none"
              onPointerEnter={() => setActive(i)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            >
              {showLabel && <span className="tabular mb-1 whitespace-nowrap text-2xs font-medium text-ink">{format(d.value)}</span>}
              <div
                className="w-full max-w-[24px] rounded-t transition-opacity"
                style={{ height: h, background: color, opacity: active !== null && active !== i ? 0.55 : 1 }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-3">
        {data.map((d) => (
          <span key={d.key} className="flex-1 text-center text-2xs text-ink-faint">
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}
