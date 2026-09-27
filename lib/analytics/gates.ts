import type { SignalFact, ViewOptions } from './facts';
import { headToHead, GATE3_MIN_TIER, type HeadToHead, type Paired } from './head-to-head';
import { excessAt, excessValues, tiersFor } from './facts';
import { MIN_N, summarize, type Summary } from './stats';

const WEEK_MS = 7 * 86_400_000;

// Spec §11: paper trading is built only when ALL of these pass, on post-model-cutoff signals,
// net of costs. "Insufficient" means the data has not accumulated yet, which is not a failure.
export const GATE_HORIZON = 30;
export const GATE_MIN_SIGNALS = 50;
export const GATE_MAX_PARSE_ERROR = 0.01;
export const GATE_MIN_UPTIME = 0.95;

export type GateStatus = 'pass' | 'fail' | 'insufficient';

export interface Gate {
  id: 1 | 2 | 3 | 4;
  title: string;
  status: GateStatus;
  /** One line with the current values. */
  detail: string;
}

export interface PipelineHealth {
  /** Filings stored in the prior 30 days, and how many failed to parse. */
  filings: number;
  parseFailures: number;
  /** Weekdays in the observed window (up to the prior 30 days), and how many had a successful ingest run. */
  weekdays: number;
  weekdaysWithSuccessfulIngest: number;
  /** Days the pipeline has been running, capped at 30: uptime over a shorter history can't be judged. */
  daysObserved: number;
}

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const signedPct = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(2)}%`;

function tierLine(label: string, s: Summary): string {
  return s.sufficient ? `${label}: n=${s.n}, mean ${signedPct(s.mean)}` : `${label}: n=${s.n} (needs ${MIN_N})`;
}

/** Signals scored by both scorers with a complete outcome at the gate horizon, ready for the head-to-head. */
function pairedFor(facts: SignalFact[], view: ViewOptions): Paired[] {
  return facts.flatMap((f) => {
    const excess = excessAt(f, GATE_HORIZON, view);
    return f.agentScore !== null && f.baselineScore !== null && excess !== null
      ? [{ week: Math.floor(f.signalAt / WEEK_MS), agent: f.agentScore, baseline: f.baselineScore, excess }]
      : [];
  });
}

const signed = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(2)}`;
const rho = (x: number) => (Number.isNaN(x) ? '—' : x.toFixed(2));

function h2hLine(h: HeadToHead): string {
  return (
    `top third by each scorer on ${h.n} shared signals: agent ${signed(h.agentMean)}% vs baseline ${signed(h.baselineMean)}% ` +
    `(difference ${signed(h.difference)}, 95% interval ${Number.isNaN(h.lo) ? '—' : `${signed(h.lo)} to ${signed(h.hi)}`}, weekly-block bootstrap). ` +
    `Rank correlation with 30-day return, all shared signals: agent ${rho(h.spearmanAgent)}, baseline ${rho(h.spearmanBaseline)}.`
  );
}

/**
 * Gate 3. Tiers are the top third by each scorer's own rank on the shared signals; the difference in
 * tier means is bootstrapped in weekly blocks with both tiers rebuilt each time; the agent is kept
 * only if that difference is above zero with 95% confidence, otherwise it is dropped. This rule was
 * chosen after the design set had been looked at, so the OFFICIAL verdict uses only signals from the
 * holdout window (revealed in Settings). Until then the design-set result is shown as provisional.
 */
