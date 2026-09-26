import type { SignalFact, ViewOptions } from './facts';
import { excessValues, tiersFor } from './facts';
import { MIN_N, summarize, type Summary } from './stats';

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

/**
 * The four evaluation gates. `facts` must already be the post-cutoff signals; `view` should be net
 * of costs (the Performance page forces both for this panel).
 */
export function evaluateGates(facts: SignalFact[], view: ViewOptions, health: PipelineHealth): Gate[] {
  const complete = excessValues(facts, GATE_HORIZON, view).length;
  const gate1: Gate = {
    id: 1,
    title: `At least ${GATE_MIN_SIGNALS} signals with complete ${GATE_HORIZON}-day outcomes`,
    status: complete >= GATE_MIN_SIGNALS ? 'pass' : 'insufficient',
    detail: `${complete} of ${GATE_MIN_SIGNALS}`,
  };

  const tiers = tiersFor(facts);
  const top = summarize(excessValues(facts.filter(tiers.isTop), GATE_HORIZON, view));
  const agent = summarize(excessValues(facts.filter(tiers.isAgentTop), GATE_HORIZON, view));
  const baseline = summarize(excessValues(facts.filter(tiers.isBaselineTop), GATE_HORIZON, view));

  const gate2: Gate = {
    id: 2,
    title: `Top-tier signals show a positive average ${GATE_HORIZON}-day excess return vs ${view.bench}`,
    status: !top.sufficient ? 'insufficient' : top.mean > 0 ? 'pass' : 'fail',
    detail: tierLine('Agent >= 70 or baseline top third', top),
  };

  const both = agent.sufficient && baseline.sufficient;
  const gate3: Gate = {
    id: 3,
    title: "The agent's top tier outperforms the baseline's top tier, or the agent is dropped",
    status: both ? 'pass' : 'insufficient',
    detail: both
      ? agent.mean > baseline.mean
        ? `Agent wins: ${tierLine('agent', agent)} vs ${tierLine('baseline', baseline)}`
        : `Baseline wins, so drop the agent: ${tierLine('agent', agent)} vs ${tierLine('baseline', baseline)}`
      : `${tierLine('Agent tier', agent)}; ${tierLine('baseline tier', baseline)}`,
  };

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
