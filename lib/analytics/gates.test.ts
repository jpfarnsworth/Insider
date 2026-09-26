import { describe, expect, it } from 'vitest';
import { DEFAULT_COSTS } from '@/lib/market/costs';
import type { SignalFact, ViewOptions } from './facts';
import { fact } from './fixtures';
import { allGatesPass, evaluateGates, type PipelineHealth } from './gates';

const view: ViewOptions = { bench: 'SPY', net: true, scope: 'post', costs: DEFAULT_COSTS };
const healthy: PipelineHealth = { filings: 5000, parseFailures: 10, weekdays: 22, weekdaysWithSuccessfulIngest: 22, daysObserved: 30 };

/**
 * count signals with a constant gross excess (net = excess - 0.3). Baseline scores step down by 0.01 within
 * a group so they are distinct: identical scores at the top-third boundary would all join the tier.
 */
const many = (count: number, o: { baseline?: number; agent?: number | null; excess?: number }): SignalFact[] =>
  Array.from({ length: count }, (_, i) => fact({ baselineScore: (o.baseline ?? 50) - i * 0.01, agentScore: o.agent ?? null, excess: o.excess ?? 5 }));

const gate = (facts: SignalFact[], health = healthy, id: 1 | 2 | 3 | 4 = 1) => evaluateGates(facts, view, health).find((g) => g.id === id)!;

describe('gate 1: enough complete 30-day outcomes', () => {
  it('needs 50', () => {
    expect(gate(many(49, {}), healthy, 1)).toMatchObject({ status: 'insufficient', detail: '49 of 50' });
    expect(gate(many(50, {}), healthy, 1).status).toBe('pass');
  });

  it('ignores signals whose 30-day outcome is pending', () => {
    const facts = [...many(40, {}), ...Array.from({ length: 30 }, () => fact({ outcomeStatus: 'pending' }))];
    expect(gate(facts, healthy, 1).detail).toBe('40 of 50');
  });
});

describe('gate 2: top tier has positive net excess', () => {
  it('passes when the top tier has enough signals and a positive net mean', () => {
    const facts = [...many(25, { baseline: 90, excess: 4 }), ...many(50, { baseline: 40, excess: -3 })];
    expect(gate(facts, healthy, 2)).toMatchObject({ status: 'pass' });
  });

  it('fails when the top tier is net negative, even though gross is positive', () => {
    // gross +0.2 minus the 0.3 cost = -0.1
    const facts = [...many(25, { baseline: 90, excess: 0.2 }), ...many(50, { baseline: 40, excess: 1 })];
    expect(gate(facts, healthy, 2).status).toBe('fail');
  });

  it('is insufficient below 20 top-tier signals', () => {
    // 45 signals: the top third is 15.
    const g = gate([...many(9, { baseline: 90, excess: 9 }), ...many(36, { baseline: 40 })], healthy, 2);
    expect(g.status).toBe('insufficient');
    expect(g.detail).toContain('n=15');
  });

  it('counts agent >= 70 signals in the top tier even with a low baseline', () => {
    // Baseline top third of 28 is 10 signals (3 strong-baseline + 7 agent ones); the union adds all 25 agent-tier signals.
    const g = gate([...many(25, { baseline: 30, agent: 80, excess: 6 }), ...many(3, { baseline: 90, excess: 2 })], healthy, 2);
    expect(g.detail).toContain('n=28');
    expect(g.status).toBe('pass');
  });
});

describe('gate 3: agent versus baseline', () => {
  it('is insufficient until both tiers have enough signals', () => {
    expect(gate([...many(25, { baseline: 90 }), ...many(5, { baseline: 40, agent: 80 })], healthy, 3).status).toBe('insufficient');
  });

  it('passes when the agent tier beats the baseline tier', () => {
    const facts = [...many(25, { baseline: 90, excess: 2 }), ...many(25, { baseline: 40, agent: 80, excess: 6 }), ...many(20, { baseline: 40 })];
    const g = gate(facts, healthy, 3);
    expect(g.status).toBe('pass');
    expect(g.detail).toMatch(/^Agent wins/);
  });

  it('also passes, deciding to drop the agent, when the baseline tier does better', () => {
    const facts = [...many(25, { baseline: 90, excess: 7 }), ...many(25, { baseline: 40, agent: 80, excess: 1 }), ...many(20, { baseline: 40 })];
    const g = gate(facts, healthy, 3);
    expect(g.status).toBe('pass');
    expect(g.detail).toMatch(/^Baseline wins, so drop the agent/);
  });
});

describe('gate 4: pipeline health', () => {
  const g = (h: Partial<PipelineHealth>) => gate([], { ...healthy, ...h }, 4);

  it('passes under 1% parse errors and over 95% uptime', () => {
    expect(g({}).status).toBe('pass');
  });

  it('fails at 1% parse errors or worse', () => {
    expect(g({ filings: 1000, parseFailures: 10 }).status).toBe('fail');
    expect(g({ filings: 1000, parseFailures: 9 }).status).toBe('pass');
  });

  it('fails at 95% uptime or worse (it must be over 95%)', () => {
    expect(g({ weekdays: 20, weekdaysWithSuccessfulIngest: 19 }).status).toBe('fail'); // exactly 95%
    expect(g({ weekdays: 22, weekdaysWithSuccessfulIngest: 21 }).status).toBe('pass'); // 95.45%
  });

  it('is insufficient with nothing to judge', () => {
    expect(g({ filings: 0, parseFailures: 0 }).status).toBe('insufficient');
    expect(g({ weekdays: 0, weekdaysWithSuccessfulIngest: 0 }).status).toBe('insufficient');
  });

  it('is insufficient until the pipeline has 30 days of history, however good it looks', () => {
    const short = g({ daysObserved: 12 });
    expect(short.status).toBe('insufficient');
    expect(short.detail).toContain('12 of 30 days observed');
  });
});

describe('allGatesPass', () => {
  it('needs every gate to pass', () => {
    const facts = [...many(30, { baseline: 90, excess: 4 }), ...many(30, { baseline: 40, agent: 80, excess: 6 }), ...many(20, { baseline: 40, excess: 1 })];
    const gates = evaluateGates(facts, view, healthy);
    expect(gates.map((x) => x.status)).toEqual(['pass', 'pass', 'pass', 'pass']);
    expect(allGatesPass(gates)).toBe(true);
    expect(allGatesPass(evaluateGates(facts.slice(0, 10), view, healthy))).toBe(false);
  });

  it('is false for a partial list', () => {
    expect(allGatesPass([])).toBe(false);
  });
});
