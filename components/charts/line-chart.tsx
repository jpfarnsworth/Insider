'use client';

import { useState } from 'react';
import { niceTicks } from './scale';

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  /** Points ascending by x (epoch ms). */
  points: Array<{ x: number; y: number; n?: number }>;
}

interface Props {
  series: LineSeries[];
  format: (v: number) => string;
  formatX: (x: number) => string;
  measure: string;
  /** Draw a hairline at y = 0 (returns) or leave the axis to the data (rates). */
  zeroLine?: boolean;
  /** Fix the value axis (e.g. 0..1 for a hit rate). */
  domain?: [number, number];
}

const W = 720;
const H = 280;
const M = { l: 56, r: 20, t: 16, b: 28 };
const PLOT_W = W - M.l - M.r;
const PLOT_H = H - M.t - M.b;

/**
 * Time lines, 2px, with a crosshair that snaps to the nearest date and one tooltip listing every
 * series there. Empty periods are gaps, not interpolated. Values are also in the table view.
 */
export function LineChart({ series, format, formatX, measure, zeroLine = false, domain }: Props) {
  const [hover, setHover] = useState<number | null>(null);

  const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b);
  const ys = series.flatMap((s) => s.points.map((p) => p.y));
  if (!xs.length) return <p className="text-muted-foreground text-sm">Not enough data to draw this chart yet.</p>;

  const lo = domain ? domain[0] : Math.min(...ys, ...(zeroLine ? [0] : []));
  const hi = domain ? domain[1] : Math.max(...ys, ...(zeroLine ? [0] : []));
  const pad = domain ? 0 : (hi - lo || 1) * 0.08;
  const ticks = niceTicks(lo - pad, hi + pad);
  const yMin = Math.min(lo - pad, ticks[0]);
  const yMax = Math.max(hi + pad, ticks.at(-1) ?? 0);

  const xMin = xs[0];
  const xMax = xs.at(-1)!;
  const x = (v: number) => M.l + (xMax > xMin ? ((v - xMin) / (xMax - xMin)) * PLOT_W : PLOT_W / 2);
  const y = (v: number) => M.t + (1 - (v - yMin) / (yMax - yMin || 1)) * PLOT_H;

  const nearest = (clientX: number, rect: DOMRect) => {
    const px = ((clientX - rect.left) / rect.width) * W;
    let best = xs[0];
    for (const v of xs) if (Math.abs(x(v) - px) < Math.abs(x(best) - px)) best = v;
    setHover(best);
  };

  const at = (s: LineSeries, xv: number) => s.points.find((p) => p.x === xv);
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => xMin + f * (xMax - xMin));

  return (
    <figure className="m-0">
      {series.length > 1 ? (
        <div className="text-muted-foreground mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-0.5 w-4 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      ) : null}

      <div
        className="relative rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        tabIndex={0}
        role="group"
        aria-label={`${measure} over time. Use the left and right arrow keys to step through dates.`}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          setHover((cur) => {
            const i = cur === null ? xs.length - 1 : xs.indexOf(cur) + (e.key === 'ArrowRight' ? 1 : -1);
            return xs[Math.min(xs.length - 1, Math.max(0, i))];
          });
        }}
        onBlur={() => setHover(null)}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full touch-pan-y"
          aria-hidden
          onPointerMove={(e) => nearest(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={M.l - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground text-[11px]">
                {format(t)}
              </text>
            </g>
          ))}
          {zeroLine ? <line x1={M.l} x2={W - M.r} y1={y(0)} y2={y(0)} stroke="var(--muted-foreground)" strokeWidth={1} opacity={0.6} /> : null}
          {xTicks.map((t, i) => (
            <text key={t} x={x(t)} y={H - 8} textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'} className="fill-muted-foreground text-[11px]">
              {formatX(t)}
            </text>
          ))}

          {series.map((s) => (
            <path
              key={s.key}
              d={s.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join('')}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {series.map((s) => {
            const last = s.points.at(-1);
            return last ? <circle key={s.key} cx={x(last.x)} cy={y(last.y)} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} /> : null;
          })}

          {hover !== null ? (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={M.t} y2={H - M.b} stroke="var(--foreground)" strokeWidth={1} opacity={0.35} />
              {series.map((s) => {
                const p = at(s, hover);
                return p ? <circle key={s.key} cx={x(hover)} cy={y(p.y)} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} /> : null;
              })}
            </g>
          ) : null}
        </svg>

        {hover !== null ? (
          <div
            role="status"
            className="bg-popover text-popover-foreground border-border pointer-events-none absolute top-2 z-10 min-w-40 rounded-lg border px-3 py-2 text-xs shadow-md"
            style={x(hover) / W > 0.6 ? { right: `${(1 - x(hover) / W) * 100 + 2}%` } : { left: `${(x(hover) / W) * 100 + 2}%` }}
          >
            <div className="text-muted-foreground mb-1">{formatX(hover)}</div>
            {series.map((s) => {
              const p = at(s, hover);
              return (
                <div key={s.key} className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <span aria-hidden className="inline-block h-0.5 w-3 rounded-full" style={{ background: s.color }} />
                    {series.length > 1 ? s.label : measure}
                  </span>
                  <span className="font-mono font-medium tabular-nums">
                    {p ? format(p.y) : '—'}
                    {p?.n !== undefined ? <span className="text-muted-foreground ml-1.5 font-normal">n={p.n}</span> : null}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      <details className="text-muted-foreground mt-3 text-xs">
        <summary className="hover:text-foreground cursor-pointer">Table view</summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-md border">
          <table className="w-full">
            <caption className="sr-only">{measure}</caption>
            <thead className="bg-muted sticky top-0 text-left">
              <tr>
                <th className="px-3 py-1.5 font-medium">Date</th>
                {series.map((s) => (
                  <th key={s.key} className="px-3 py-1.5 text-right font-medium">
                    {series.length > 1 ? s.label : measure}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {xs.map((xv) => (
                <tr key={xv} className="border-t">
                  <td className="px-3 py-1">{formatX(xv)}</td>
                  {series.map((s) => {
                    const p = at(s, xv);
                    return (
                      <td key={s.key} className="px-3 py-1 text-right font-mono tabular-nums">
                        {p ? format(p.y) : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
