import { excessAt, tiersFor, type SignalFact, type ViewOptions } from './facts';
import { cumulative, MIN_N, spearman, summarize, type Summary } from './stats';

const DAY = 86_400_000;

export interface Kpis {
  newSignals7d: number;
  newSignals30d: number;
  activeClusters: number;
  complete30d: number;
  /** 30-day excess over the benchmark across completed signals, or null below MIN_N. */
  meanExcess30d: number | null;
  hitRate30d: number | null;
  /** Spearman rank correlation of the two scores, with the number of signals scored by both. */
  agentBaselineCorrelation: { r: number; n: number } | null;
}

/** Headline numbers (spec §9.2). `now` and the view are explicit so this stays testable. */
export function computeKpis(facts: SignalFact[], view: ViewOptions, now: number, activeClusters: number): Kpis {
  const s = summarize(facts.flatMap((f) => (excessAt(f, 30, view) === null ? [] : [excessAt(f, 30, view) as number])));
  const both = facts.filter((f) => f.agentScore !== null && f.baselineScore !== null);
  const r = both.length >= MIN_N ? spearman(both.map((f) => f.agentScore as number), both.map((f) => f.baselineScore as number)) : NaN;
  return {
    newSignals7d: facts.filter((f) => f.signalAt > now - 7 * DAY).length,
    newSignals30d: facts.filter((f) => f.signalAt > now - 30 * DAY).length,
    activeClusters,
    complete30d: s.n,
    meanExcess30d: s.sufficient ? s.mean : null,
    hitRate30d: s.sufficient ? s.hitRate : null,
    agentBaselineCorrelation: Number.isNaN(r) ? null : { r, n: both.length },
  };
}

export interface TierLine {
  key: 'agent' | 'baseline' | 'all';
  label: string;
  points: Array<{ x: number; y: number; n: number }>;
}

/**
 * Cumulative 30-day excess return of equal-weight hypothetical portfolios: each signal is one
 * equal-size position whose result lands on its exit date, so a line is the running sum of those
 * excess returns. Tiers per spec §11: agent >= 70, baseline top third, and every signal.
 */
export function cumulativeByTier(facts: SignalFact[], view: ViewOptions): TierLine[] {
  const tiers = tiersFor(facts);
  const at = (f: SignalFact) => {
    const exit = f.outcomes[30]?.[view.bench]?.exitDate;
    const v = excessAt(f, 30, view);
    return exit && v !== null ? { at: Date.parse(`${exit}T00:00:00Z`), value: v } : null;
  };
  const line = (key: TierLine['key'], label: string, keep: (f: SignalFact) => boolean): TierLine => ({
    key,
    label,
    points: cumulative(facts.filter(keep).flatMap((f) => at(f) ?? [])).map((p) => ({ x: p.at, y: p.total, n: p.n })),
  });
  return [
    line('agent', 'Agent score ≥ 70', tiers.isAgentTop),
    line('baseline', 'Baseline top third', tiers.isBaselineTop),
    line('all', 'All signals', () => true),
  ].filter((l) => l.points.length > 0);
}

export const HORIZON_LIST = [5, 10, 30, 60, 90] as const;

export interface HorizonMeans {
  key: 'all' | 'baseline' | 'agent';
  label: string;
  /** Mean excess per horizon, null where there are fewer than MIN_N completed outcomes. */
  means: (number | null)[];
  counts: number[];
}

/** Average excess by horizon for all signals, the baseline top tier and high-conviction agent calls. */
export function meansByHorizon(facts: SignalFact[], view: ViewOptions): HorizonMeans[] {
  const tiers = tiersFor(facts);
  const group = (key: HorizonMeans['key'], label: string, keep: (f: SignalFact) => boolean): HorizonMeans => {
    const sums: Summary[] = HORIZON_LIST.map((h) => summarize(facts.filter(keep).flatMap((f) => excessAt(f, h, view) ?? [])));
    return { key, label, means: sums.map((s) => (s.sufficient ? s.mean : null)), counts: sums.map((s) => s.n) };
  };
  return [
    group('all', 'All signals', () => true),
    group('baseline', 'Baseline top tier', tiers.isBaselineTop),
    group('agent', 'Agent high conviction', (f) => f.conviction === 'high'),
  ];
}
