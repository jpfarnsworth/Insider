const TZ = 'America/Chicago';

const dateTime = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** e.g. "Sep 23, 4:15 PM" in Central time. */
export function formatDateTime(date: Date | null | undefined): string {
  return date ? dateTime.format(date) : '—';
}

/** e.g. "1m 49s" */
export function formatDuration(start: Date, end: Date | null): string {
  if (!end) return '—';
  const s = Math.round((end.getTime() - start.getTime()) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usdPrice = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const shortDate = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });

/** Whole dollars, e.g. "$1,250,000". Accepts numeric strings from Postgres. */
export function formatUsd(v: string | number | null | undefined): string {
  return v == null ? '—' : usd.format(Number(v));
}

/** Per-share price with cents, e.g. "$15.00". */
export function formatPrice(v: string | number | null | undefined): string {
  return v == null ? '—' : usdPrice.format(Number(v));
}

export function formatNumber(v: string | number | null | undefined): string {
  return v == null ? '—' : int.format(Number(v));
}

/** A `date` column (YYYY-MM-DD) as "Sep 23". */
export function formatDay(d: string | null | undefined): string {
  return d ? shortDate.format(new Date(`${d}T00:00:00Z`)) : '—';
}

const fullDate = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });

/** A `date` column (YYYY-MM-DD) as "Sep 23, 2026". */
export function formatFullDay(d: string | null | undefined): string {
  return d ? fullDate.format(new Date(`${d}T00:00:00Z`)) : '—';
}

/** A percentage value (already in percent units) with an explicit sign and a real minus: +2.3% / −1.1%. */
export function formatPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${Math.abs(v).toFixed(digits)}%`;
}

/** A 0..1 rate as a whole percent: 0.625 -> "63%". */
export function formatRate(v: number | null | undefined): string {
  return v === null || v === undefined || Number.isNaN(v) ? '—' : `${Math.round(v * 100)}%`;
}
