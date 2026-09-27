import { excessAt, type SignalFact, type ViewOptions } from './facts';
import { mulberry32, topThirdWeights, weightedMean } from './head-to-head';
import { spearman } from './stats';
import { OFFERING_LIKE } from '@/lib/clusters/tags';

// Pre-registered holdout tests (docs/preregistration.md, registered 2026-09-27, before any holdout
// return existed). The constants here ARE the registration: changing one is a new registration, not a
// tweak. Each test is evaluated ONCE, at its fixed size, on holdout-window signals only, with the
// 30-day net excess return vs SPY, and a weekly-block bootstrap (whole calendar weeks are resampled,
// because signals in a week move together).
export const PREREG = {
  registered: '2026-09-27',
  bootstraps: 2000,
  /** H1 / gate 2: minimum holdout signals with a complete outcome (baseline top third; no agent dependency). */
  h1Signals: 90,
  /** H2 / gate 3: the earliest N holdout signals scored by both with a complete outcome. */
  h2Signals: 300,
  /** H3: minimum tagged holdout signals with a complete outcome. */
  h3Tagged: 30,
  /** One-sided level for all three. */
  alpha: 0.05,
  seeds: { h1: 20260927, h2: 20260928, h3: 20260929 },
} as const;

const WEEK_MS = 7 * 86_400_000;

export interface PreregRow {
  week: number;
  at: number;
  agent: number | null;
  baseline: number | null;
  excess: number;
  tagged: boolean;
}

/** Signals with a complete 30-day outcome, from the given facts. */
export function preregRows(facts: SignalFact[], view: ViewOptions): PreregRow[] {
  return facts.flatMap((f) => {
    const excess = excessAt(f, 30, view);
    return excess === null
      ? []
      : [{ week: Math.floor(f.signalAt / WEEK_MS), at: f.signalAt, agent: f.agentScore, baseline: f.baselineScore, excess, tagged: f.tags.includes(OFFERING_LIKE) }];
  });
}

export const quantile = (sorted: number[], p: number): number => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))] : NaN);

/** Resamples whole weeks with replacement and returns the sorted bootstrap distribution of `stat`. */
export function blockBootstrap<T extends { week: number }>(items: T[], stat: (sample: T[]) => number, B: number, seed: number): number[] {
  const byWeek = new Map<number, T[]>();
  for (const it of items) byWeek.set(it.week, [...(byWeek.get(it.week) ?? []), it]);
  const keys = [...byWeek.keys()];
  if (keys.length < 2) return [];
  const rand = mulberry32(seed);
  const out: number[] = [];
  for (let b = 0; b < B; b++) {
    const sample: T[] = [];
    for (let i = 0; i < keys.length; i++) sample.push(...byWeek.get(keys[Math.floor(rand() * keys.length)])!);
    const v = stat(sample);
    if (Number.isFinite(v)) out.push(v);
  }
  return out.sort((a, b) => a - b);
}

// --- Statistics ---------------------------------------------------------------

/**
 * H1 statistic: mean excess of the baseline's top third (rank-based, tie-weighted). Deliberately does
 * NOT touch the agent's score: the baseline scores every signal as soon as it's created, so H1 keeps
 * filling up even if agent scoring stalls (a lapsed key, a quota, a code change). H2 is the only test
 * that needs both scorers. (Deviation, docs/preregistration.md: H1 was originally defined as the union
 * of each scorer's top third, on signals scored by both, which made it depend on the agent for no
 * reason -- fixed 2026-09-27, before any holdout signal existed.)
 */
export function topTierMean(rows: PreregRow[]): number {
  const withBaseline = rows.filter((r) => r.baseline !== null);
  return weightedMean(withBaseline.map((r) => r.excess), topThirdWeights(withBaseline.map((r) => r.baseline as number)));
}

/** H2 statistic: agent rank correlation with the 30-day return minus the baseline's. */
export function rankCorrelationDifference(rows: PreregRow[]): number {
  const both = rows.filter((r) => r.agent !== null && r.baseline !== null);
  if (both.length < 3) return NaN;
  const ex = both.map((r) => r.excess);
  return spearman(both.map((r) => r.agent as number), ex) - spearman(both.map((r) => r.baseline as number), ex);
}