function gate3For(facts: SignalFact[], view: ViewOptions, holdoutFrom: string | null): Gate {
  const title = "The agent's top tier beats the baseline's top tier (95% confidence), or the agent is dropped";
  const official = headToHead(pairedFor(facts.filter((f) => f.holdoutWindow), view));
  const interim = headToHead(pairedFor(facts.filter((f) => !f.holdoutWindow), view));
  const windowCount = facts.filter((f) => f.holdoutWindow).length;
  const interimText = interim.n >= 3 ? `Interim on the design set, NOT evidence: ${h2hLine(interim)}` : 'Interim: too few shared signals yet.';

  if (official.verdict) {
    return {
      id: 3,
      title,
      status: 'pass', // decided by data either way
      detail: `${official.verdict === 'keep_agent' ? 'Keep the agent' : 'Drop the agent'}: ${official.reason}. Holdout: ${h2hLine(official)}`,
    };
  }
  const waiting = holdoutFrom
    ? `Official verdict awaits the holdout (signals from ${holdoutFrom}; ${windowCount} so far, ${official.n} with complete outcomes shared by both scorers, need ${3 * GATE3_MIN_TIER}+). `
    : `Official verdict needs ${3 * GATE3_MIN_TIER}+ holdout-window signals scored by both with complete outcomes (${official.n} so far). `;
  return { id: 3, title, status: 'insufficient', detail: waiting + interimText };
}

/**
 * The four evaluation gates. `facts` must already be the post-cutoff signals; `view` should be net
 * of costs (the Performance page forces both for this panel).
 */
export function evaluateGates(facts: SignalFact[], view: ViewOptions, health: PipelineHealth, opts: { holdoutFrom?: string | null } = {}): Gate[] {
  const complete = excessValues(facts, GATE_HORIZON, view).length;
  const gate1: Gate = {
    id: 1,
    title: `At least ${GATE_MIN_SIGNALS} signals with complete ${GATE_HORIZON}-day outcomes`,
    status: complete >= GATE_MIN_SIGNALS ? 'pass' : 'insufficient',
    detail: `${complete} of ${GATE_MIN_SIGNALS}`,
  };

  // Gates 2 and 3 compare tiers, so both scorers must have judged the same signals. While the agent has
  // scored only some of them (it works newest first, and different months can behave very differently),
  // the baseline tier over all signals against an agent tier over the scored ones compares different
  // periods, not different scorers. Once every signal is scored this is exactly the spec's population.
  const scored = facts.filter((f) => f.agentScore !== null);
  const pool = scored.length > 0 ? scored : facts;
  const basis = pool.length === facts.length ? '' : ` [on ${pool.length} signals scored by both]`;
  const tiers = tiersFor(pool);
  const top = summarize(excessValues(pool.filter(tiers.isTop), GATE_HORIZON, view));

  const gate2: Gate = {
    id: 2,
    title: `Top-tier signals show a positive average ${GATE_HORIZON}-day excess return vs ${view.bench}`,
    status: !top.sufficient ? 'insufficient' : top.mean > 0 ? 'pass' : 'fail',
    detail: tierLine('Agent >= 70 or baseline top third', top) + basis,
  };

  const gate3 = gate3For(facts, view, opts.holdoutFrom ?? null);

  const parseRate = health.filings ? health.parseFailures / health.filings : 0;
  const uptime = health.weekdays ? health.weekdaysWithSuccessfulIngest / health.weekdays : 0;
  const gate4: Gate = {
    id: 4,
    title: 'Parse error rate below 1% and pipeline uptime above 95% over the prior 30 days',
    // No filings, no weekdays, or less than 30 days of history means there's nothing to judge yet.
    status: !health.filings || !health.weekdays || health.daysObserved < 30 ? 'insufficient' : parseRate < GATE_MAX_PARSE_ERROR && uptime > GATE_MIN_UPTIME ? 'pass' : 'fail',
    detail: `Parse errors ${pct(parseRate, 2)} (${health.parseFailures} of ${health.filings}); uptime ${pct(uptime)} (${health.weekdaysWithSuccessfulIngest} of ${health.weekdays} weekdays); ${health.daysObserved} of 30 days observed`,
  };

  return [gate1, gate2, gate3, gate4];
}

/** All four gates passing is what unlocks Phase 2. */
export const allGatesPass = (gates: Gate[]): boolean => gates.length === 4 && gates.every((g) => g.status === 'pass');
