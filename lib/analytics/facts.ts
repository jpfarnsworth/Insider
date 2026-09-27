import { roundTripCostPct, type Costs } from '@/lib/market/costs';
import { scoreBand, summarize, topThirdThreshold, type Summary } from './stats';

export type Bench = 'SPY' | 'IWM';
export type Conviction = 'low' | 'medium' | 'high';
export type RoleMix = 'ceo_cfo' | 'other_officer' | 'director' | 'other';

export interface OutcomeFact {
  status: 'pending' | 'complete' | 'data_ended';
  /** Percent, gross. */
  returnPct: number | null;
  /** Percent: stock return minus the benchmark's over the same dates, gross. */
  excessPct: number | null;
  benchmarkReturnPct: number | null;
  maxDrawdownPct: number | null;
  exitDate: string | null;
}

/** One signal with everything the analytics need, read once from the database. */
export interface SignalFact {
  id: string;
  ticker: string | null;
  issuer: string;
  signalAt: number;
  baselineScore: number | null;
  agentScore: number | null;
  conviction: Conviction | null;
  insiderCount: number;
  totalValue: number;
  marketCap: number | null;
  industry: string | null;
  roleMix: RoleMix;
  /** After the agent model's training cutoff, so it counts toward the evaluation gates. */
  postCutoff: boolean;
  avgDollarVolume: number | null;
  status: 'active' | 'amended' | 'data_ended' | 'superseded';
  /** Descriptive tags (see lib/clusters/tags.ts), e.g. 'single_day_single_price'. */
  tags: string[];
  /** In the holdout window and still frozen: its outcomes are withheld (empty). */
  holdout: boolean;
  /** On or after the holdout start date, whether or not it has been revealed. Gate 3's official verdict uses only these. */
  holdoutWindow: boolean;
  /** horizon (trading days) -> benchmark -> outcome. */
  outcomes: Record<number, Partial<Record<Bench, OutcomeFact>>>;
}

export interface ViewOptions {
  bench: Bench;
  /** Subtract the estimated round-trip cost from each return. */
  net: boolean;
  /** 'post' (the default) keeps only signals after the model's training cutoff. */
  scope: 'post' | 'all';
  costs: Costs;
}

export const inScope = (f: SignalFact, o: Pick<ViewOptions, 'scope'>) => o.scope === 'all' || f.postCutoff;

/**
 * Excess return (percent) at a horizon over the chosen benchmark, or null unless the outcome is
 * complete. Net of costs means the stock's return after the round-trip cost, minus the
 * benchmark's: excess - cost. Pending and data_ended outcomes are never counted.
 */
export function excessAt(f: SignalFact, horizon: number, o: ViewOptions): number | null {
  const out = f.outcomes[horizon]?.[o.bench];
  if (!out || out.status !== 'complete' || out.excessPct === null) return null;
  return o.net ? out.excessPct - roundTripCostPct(f.avgDollarVolume, o.costs) : out.excessPct;
}

/** Excess returns at a horizon for the given signals, dropping those without a complete outcome. */
export const excessValues = (facts: SignalFact[], horizon: number, o: ViewOptions): number[] =>
  facts.map((f) => excessAt(f, horizon, o)).filter((x): x is number => x !== null);

export const summaryAt = (facts: SignalFact[], horizon: number, o: ViewOptions): Summary => summarize(excessValues(facts, horizon, o));

// --- Tiers -------------------------------------------------------------------

export const AGENT_TOP_TIER_SCORE = 70;

export interface Tiers {
  baselineThreshold: number;
  isBaselineTop: (f: SignalFact) => boolean;
  isAgentTop: (f: SignalFact) => boolean;
  /** Spec §11 gate 2: agent >= 70 or baseline top third. */
  isTop: (f: SignalFact) => boolean;
}

/** Tier definitions over a population (the baseline top third is relative to that population). */
export function tiersFor(population: SignalFact[]): Tiers {
  const baselineThreshold = topThirdThreshold(population.flatMap((f) => (f.baselineScore === null ? [] : [f.baselineScore])));
  const isBaselineTop = (f: SignalFact) => f.baselineScore !== null && f.baselineScore >= baselineThreshold;
  const isAgentTop = (f: SignalFact) => f.agentScore !== null && f.agentScore >= AGENT_TOP_TIER_SCORE;
  return { baselineThreshold, isBaselineTop, isAgentTop, isTop: (f) => isBaselineTop(f) || isAgentTop(f) };
}

// --- Buckets -----------------------------------------------------------------

export const capBucket = (cap: number | null): string =>
  cap === null ? 'Unknown' : cap < 300e6 ? 'Micro (< $300M)' : cap < 2e9 ? 'Small ($300M-2B)' : cap < 10e9 ? 'Mid ($2B-10B)' : 'Large (> $10B)';

export const CAP_BUCKETS = ['Micro (< $300M)', 'Small ($300M-2B)', 'Mid ($2B-10B)', 'Large (> $10B)', 'Unknown'] as const;

export const clusterSizeBucket = (n: number): string => (n <= 3 ? '3 insiders' : n === 4 ? '4 insiders' : n <= 6 ? '5-6 insiders' : '7+ insiders');
export const CLUSTER_SIZES = ['3 insiders', '4 insiders', '5-6 insiders', '7+ insiders'] as const;

export const ROLE_MIX_LABEL: Record<RoleMix, string> = {
  ceo_cfo: 'CEO or CFO involved',
  other_officer: 'Other officers',
  director: 'Directors only',
  other: 'Other',
};

export const bandOf = (score: number | null): string | null => (score === null ? null : scoreBand(score));

export interface BucketRow {
  key: string;
  summary: Summary;
}

/**
 * Summary of a horizon's excess returns per bucket, in the order given. Buckets with no completed
 * outcome are omitted (a table of zeros says nothing); buckets with a few are kept and flagged
 * insufficient by their summary.
 */
export function bucketSummaries(
  facts: SignalFact[],
  key: (f: SignalFact) => string | null,
  order: readonly string[] | null,
  horizon: number,
  o: ViewOptions,
): BucketRow[] {
  const groups = new Map<string, SignalFact[]>();
  for (const f of facts) {
    const k = key(f);
    if (k !== null) groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  const keys = order ? order.filter((k) => groups.has(k)) : [...groups.keys()].sort();
  return keys.map((k) => ({ key: k, summary: summaryAt(groups.get(k)!, horizon, o) })).filter((r) => r.summary.n > 0);
}

// --- Conviction calibration ---------------------------------------------------

/** Realised 30-day hit rate by the agent's stated conviction (spec §9.7 calibration chart). */
export function calibration(facts: SignalFact[], o: ViewOptions, horizon = 30): BucketRow[] {
  return bucketSummaries(facts, (f) => f.conviction, ['low', 'medium', 'high'], horizon, o);
}
