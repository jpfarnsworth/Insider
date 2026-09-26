'use client';

import { useState } from 'react';
import type { ChartPoint } from '@/lib/market/chart';
import { formatDay } from '@/lib/format';
import { niceTicks } from '@/components/charts/scale';

interface Props {
  points: ChartPoint[];
  entryIndex: number;
  stockLabel: string;
  benchLabel: string;
}

const W = 720;
const H = 300;
const M = { l: 52, r: 64, t: 20, b: 28 };
const PLOT_W = W - M.l - M.r;
const PLOT_H = H - M.t - M.b;

const ret = (v: number) => v - 100;
const signed = (v: number, digits = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}%`;

function path(points: ChartPoint[], key: 'stock' | 'bench', x: (i: number) => number, y: (v: number) => number) {
  let d = '';
  let pen = false; // a null starts a new segment, so a missing day is a gap, not a fake line
  points.forEach((p, i) => {
    const v = p[key];
    if (v === null) {
      pen = false;
      return;
    }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(ret(v)).toFixed(1)}`;
    pen = true;
  });
  return d;
}

export function PriceChart({ points, entryIndex, stockLabel, benchLabel }: Props) {
  const [hover, setHover] = useState<number | null>(null);

  const values = points.flatMap((p) => [p.stock, p.bench]).filter((v): v is number => v !== null).map(ret);
  const lo = Math.min(...values, 0);
  const hi = Math.max(...values, 0);
  const pad = Math.max((hi - lo) * 0.08, 1);
  const yMin = lo - pad;
  const yMax = hi + pad;

  const x = (i: number) => M.l + (points.length > 1 ? (i / (points.length - 1)) * PLOT_W : 0);
  const y = (v: number) => M.t + (1 - (v - yMin) / (yMax - yMin)) * PLOT_H;

  const yTicks = niceTicks(yMin, yMax);
  const xTickIdx = Array.from(new Set([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (points.length - 1)))));

  const lastOf = (key: 'stock' | 'bench') => {
    for (let i = points.length - 1; i >= 0; i--) if (points[i][key] !== null) return i;
    return -1;
  };
  const stockEnd = lastOf('stock');
  const benchEnd = lastOf('bench');
  const endY = (key: 'stock' | 'bench', i: number) => y(ret(points[i][key] as number));
  // Two end labels that would touch: keep the stock's; the legend and tooltip carry the other.
  const showBenchEnd = benchEnd >= 0 && (stockEnd < 0 || Math.abs(endY('bench', benchEnd) - endY('stock', stockEnd)) > 14);

  const move = (clientX: number, rect: DOMRect) => {
    const px = ((clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - M.l) / PLOT_W) * (points.length - 1));
    setHover(Math.min(points.length - 1, Math.max(0, i)));
  };

  const h = hover === null ? null : points[hover];
  const alignRight = hover !== null && x(hover) / W > 0.6;

  return (
    <figure className="m-0">
      <div className="text-muted-foreground mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-0.5 w-4 rounded-full" style={{ background: 'var(--viz-stock)' }} />
          <span className="text-foreground">{stockLabel}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-0.5 w-4 rounded-full" style={{ background: 'var(--viz-bench)' }} />
          {benchLabel}
        </span>
        <span>Return since the entry open</span>
      </div>

      <div
        className="relative rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        tabIndex={0}
        role="group"
        aria-label={`${stockLabel} versus ${benchLabel}, return since entry. Use the left and right arrow keys to read each day.`}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          setHover((cur) => Math.min(points.length - 1, Math.max(0, (cur ?? entryIndex) + (e.key === 'ArrowRight' ? 1 : -1))));
        }}
        onBlur={() => setHover(null)}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full touch-pan-y"
          aria-hidden
          onPointerMove={(e) => move(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setHover(null)}
        >
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={M.l - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground text-[11px]">
                {signed(t, 0).replace('+0%', '0%').replace('−0%', '0%')}
              </text>
            </g>
          ))}
          {xTickIdx.map((i) => (
            <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'} className="fill-muted-foreground text-[11px]">
              {formatDay(points[i].date)}
            </text>
          ))}

          <line x1={x(entryIndex)} x2={x(entryIndex)} y1={M.t} y2={H - M.b} stroke="var(--muted-foreground)" strokeWidth={1} opacity={0.5} />
          <text x={x(entryIndex) + 5} y={M.t + 8} className="fill-muted-foreground text-[11px]">
            Entry
          </text>

          <path d={path(points, 'bench', x, y)} fill="none" stroke="var(--viz-bench)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <path d={path(points, 'stock', x, y)} fill="none" stroke="var(--viz-stock)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

          {benchEnd >= 0 ? <circle cx={x(benchEnd)} cy={endY('bench', benchEnd)} r={4} fill="var(--viz-bench)" stroke="var(--card)" strokeWidth={2} /> : null}
          {stockEnd >= 0 ? <circle cx={x(stockEnd)} cy={endY('stock', stockEnd)} r={4} fill="var(--viz-stock)" stroke="var(--card)" strokeWidth={2} /> : null}
          {stockEnd >= 0 ? (
            <text x={x(stockEnd) + 10} y={endY('stock', stockEnd)} dominantBaseline="middle" className="fill-foreground text-[12px] font-medium">
              {signed(ret(points[stockEnd].stock as number))}
            </text>
          ) : null}
          {showBenchEnd ? (
            <text x={x(benchEnd) + 10} y={endY('bench', benchEnd)} dominantBaseline="middle" className="fill-muted-foreground text-[12px]">
              {signed(ret(points[benchEnd].bench as number))}
            </text>
          ) : null}

          {hover !== null ? (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={M.t} y2={H - M.b} stroke="var(--foreground)" strokeWidth={1} opacity={0.35} />
              {(['bench', 'stock'] as const).map((k) =>
                points[hover][k] === null ? null : (
                  <circle key={k} cx={x(hover)} cy={y(ret(points[hover][k] as number))} r={4} fill={`var(--viz-${k})`} stroke="var(--card)" strokeWidth={2} />
                ),
              )}
            </g>
          ) : null}
          <rect x={M.l} y={M.t} width={PLOT_W} height={PLOT_H} fill="transparent" />
        </svg>

        {h && hover !== null ? (
          <div
            role="status"
            className="bg-popover text-popover-foreground border-border pointer-events-none absolute top-2 z-10 min-w-36 rounded-lg border px-3 py-2 text-xs shadow-md"
            style={alignRight ? { right: `${(1 - x(hover) / W) * 100 + 2}%` } : { left: `${(x(hover) / W) * 100 + 2}%` }}
          >
            <div className="text-muted-foreground mb-1">{formatDay(h.date)}</div>
            {(
              [
                ['stock', stockLabel],
                ['bench', benchLabel],
              ] as const
            ).map(([k, label]) => (
              <div key={k} className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <span aria-hidden className="inline-block h-0.5 w-3 rounded-full" style={{ background: `var(--viz-${k})` }} />
                  {label}
                </span>
                <span className="font-mono font-medium tabular-nums">{h[k] === null ? 'no trades' : signed(ret(h[k] as number), 2)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <details className="text-muted-foreground mt-3 text-xs">
        <summary className="hover:text-foreground cursor-pointer">Table view</summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-md border">
          <table className="w-full">
            <thead className="bg-muted sticky top-0 text-left">
              <tr>
                <th className="px-3 py-1.5 font-medium">Date</th>
                <th className="px-3 py-1.5 text-right font-medium">{stockLabel}</th>
                <th className="px-3 py-1.5 text-right font-medium">{benchLabel}</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.date} className="border-t">
                  <td className="px-3 py-1">{formatDay(p.date)}</td>
                  <td className="px-3 py-1 text-right font-mono tabular-nums">{p.stock === null ? '—' : signed(ret(p.stock), 2)}</td>
                  <td className="px-3 py-1 text-right font-mono tabular-nums">{p.bench === null ? '—' : signed(ret(p.bench), 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
