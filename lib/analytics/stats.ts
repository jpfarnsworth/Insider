// Statistics for the Performance page and evaluation gates (spec §9.7, §11). Pure, so the
// numbers that decide whether paper trading gets built are covered by tests.

/** Buckets with fewer observations than this show "insufficient data" instead of numbers (spec §9.7). */
export const MIN_N = 20;

export const mean = (xs: number[]): number => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Sample standard deviation (n - 1). */
export function stdev(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

export interface Summary {
  n: number;
  mean: number;
  median: number;
  /** Share of observations above zero (beat the benchmark), 0..1. */
  hitRate: number;
  /** One-sample t statistic of the mean against zero. */
  tStat: number;
  /** False below MIN_N: callers show "insufficient data". */
  sufficient: boolean;
}

export function summarize(xs: number[], minN: number = MIN_N): Summary {
  const n = xs.length;
  const sd = stdev(xs);
  return {
    n,
    mean: mean(xs),
    median: median(xs),
    hitRate: n ? xs.filter((x) => x > 0).length / n : NaN,
    // A zero spread (all values equal) has no defined t; treat as not computable.
    tStat: sd > 0 ? mean(xs) / (sd / Math.sqrt(n)) : NaN,
    sufficient: n >= minN,
  };
}

/** Pearson correlation; NaN when either side has no spread or there are fewer than 3 pairs. */
export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return NaN;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
}

/** Average ranks (ties share the mean rank), the input to Spearman. */
export function ranks(xs: number[]): number[] {
  const order = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k][1]] = avg;
    i = j + 1;
  }
  return out;
}

/** Rank correlation: robust to the clumping of LLM scores on round numbers. */
export const spearman = (xs: number[], ys: number[]): number => pearson(ranks(xs), ranks(ys));

/**
 * The score at or above which a value is in the top third. Ties at the boundary are
 * included, so a clump of equal scores is never split arbitrarily.
 */
export function topThirdThreshold(scores: number[]): number {
  if (!scores.length) return NaN;
  const desc = [...scores].sort((a, b) => b - a);
  return desc[Math.ceil(desc.length / 3) - 1];
}

export interface Bin {
  from: number;
  to: number;
  count: number;
}

/**
 * Histogram with fixed-width bins covering [min, max); values outside are clamped into the
 * first or last bin so no observation silently disappears.
 */
export function histogram(xs: number[], min: number, max: number, width: number): Bin[] {
  const bins: Bin[] = [];
  for (let from = min; from < max; from += width) bins.push({ from, to: from + width, count: 0 });
  for (const x of xs) {
    const i = Math.min(bins.length - 1, Math.max(0, Math.floor((x - min) / width)));
    bins[i].count++;
  }
  return bins;
}

/** A 10-point band of a 0-100 score, e.g. 73 -> "70-79" (100 joins "90-100"). */
export function scoreBand(score: number): string {
  const lo = Math.min(90, Math.floor(score / 10) * 10);
  return lo === 90 ? '90-100' : `${lo}-${lo + 9}`;
}

export const SCORE_BANDS = ['0-9', '10-19', '20-29', '30-39', '40-49', '50-59', '60-69', '70-79', '80-89', '90-100'] as const;

export interface Dated {
  at: number;
  value: number;
}

/**
 * Hit rate over a trailing window, sampled at each step. `at` is when the signal fired; a point is
 * only produced when the window holds at least `minN` observations.
 */
export function rollingHitRate(
  items: Dated[],
  opts: { windowDays: number; stepDays: number; minN: number },
): Array<{ at: number; hitRate: number; n: number }> {
  if (!items.length) return [];
  const DAY = 86_400_000;
  const sorted = [...items].sort((a, b) => a.at - b.at);
  const out: Array<{ at: number; hitRate: number; n: number }> = [];
  for (let t = sorted[0].at + opts.windowDays * DAY; t <= sorted[sorted.length - 1].at + opts.stepDays * DAY; t += opts.stepDays * DAY) {
    const inWindow = sorted.filter((i) => i.at > t - opts.windowDays * DAY && i.at <= t);
    if (inWindow.length >= opts.minN) out.push({ at: t, hitRate: inWindow.filter((i) => i.value > 0).length / inWindow.length, n: inWindow.length });
  }
  return out;
}

/** Running total of values ordered by time (each observation is one equal-weight unit). */
export function cumulative(items: Dated[]): Array<{ at: number; total: number; n: number }> {
  let total = 0;
  return [...items]
    .sort((a, b) => a.at - b.at)
    .map((i, k) => ({ at: i.at, total: (total += i.value), n: k + 1 }));
}
