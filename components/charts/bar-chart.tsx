'use client';

import { useState } from 'react';
import { barPath, niceTicks } from './scale';

export interface BarSeries {
  key: string;
  label: string;
  /** CSS variable for the series colour, e.g. 'var(--viz-1)'. */
  color: string;
  /** One value per category; null means there is nothing to show (e.g. too few observations). */
  values: (number | null)[];
  /** Observations behind each value, shown in the tooltip and table. */
  counts?: number[];
}

interface Props {
  categories: string[];
  series: BarSeries[];
  format: (v: number) => string;
  /** What the value axis measures, for the screen-reader label and table caption. */
  measure: string;
  /** Show every k-th category label (dense axes such as histograms). */
  labelEvery?: number;
  /** Text for a category with no value. */
  emptyText?: string;
}

const W = 720;
const H = 300;
const M = { l: 56, r: 16, t: 16, b: 44 };
const PLOT_W = W - M.l - M.r;
const PLOT_H = H - M.t - M.b;
const MAX_BAR = 24;
const GAP = 2;

/**
 * Grouped columns from a zero baseline (spec marks: thin bars, rounded data end, 2px gap between
 * neighbours). The whole category column is the hover/focus target, so no pixel-hunting; every
 * value is also in the table view, so the tooltip never gates information.
 */
export function BarChart({ categories, series, format, measure, labelEvery = 1, emptyText = 'Insufficient data' }: Props) {
  const [active, setActive] = useState<number | null>(null);

  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const lo = Math.min(0, ...all);
  const hi = Math.max(0, ...all);
  const pad = (hi - lo || 1) * 0.08;
  const ticks = niceTicks(lo < 0 ? lo - pad : 0, hi > 0 ? hi + pad : 0);
  const yMin = Math.min(lo < 0 ? lo - pad : 0, ticks[0]);
  const yMax = Math.max(hi > 0 ? hi + pad : 0, ticks.at(-1) ?? 0) || 1;
  const y = (v: number) => M.t + (1 - (v - yMin) / (yMax - yMin)) * PLOT_H;

  const colW = PLOT_W / Math.max(categories.length, 1);
  const barW = Math.max(2, Math.min(MAX_BAR, (colW * 0.7 - GAP * (series.length - 1)) / series.length));
  const groupW = barW * series.length + GAP * (series.length - 1);
  const colX = (i: number) => M.l + i * colW;

  const move = (clientX: number, rect: DOMRect) => {
    const px = ((clientX - rect.left) / rect.width) * W;
    const i = Math.floor((px - M.l) / colW);
    setActive(i >= 0 && i < categories.length ? i : null);
  };

  return (
    <figure className="m-0">
      {series.length > 1 ? (
        <div className="text-muted-foreground mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-2 w-3 rounded-sm" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      ) : null}

      <div
        className="relative rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        tabIndex={0}
        role="group"
        aria-label={`${measure} by category. Use the left and right arrow keys to read each category.`}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          setActive((cur) => Math.min(categories.length - 1, Math.max(0, (cur ?? -1) + (e.key === 'ArrowRight' ? 1 : -1))));
        }}
        onBlur={() => setActive(null)}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full touch-pan-y"
          aria-hidden
          onPointerMove={(e) => move(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setActive(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={M.l - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground text-[11px]">
                {format(t)}
              </text>
            </g>
          ))}
          <line x1={M.l} x2={W - M.r} y1={y(0)} y2={y(0)} stroke="var(--muted-foreground)" strokeWidth={1} opacity={0.6} />

          {active !== null ? <rect x={colX(active)} y={M.t} width={colW} height={PLOT_H} fill="var(--muted)" opacity={0.6} /> : null}

          {categories.map((c, i) => (
            <g key={c}>
              {series.map((s, si) => {
                const v = s.values[i];
                if (v === null || v === undefined) return null;
                const x = colX(i) + (colW - groupW) / 2 + si * (barW + GAP);
                return <path key={s.key} d={barPath(x, barW, y(0), y(v))} fill={s.color} opacity={active === null || active === i ? 1 : 0.55} />;
              })}
              {i % labelEvery === 0 ? (
                <text x={colX(i) + colW / 2} y={H - M.b + 16} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                  {c}
                </text>
              ) : null}
            </g>
          ))}
        </svg>

        {active !== null ? (
          <div
            role="status"
            className="bg-popover text-popover-foreground border-border pointer-events-none absolute top-2 z-10 min-w-40 rounded-lg border px-3 py-2 text-xs shadow-md"
            style={active / categories.length > 0.6 ? { right: `${(1 - colX(active) / W) * 100 + 1}%` } : { left: `${((colX(active) + colW) / W) * 100 + 1}%` }}
          >
            <div className="text-muted-foreground mb-1">{categories[active]}</div>
            {series.map((s) => {
              const v = s.values[active];
              return (
                <div key={s.key} className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <span aria-hidden className="inline-block h-0.5 w-3 rounded-full" style={{ background: s.color }} />
                    {series.length > 1 ? s.label : measure}
                  </span>
                  <span className="font-mono font-medium tabular-nums">
                    {v === null || v === undefined ? emptyText : format(v)}
                    {s.counts ? <span className="text-muted-foreground ml-1.5 font-normal">n={s.counts[active]}</span> : null}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      <details className="text-muted-foreground mt-3 text-xs">
        <summary className="hover:text-foreground cursor-pointer">Table view</summary>
        <div className="mt-2 overflow-auto rounded-md border">
          <table className="w-full">
            <caption className="sr-only">{measure}</caption>
            <thead className="bg-muted text-left">
              <tr>
                <th className="px-3 py-1.5 font-medium">Category</th>
                {series.map((s) => (
                  <th key={s.key} className="px-3 py-1.5 text-right font-medium">
                    {series.length > 1 ? s.label : measure}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categories.map((c, i) => (
                <tr key={c} className="border-t">
                  <td className="px-3 py-1">{c}</td>
                  {series.map((s) => (
                    <td key={s.key} className="px-3 py-1 text-right font-mono tabular-nums">
                      {s.values[i] === null || s.values[i] === undefined ? '—' : format(s.values[i] as number)}
                      {s.counts ? <span className="ml-1.5 font-normal opacity-70">n={s.counts[i]}</span> : null}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
