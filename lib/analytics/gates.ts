import type { SignalFact, ViewOptions } from './facts';
import { excessValues } from './facts';
import { headToHead } from './head-to-head';
import { PREREG, evaluatePrereg, interimPrereg, type PreregResult } from './prereg';

// Spec §11: paper trading is built only when ALL of these pass, on post-model-cutoff signals,
// net of costs. "Insufficient" means the data has not accumulated yet, which is not a failure.
//
// Gates 2 and 3 are the pre-registered holdout tests H1 and H2 (docs/preregistration.md, registered
// 2026-09-27). Their rules were fixed after the design set had been seen, so their OFFICIAL results
// use only holdout-window signals; the design-set numbers shown beside them are descriptive, never evidence.
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
const signed = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(2)}`;

const holdoutClause = (from: string | null) => (from ? `signals from ${from}` : 'holdout-window signals');

/** Gate 2 = H1: top-tier signals have a positive average 30-day excess return, judged on the holdout. */
function gate2From(h1: PreregResult, interim: PreregResult, holdoutFrom: string | null): Gate {
  const title = `Top-tier signals show a positive average ${GATE_HORIZON}-day net excess return (pre-registered, judged on the holdout)`;
  const interimText = ` Design set, NOT evidence: ${interim.detail}`;
  if (h1.status === 'awaiting') {
    return { id: 2, title, status: 'insufficient', detail: `Awaiting the holdout (${holdoutClause(holdoutFrom)}): ${h1.progress} signals scored by both with complete outcomes.${interimText}` };
  }
  return {
    id: 2,
    title,
    status: h1.status === 'supported' ? 'pass' : 'fail',
    detail: `Holdout: top tier (top third by either scorer) ${h1.detail}${interimText}`,
  };
}

/**
 * Gate 3 = H2. The agent is NOT promoted by default: it keeps running as a shadow scorer that no decision
 * uses, and Phase 2 proceeds on the baseline alone unless the pre-registered rank-correlation test says
 * otherwise. That is a decided outcome (the spec allows either), so the gate passes; the detail says which.
 * Note the registration itself says this test is underpowered at n=300, so "not promoted" is the expected result.
 */
function gate3From(facts: SignalFact[], view: ViewOptions, h2: PreregResult, interim: PreregResult): Gate {
  const title = 'The agent is promoted only if it out-ranks the baseline on the pre-registered test; otherwise it stays a shadow scorer';
  const design = facts.filter((f) => !f.holdoutWindow);
  const rows = design.flatMap((f) => (f.agentScore !== null && f.baselineScore !== null ? [f] : []));
  const tier = headToHead(
    rows.flatMap((f) => {
      const e = f.outcomes[GATE_HORIZON]?.[view.bench];
      const net = e && e.status === 'complete' && e.excessPct !== null ? e.excessPct : null;
      return net === null ? [] : [{ week: Math.floor(f.signalAt / (7 * 86_400_000)), agent: f.agentScore as number, baseline: f.baselineScore as number, excess: net }];
    }),
    { bootstraps: 300 },
  );
  const descriptive = tier.n >= 3 ? ` Top-third tiers (design set, descriptive only): agent ${signed(tier.agentMean)}% vs baseline ${signed(tier.baselineMean)}% on ${tier.n} shared signals.` : '';
  const interimText = ` Rank-correlation difference on the design set, NOT evidence: ${interim.detail}${descriptive}`;

  if (h2.status === 'supported') {
    return { id: 3, title, status: 'pass', detail: `Promote the agent: holdout rank-correlation difference ${h2.detail} (n=${PREREG.h2Signals}).` };
  }
  if (h2.status === 'not_supported') {
    return { id: 3, title, status: 'pass', detail: `Not promoted: holdout rank-correlation difference ${h2.detail} (n=${PREREG.h2Signals}). The agent stays a shadow scorer.` };
  }
  return {
    id: 3,
    title,
    status: 'pass',
    detail: `Not promoted (default): the agent runs as a shadow scorer and Phase 2 uses the baseline. Pre-registered test at n=${PREREG.h2Signals} on the holdout (${h2.progress}).${interimText}`,
  };
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

  const official = evaluatePrereg(facts, view);
  const interim = interimPrereg(facts, view);
  const gate2 = gate2From(official[0], interim[0], opts.holdoutFrom ?? null);
  const gate3 = gate3From(facts, view, official[1], interim[1]);

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

/** All four gates passing is what unlocks Phase 2. Gate 3 always resolves (promote, or not promoted), so it never blocks. */
export const allGatesPass = (gates: Gate[]): boolean => gates.length === 4 && gates.every((g) => g.status === 'pass');
