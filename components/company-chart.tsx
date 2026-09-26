'use client';

import { useState } from 'react';
import { niceTicks } from '@/components/charts/scale';
import { formatDay, formatPrice, formatUsd } from '@/lib/format';

export interface CompanyBar {
  date: string;
  close: number;
}

export interface CompanyMarker {
  date: string;
  side: 'buy' | 'sell';
  insider: string;
  shares: number;
  value: number;
}

interface Props {
  bars: CompanyBar[];
  markers: CompanyMarker[];
  label: string;
}

const W = 720;
const H = 300;
const M = { l: 56, r: 16, t: 16, b: 28 };
const PLOT_W = W - M.l - M.r;
const PLOT_H = H - M.t - M.b;

/**
 * A year of closes with insider buys (▲) and sells (▼) on the day they traded. The shape carries
 * the meaning, colour only reinforces it. Hovering snaps to a day and lists that day's trades.
 */
export function CompanyChart({ bars, markers, label }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  if (bars.length < 2) return <p className="text-muted-foreground text-sm">Not enough price history to draw a chart.</p>;

  const closes = bars.map((b) => b.close);
  const lo = Math.min(...closes);
  const hi = Math.max(...closes);
  const pad = (hi - lo || 1) * 0.08;
  const ticks = niceTicks(lo - pad, hi + pad);
  const yMin = Math.min(lo - pad, ticks[0]);
  const yMax = Math.max(hi + pad, ticks.at(-1) ?? 0);
  const x = (i: number) => M.l + (i / (bars.length - 1)) * PLOT_W;
  const y = (v: number) => M.t + (1 - (v - yMin) / (yMax - yMin)) * PLOT_H;

  // A trade on a non-trading day (or outside the bars) attaches to the nearest bar on or before it.
  const indexOnOrBefore = (date: string) => {
    let idx = -1;
    for (let i = 0; i < bars.length && bars[i].date <= date; i++) idx = i;
    return idx;
  };
  const placed = markers.flatMap((m) => {
    const i = indexOnOrBefore(m.date);
    return i === -1 ? [] : [{ ...m, i }];
  });
  const byIndex = new Map<number, typeof placed>();
  for (const p of placed) byIndex.set(p.i, [...(byIndex.get(p.i) ?? []), p]);

  const xTickIdx = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (bars.length - 1)));
  const path = bars.map((b, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(b.close).toFixed(1)}`).join('');
  const tri = (cx: number, cy: number, up: boolean) => (up ? `${cx},${cy - 6} ${cx - 5},${cy + 3} ${cx + 5},${cy + 3}` : `${cx},${cy + 6} ${cx - 5},${cy - 3} ${cx + 5},${cy - 3}`);
  const trades = hover === null ? [] : (byIndex.get(hover) ?? []);

  return (
    <figure className="m-0">
      <div className="text-muted-foreground mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-0.5 w-4 rounded-full" style={{ background: 'var(--viz-stock)' }} />
          <span className="text-foreground">{label} close</span>
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><polygon points="6,1 1,10 11,10" fill="var(--positive-fg)" /></svg>
          Insider buy
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><polygon points="6,11 1,2 11,2" fill="var(--negative-fg)" /></svg>
          Insider sell
        </span>
      </div>

      <div
        className="relative rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        tabIndex={0}
        role="group"
        aria-label={`${label} price over the last year with insider trades. Use the left and right arrow keys to read each day.`}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          setHover((cur) => Math.min(bars.length - 1, Math.max(0, (cur ?? bars.length - 1) + (e.key === 'ArrowRight' ? 1 : -1))));
        }}
        onBlur={() => setHover(null)}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full touch-pan-y"
          aria-hidden
          onPointerMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const px = ((e.clientX - rect.left) / rect.width) * W;
            setHover(Math.min(bars.length - 1, Math.max(0, Math.round(((px - M.l) / PLOT_W) * (bars.length - 1)))));
          }}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={M.l - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground text-[11px]">
                {formatPrice(t)}
              </text>
            </g>
          ))}
          {xTickIdx.map((i) => (
            <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === bars.length - 1 ? 'end' : 'middle'} className="fill-muted-foreground text-[11px]">
              {formatDay(bars[i].date)}
            </text>
          ))}
          <path d={path} fill="none" stroke="var(--viz-stock)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

          {[...byIndex.entries()].map(([i, list]) => {
            const buys = list.filter((m) => m.side === 'buy').length;
            const sells = list.length - buys;
            return (
              <g key={i}>
                {buys ? <polygon points={tri(x(i), y(bars[i].close) - 9, true)} fill="var(--positive-fg)" stroke="var(--card)" strokeWidth={2} /> : null}
                {sells ? <polygon points={tri(x(i), y(bars[i].close) + 9, false)} fill="var(--negative-fg)" stroke="var(--card)" strokeWidth={2} /> : null}
              </g>
            );
          })}

          {hover !== null ? (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={M.t} y2={H - M.b} stroke="var(--foreground)" strokeWidth={1} opacity={0.35} />
              <circle cx={x(hover)} cy={y(bars[hover].close)} r={4} fill="var(--viz-stock)" stroke="var(--card)" strokeWidth={2} />
            </g>
          ) : null}
        </svg>

        {hover !== null ? (
          <div
            role="status"
            className="bg-popover text-popover-foreground border-border pointer-events-none absolute top-2 z-10 min-w-44 max-w-72 rounded-lg border px-3 py-2 text-xs shadow-md"
            style={x(hover) / W > 0.6 ? { right: `${(1 - x(hover) / W) * 100 + 2}%` } : { left: `${(x(hover) / W) * 100 + 2}%` }}
          >
            <div className="text-muted-foreground mb-1">{formatDay(bars[hover].date)}</div>
            <div className="font-mono font-medium tabular-nums">{formatPrice(bars[hover].close)}</div>
            {trades.map((t, k) => (
              <div key={k} className="mt-1 border-t pt-1">
                <span aria-hidden>{t.side === 'buy' ? '▲' : '▼'}</span> {t.side === 'buy' ? 'Bought' : 'Sold'} by {t.insider}: {t.shares.toLocaleString('en-US', { maximumFractionDigits: 0 })} shares, {formatUsd(t.value)}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </figure>
  );
}
