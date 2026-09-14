"use client";

import { useMemo, useRef, useState } from "react";
import { format, parseISO } from "date-fns";

export interface TrendSeries {
  key: string;
  label: string;
  color: string; // CSS color — categorical slot, in fixed order
}

/**
 * Multi-series line chart over days. One y-axis, 2px lines, end-dot + direct
 * label on each series, legend always shown, crosshair tooltip listing every
 * series at the hovered day. A visually-hidden table carries the same data.
 */
export function TrendChart({
  data,
  series,
  height = 220,
  ariaLabel,
}: {
  data: Array<{ date: string } & Record<string, number | string>>;
  series: TrendSeries[];
  height?: number;
  ariaLabel: string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const width = 640;
  const pad = { top: 16, right: 92, bottom: 28, left: 36 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const max = useMemo(() => {
    const m = Math.max(1, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0)));
    const step = m <= 5 ? 1 : m <= 10 ? 2 : Math.ceil(m / 5 / 5) * 5;
    return Math.ceil(m / step) * step;
  }, [data, series]);
  const ticks = useMemo(() => {
    const count = Math.min(max, 4);
    return Array.from({ length: count + 1 }, (_, i) => Math.round((max / count) * i));
  }, [max]);

  const x = (i: number) => pad.left + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;

  function onMove(e: React.PointerEvent) {
    const svg = ref.current;
    if (!svg || data.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const i = Math.round(((px - pad.left) / innerW) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  }

  const last = data.length - 1;
  const stride = Math.max(1, Math.ceil(data.length / 7));
  // End labels: push apart vertically when two series end at (nearly) the same value.
  const endLabelY = (() => {
    const ys = series.map((s) => ({ key: s.key, y: y(Number(data[last]?.[s.key]) || 0) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ys.length; i++) if (ys[i]!.y - ys[i - 1]!.y < 14) ys[i]!.y = ys[i - 1]!.y + 14;
    return Object.fromEntries(ys.map((e) => [e.key, e.y]));
  })();
  const hovered = hover !== null ? data[hover] : null;

  return (
    <div className="relative">
      <div className="mb-3 flex flex-wrap gap-4" aria-hidden>
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
            <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <svg
        ref={ref}
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full touch-none"
        role="img"
        aria-label={ariaLabel}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tabular fill-ink-faint text-[11px]">
              {t}
            </text>
          </g>
        ))}
        {data.map((d, i) =>
          (i % stride === 0 && last - i >= stride) || i === last ? (
            <text key={d.date} x={x(i)} y={height - 8} textAnchor="middle" className="fill-ink-faint text-[11px]">
              {format(parseISO(d.date), "MMM d")}
            </text>
          ) : null
        )}

        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + innerH} stroke="rgb(var(--border-strong))" strokeWidth={1} />}

        {series.map((s) => {
          const path = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(Number(d[s.key]) || 0)}`).join(" ");
          const endVal = Number(data[last]?.[s.key]) || 0;
          return (
            <g key={s.key}>
              <path d={path} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {last >= 0 && (
                <>
                  <circle cx={x(last)} cy={y(endVal)} r={4} fill={s.color} stroke="rgb(var(--surface))" strokeWidth={2} />
                  <text x={x(last) + 10} y={endLabelY[s.key]} dy="0.32em" className="tabular fill-ink-muted text-[11px]">
                    {endVal} {s.label.toLowerCase()}
                  </text>
                </>
              )}
              {hover !== null && (
                <circle cx={x(hover)} cy={y(Number(data[hover]?.[s.key]) || 0)} r={4} fill={s.color} stroke="rgb(var(--surface))" strokeWidth={2} />
              )}
            </g>
          );
        })}
      </svg>

      {hovered && hover !== null && (
        <div
          className="pointer-events-none absolute top-8 z-10 rounded-md border border-border bg-surface px-3 py-2 shadow-pop"
          style={{ left: `${(x(hover) / width) * 100}%`, transform: hover > data.length / 2 ? "translateX(calc(-100% - 12px))" : "translateX(12px)" }}
        >
          <div className="mb-1 text-2xs text-ink-faint">{format(parseISO(hovered.date), "EEE, MMM d")}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-2 text-xs">
              <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
              <span className="tabular font-semibold text-ink">{Number(hovered[s.key]) || 0}</span>
              <span className="text-ink-muted">{s.label}</span>
            </div>
          ))}
        </div>
      )}

      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <thead>
          <tr>
            <th>Date</th>
            {series.map((s) => (
              <th key={s.key}>{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              {series.map((s) => (
                <td key={s.key}>{Number(d[s.key]) || 0}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
