import { spearman } from './stats';

// Gate 3 (spec §11): does the agent's top tier beat the baseline's? Both tiers are the top third by
// each scorer's OWN rank on the SAME signals. The agent's scores are bunched (a fixed cutoff of 70
// selects two thirds of signals), so a fixed cutoff would compare a top third against a top two thirds.
//
// The two tiers come from one set of signals and overlap heavily, and signals in the same week move
// together. So the difference in tier means is bootstrapped by resampling whole calendar weeks of the
// shared set and rebuilding BOTH tiers in every resample, which carries that dependence into the interval.

export interface Paired {
  /** Calendar-week bucket (signals in one week share market moves). */
  week: number;
  agent: number;
  baseline: number;
  /** 30-day net excess return, percent. */
  excess: number;
}

/**
 * Membership weights of the top third: a score strictly above the boundary counts fully, and a group
 * tied at the boundary shares what is left, so the tier is exactly n/3 signals whatever the ties.
 * Neutral and deterministic, unlike breaking ties by date or at random.
 */
export function topThirdWeights(scores: number[]): number[] {
  const weights = new Array<number>(scores.length).fill(0);
  let remaining = scores.length / 3;
  const order = scores.map((s, i) => [s, i] as const).sort((a, b) => b[0] - a[0]);
  for (let i = 0; i < order.length && remaining > 1e-12; ) {
    let j = i;
    while (j < order.length && order[j][0] === order[i][0]) j++;
    const size = j - i;
    const w = Math.min(1, remaining / size);
    for (let k = i; k < j; k++) weights[order[k][1]] = w;
    remaining -= w * size;
    i = j;
  }
  return weights;
}

export function weightedMean(xs: number[], ws: number[]): number {
  let num = 0;
  let den = 0;
  xs.forEach((x, i) => {
    num += x * ws[i];
    den += ws[i];
  });
  return den > 0 ? num / den : NaN;
}

export interface TierMeans {
  agent: number;
  baseline: number;
  /** Signals in each tier (n / 3). */
  tierSize: number;
}

export function tierMeans(items: Paired[]): TierMeans {
  const ex = items.map((p) => p.excess);
  return {
    agent: weightedMean(ex, topThirdWeights(items.map((p) => p.agent))),
    baseline: weightedMean(ex, topThirdWeights(items.map((p) => p.baseline))),
    tierSize: items.length / 3,
  };
}

/** Small seeded generator: the same signals always give the same interval, so the page doesn't flicker. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const GATE3_MIN_TIER = 20;
export const GATE3_BOOTSTRAPS = 2000;
export const GATE3_SEED = 20260926;
export const GATE3_ALPHA = 0.05;

export type Verdict = 'keep_agent' | 'drop_agent';

export interface HeadToHead {
  n: number;
  weeks: number;
  tierSize: number;
  agentMean: number;
  baselineMean: number;
  /** Agent tier mean minus baseline tier mean, percent points. */
  difference: number;
  /** Two-sided 95% percentile interval of the difference from the block bootstrap. */
  lo: number;
  hi: number;
  /** Rank correlation of each score with the 30-day return over ALL shared signals (supporting only). */
  spearmanAgent: number;
  spearmanBaseline: number;
  /** null while a tier has fewer than GATE3_MIN_TIER signals. */
  verdict: Verdict | null;
  reason: string;
}

/**
 * The single pre-committed rule: keep the agent only if the difference in tier means is above zero
 * with 95% confidence; anything else (no distinguishable difference, or the baseline ahead) drops it.
 * The agent costs money and adds complexity, so the burden of proof is on it. Spearman is reported
 * alongside but never decides.
 */
export function headToHead(items: Paired[], opts: { bootstraps?: number; seed?: number; alpha?: number } = {}): HeadToHead {
  const B = opts.bootstraps ?? GATE3_BOOTSTRAPS;
  const alpha = opts.alpha ?? GATE3_ALPHA;
  const observed = tierMeans(items);
  const weekKeys = [...new Set(items.map((p) => p.week))];
  const byWeek = new Map<number, Paired[]>();
  for (const p of items) byWeek.set(p.week, [...(byWeek.get(p.week) ?? []), p]);

  const rand = mulberry32(opts.seed ?? GATE3_SEED);
  const diffs: number[] = [];
  if (items.length >= 3 * GATE3_MIN_TIER && weekKeys.length >= 2) {
    for (let b = 0; b < B; b++) {
      const sample: Paired[] = [];
      for (let w = 0; w < weekKeys.length; w++) sample.push(...byWeek.get(weekKeys[Math.floor(rand() * weekKeys.length)])!);
      if (sample.length < 6) continue;
      const m = tierMeans(sample);
      const d = m.agent - m.baseline;
      if (Number.isFinite(d)) diffs.push(d);
    }
    diffs.sort((a, b) => a - b);
  }
  const at = (p: number) => diffs[Math.min(diffs.length - 1, Math.max(0, Math.floor(p * diffs.length)))];
  const lo = diffs.length ? at(alpha / 2) : NaN;
  const hi = diffs.length ? at(1 - alpha / 2) : NaN;
  const difference = observed.agent - observed.baseline;

  const excess = items.map((p) => p.excess);
  const enough = observed.tierSize >= GATE3_MIN_TIER && diffs.length > 0;
  let verdict: Verdict | null = null;
  let reason = `needs ${GATE3_MIN_TIER}+ signals per tier (${3 * GATE3_MIN_TIER}+ shared signals with complete outcomes)`;
  if (enough) {
    verdict = lo > 0 ? 'keep_agent' : 'drop_agent';
    reason = lo > 0 ? 'the agent tier beats the baseline tier with 95% confidence' : hi < 0 ? 'the baseline tier is ahead' : 'no distinguishable difference, so the burden of proof is not met';
  }
  return {
    n: items.length,
    weeks: weekKeys.length,
    tierSize: observed.tierSize,
    agentMean: observed.agent,
    baselineMean: observed.baseline,
    difference,
    lo,
    hi,
    spearmanAgent: items.length >= 3 ? spearman(items.map((p) => p.agent), excess) : NaN,
    spearmanBaseline: items.length >= 3 ? spearman(items.map((p) => p.baseline), excess) : NaN,
    verdict,
    reason,
  };
}
