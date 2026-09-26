import { formatDay, formatPct } from '@/lib/format';

/**
 * Chart formatters as plain data. Charts are client components, so a server page can't hand them
 * functions; it passes one of these instead and the chart resolves it.
 */
export type ValueFormat =
  | { kind: 'pct'; digits?: number } // value already in percent units: +2.3%
  | { kind: 'ratio' } // 0..1 shown as a whole percent: 42%
  | { kind: 'int' };

export type XFormat = 'day'; // epoch ms as "Sep 23"

export function formatValue(f: ValueFormat, v: number): string {
  switch (f.kind) {
    case 'pct':
      return formatPct(v, f.digits ?? 1);
    case 'ratio':
      return `${Math.round(v * 100)}%`;
    case 'int':
      return String(Math.round(v));
  }
}

export function formatX(f: XFormat, x: number): string {
  return formatDay(new Date(x).toISOString().slice(0, 10));
}