/** H3 statistic: mean excess of offering-like signals minus the rest. */
export function offeringGap(rows: PreregRow[]): number {
  const a = rows.filter((r) => r.tagged).map((r) => r.excess);
  const b = rows.filter((r) => !r.tagged).map((r) => r.excess);
  return a.length && b.length ? a.reduce((x, y) => x + y, 0) / a.length - b.reduce((x, y) => x + y, 0) / b.length : NaN;
}

// --- Results ------------------------------------------------------------------

export type PreregStatus = 'awaiting' | 'supported' | 'not_supported';

export interface PreregResult {
  id: 'H1' | 'H2' | 'H3';
  title: string;
  status: PreregStatus;
  /** What has accumulated against the fixed target. */
  progress: string;
  /** The estimate and its interval when there is enough data. */
  detail: string;
  estimate: number | null;
  lo: number | null;
  hi: number | null;
}

const fmt = (x: number, d = 2) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(d)}`;

interface Spec {
  id: PreregResult['id'];
  title: string;
  stat: (rows: PreregRow[]) => number;
  seed: number;
  /** 'greater': supported if the lower one-sided bound is above 0. 'less': supported if the upper bound is below 0. */
  direction: 'greater' | 'less';
  digits: number;
  /** Rows to test, or null while the target is not reached. */
  select: (rows: PreregRow[]) => { rows: PreregRow[]; progress: string } | { rows: null; progress: string };
}

const SPECS: Spec[] = [
  {
    id: 'H1',
    title: "The baseline's top-tier signals have a positive average 30-day excess return (gate 2)",
    stat: topTierMean,
    seed: PREREG.seeds.h1,
    direction: 'greater',
    digits: 2,
    // Every holdout signal with a matured outcome: no dependency on the agent (see topTierMean).
    select: (rows) => {
      const withBaseline = rows.filter((r) => r.baseline !== null);
      return withBaseline.length >= PREREG.h1Signals
        ? { rows: withBaseline, progress: `${withBaseline.length} of ${PREREG.h1Signals}` }
        : { rows: null, progress: `${withBaseline.length} of ${PREREG.h1Signals}` };
    },
  },
  {
    id: 'H2',
    title: "The agent's rank correlation with the 30-day return exceeds the baseline's (gate 3: promote the agent)",
    stat: rankCorrelationDifference,
    seed: PREREG.seeds.h2,
    direction: 'greater',
    digits: 3,
    select: (rows) => {
      const both = rows.filter((r) => r.agent !== null && r.baseline !== null).sort((a, b) => a.at - b.at);
      return both.length >= PREREG.h2Signals
        ? { rows: both.slice(0, PREREG.h2Signals), progress: `${both.length} of ${PREREG.h2Signals}` }
        : { rows: null, progress: `${both.length} of ${PREREG.h2Signals}` };
    },
  },
  {
    id: 'H3',
    title: 'Offering-like clusters (one day, one price) underperform the rest',
    stat: offeringGap,
    seed: PREREG.seeds.h3,
    direction: 'less',
    digits: 2,
    select: (rows) => {
      const tagged = rows.filter((r) => r.tagged).length;
      return tagged >= PREREG.h3Tagged ? { rows, progress: `${tagged} tagged of ${PREREG.h3Tagged} (${rows.length} signals)` } : { rows: null, progress: `${tagged} tagged of ${PREREG.h3Tagged} (${rows.length} signals)` };
    },
  },
];

/**
 * Evaluates one pre-registered test on the given rows (the holdout window's completed signals, or the
 * design set for an interim look). `official` uses the registered bootstrap count; the interim uses fewer
 * and must always be labelled as not evidence.
 */
export function runPrereg(id: PreregResult['id'], rows: PreregRow[], bootstraps: number = PREREG.bootstraps): PreregResult {
  const spec = SPECS.find((s) => s.id === id)!;
  const chosen = spec.select(rows);
  const base = { id: spec.id, title: spec.title, progress: chosen.progress, estimate: null, lo: null, hi: null };
  if (!chosen.rows) return { ...base, status: 'awaiting', detail: `Awaiting the registered sample size (${chosen.progress}).` };

  const dist = blockBootstrap(chosen.rows, spec.stat, bootstraps, spec.seed);
  if (!dist.length) return { ...base, status: 'awaiting', detail: 'Too few distinct weeks to resample.' };
  const estimate = spec.stat(chosen.rows);
  const lo = quantile(dist, PREREG.alpha);
  const hi = quantile(dist, 1 - PREREG.alpha);
  const supported = spec.direction === 'greater' ? lo > 0 : hi < 0;
  return {
    ...base,
    status: supported ? 'supported' : 'not_supported',
    estimate,
    lo,
    hi,
    detail: `${fmt(estimate, spec.digits)} (90% interval ${fmt(lo, spec.digits)} to ${fmt(hi, spec.digits)}; the one-sided test ${supported ? 'clears' : 'does not clear'} zero).`,
  };
}

/** The three registered tests, official on the holdout window. */
export function evaluatePrereg(facts: SignalFact[], view: ViewOptions): PreregResult[] {
  const rows = preregRows(facts.filter((f) => f.holdoutWindow), view);
  return (['H1', 'H2', 'H3'] as const).map((id) => runPrereg(id, rows));
}

/** The same tests on the design set: descriptive only, never evidence (the rules were chosen after seeing it). */
export function interimPrereg(facts: SignalFact[], view: ViewOptions, bootstraps = 500): PreregResult[] {
  const rows = preregRows(facts.filter((f) => !f.holdoutWindow), view);
  return (['H1', 'H2', 'H3'] as const).map((id) => {
    // Interim ignores the fixed-size gate: it reports whatever the design set gives.
    const spec = SPECS.find((s) => s.id === id)!;
    const usable = id === 'H1' ? rows.filter((r) => r.baseline !== null) : id === 'H3' ? rows : rows.filter((r) => r.agent !== null && r.baseline !== null);
    const dist = blockBootstrap(usable, spec.stat, bootstraps, spec.seed);
    if (!dist.length) return { id, title: spec.title, status: 'awaiting' as const, progress: `${usable.length} design-set signals`, detail: 'Too little data.', estimate: null, lo: null, hi: null };
    const estimate = spec.stat(usable);
    const lo = quantile(dist, PREREG.alpha);
    const hi = quantile(dist, 1 - PREREG.alpha);
    return {
      id,
      title: spec.title,
      status: 'awaiting' as const, // an interim result never counts
      progress: `${usable.length} design-set signals`,
      detail: `${fmt(estimate, spec.digits)} (90% interval ${fmt(lo, spec.digits)} to ${fmt(hi, spec.digits)}).`,
      estimate,
      lo,
      hi,
    };
  });
}

// --- Reveal gating (docs/preregistration.md: "the reveal is locked until all three have run, or you
// record a decision to abandon the unfinished ones") -------------------------------------------------

export const MIN_ABANDON_REASON_LENGTH = 20;

export interface RevealCheck {
  ok: boolean;
  /** Test ids that have not yet reached their registered sample size. */
  pending: PreregResult['id'][];
  error?: string;
}

/**
 * Whether the holdout may be revealed right now. Each test shows its own result automatically once it
 * reaches its registered size, with no reveal needed -- reveal only lifts the mask on individual
 * holdout signals (their own pages, lists, CSV, MCP). Revealing early is allowed only with a written
 * reason of some substance, so it is a deliberate, recorded decision, not a stray checkbox.
 */
export function canReveal(results: PreregResult[], abandonReason: string | null): RevealCheck {
  const pending = results.filter((r) => r.status === 'awaiting').map((r) => r.id);
  if (pending.length === 0) return { ok: true, pending };
  if (abandonReason && abandonReason.trim().length >= MIN_ABANDON_REASON_LENGTH) return { ok: true, pending };
  return {
    ok: false,
    pending,
    error: `${pending.join(' and ')} ${pending.length > 1 ? 'are' : 'is'} still awaiting ${pending.length > 1 ? 'their' : 'its'} registered sample size. Wait for ${pending.length > 1 ? 'them' : 'it'}, or give a reason of at least ${MIN_ABANDON_REASON_LENGTH} characters to reveal anyway.`,
  };
}
