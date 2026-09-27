import type { AdjBar } from '@/lib/market/returns';

// Calendar-time portfolio: every signal is held (equal weight) from its entry open for `holdDays`
// sessions, and the portfolio's daily excess return over the benchmark is the average across
// whatever is held that day. The signals-as-observations statistics treat 400+ overlapping,
// same-week, same-market signals as independent; this series is the standard fix, because the
// dependence between signals is already inside each day's number.

export interface HeldSignal {
  id: string;
  /** Adjusted bars from the entry day on, at most `holdDays` of them (fewer when data ends). */
  bars: AdjBar[];
  /** Round-trip cost, percent. Half comes off on the first day, half on the last. */
  costPct: number;
}

export interface PortfolioPoint {
  date: string;
  /** Signals held that day. */
  n: number;
  /** Equal-weight mean of the held signals' excess returns, percent. */
  excess: number;
}

/**
 * @param benchmark Every session's adjusted bar, ascending.
 * @param net Subtract each signal's round-trip cost.
 * Day 1 return is open to close (entry is the open); later days are close to close. The benchmark is
 * measured over the same days. A missing stock bar makes the next return span the gap, while the
 * benchmark still moves one day: a small mismatch on thin names, not a look-ahead.
 */
export function portfolioSeries(signals: HeldSignal[], benchmark: AdjBar[], net: boolean): PortfolioPoint[] {
  const bench = new Map<string, number>();
  benchmark.forEach((b, i) => bench.set(b.date, i === 0 ? b.adjClose / b.adjOpen - 1 : b.adjClose / benchmark[i - 1].adjClose - 1));
  const benchOpenDay = new Map(benchmark.map((b) => [b.date, b.adjClose / b.adjOpen - 1]));

  const sums = new Map<string, { total: number; n: number }>();
  for (const s of signals) {
    s.bars.forEach((b, k) => {
      const stockRet = k === 0 ? b.adjClose / b.adjOpen - 1 : b.adjClose / s.bars[k - 1].adjClose - 1;
      const benchRet = k === 0 ? benchOpenDay.get(b.date) : bench.get(b.date);
      if (benchRet === undefined || !Number.isFinite(stockRet) || !Number.isFinite(benchRet)) return;
      let excess = (stockRet - benchRet) * 100;
      if (net) {
        if (k === 0) excess -= s.costPct / 2;
        if (k === s.bars.length - 1) excess -= s.costPct / 2;
      }
      const cur = sums.get(b.date) ?? { total: 0, n: 0 };
      cur.total += excess;
      cur.n++;
      sums.set(b.date, cur);
    });
  }
  return [...sums]
    .map(([date, v]) => ({ date, n: v.n, excess: v.total / v.n }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Newey-West lag from the usual rule of thumb, floor(4 (n/100)^(2/9)). */
export const nwLag = (n: number): number => Math.max(0, Math.floor(4 * Math.pow(n / 100, 2 / 9)));

export interface PortfolioStats {
  days: number;
  meanDaily: number;
  /** Mean daily excess x 252, percent (simple, not compounded). */
  annualised: number;
  /** t-statistic of the mean daily excess with a Newey-West (Bartlett) standard error. */
  t: number;
  lag: number;
  /** Average signals held per day. */
  avgHeld: number;
}

export function portfolioStats(series: PortfolioPoint[], lag: number = nwLag(series.length)): PortfolioStats | null {
  const n = series.length;
  if (n < 2) return null;
  const x = series.map((p) => p.excess);
  const m = x.reduce((a, b) => a + b, 0) / n;
  const d = x.map((v) => v - m);
  const gamma = (j: number) => {
    let s = 0;
    for (let i = j; i < n; i++) s += d[i] * d[i - j];
    return s / n;
  };
  let variance = gamma(0);
  for (let j = 1; j <= Math.min(lag, n - 1); j++) variance += 2 * (1 - j / (lag + 1)) * gamma(j);
  const se = Math.sqrt(Math.max(variance, 0) / n);
  return {
    days: n,
    meanDaily: m,
    annualised: m * 252,
    t: se > 0 ? m / se : NaN,
    lag,
    avgHeld: series.reduce((a, p) => a + p.n, 0) / n,
  };
}

/** Running sum of daily excess, percent points (simple accumulation). */
export function cumulativeExcess(series: PortfolioPoint[]): Array<{ date: string; value: number }> {
  let total = 0;
  return series.map((p) => ({ date: p.date, value: (total += p.excess) }));
}
