import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_COSTS } from '@/lib/market/costs';
import type { SignalFact, ViewOptions } from './facts';
import { fact } from './fixtures';
import { allGatesPass, evaluateGates, type PipelineHealth } from './gates';
import { memoryPreregStore } from './prereg-store';

// The registered bootstrap is 2000 resamples of a few hundred signals per test: slow on a busy Pi.
vi.setConfig({ testTimeout: 30_000 });

const view: ViewOptions = { bench: 'SPY', net: true, scope: 'post', costs: DEFAULT_COSTS };
const healthy: PipelineHealth = { filings: 5000, parseFailures: 10, weekdays: 22, weekdaysWithSuccessfulIngest: 22, daysObserved: 30 };

/**
 * count signals with a constant gross excess (net = excess - 0.3). Baseline scores step down by 0.01 within
 * a group so they are distinct: identical scores at the top-third boundary would all join the tier.
 */
const many = (count: number, o: { baseline?: number; agent?: number | null; excess?: number }): SignalFact[] =>
  Array.from({ length: count }, (_, i) => fact({ baselineScore: (o.baseline ?? 50) - i * 0.01, agentScore: o.agent ?? null, excess: o.excess ?? 5 }));

const gate = async (facts: SignalFact[], health = healthy, id: 1 | 2 | 3 | 4 = 1) => (await evaluateGates(facts, view, health, { preregStore: memoryPreregStore() })).find((g) => g.id === id)!;

describe('gate 1: enough complete 30-day outcomes', () => {
  it('needs 50', async () => {
    expect(await gate(many(49, {}), healthy, 1)).toMatchObject({ status: 'insufficient', detail: '49 of 50' });
    expect((await gate(many(50, {}), healthy, 1)).status).toBe('pass');
  });

  it('ignores signals whose 30-day outcome is pending', async () => {
    const facts = [...many(40, {}), ...Array.from({ length: 30 }, () => fact({ outcomeStatus: 'pending' }))];
    expect((await gate(facts, healthy, 1)).detail).toBe('40 of 50');
  });
});

const WEEK = 7 * 86_400_000;

/**
 * n holdout-window signals over `weeks` weeks. `mean` shifts every return; agentEdge / baselineEdge make each
 * scorer's score follow the return (so it out-ranks the other).
 */
function holdoutSet(n: number, weeks: number, o: { mean?: number; agentEdge?: number; baselineEdge?: number; frozen?: boolean } = {}): SignalFact[] {
  let a = 12345;
  const rand = () => ((a = (a * 1664525 + 1013904223) % 4294967296) / 4294967296);
  return Array.from({ length: n }, (_, i) => {
    const excess = (o.mean ?? 0) + (rand() - 0.5) * 20;
    return fact({
      signalAt: Date.UTC(2026, 9, 1) + (i % weeks) * WEEK + i * 1000,
      excess: excess + 0.3, // gross; the view is net, which subtracts the round-trip cost
      agentScore: Math.round(50 + (o.agentEdge ?? 0) * excess + (rand() - 0.5) * 20),
      baselineScore: 50 + (o.baselineEdge ?? 0) * excess + (rand() - 0.5) * 60,
      holdoutWindow: true,
      holdout: o.frozen ?? false,
      ...(o.frozen ? { outcomes: {} } : {}),
    });
  });
}

const withHoldout = async (facts: SignalFact[], id: 1 | 2 | 3 | 4, store = memoryPreregStore()) =>
  (await evaluateGates(facts, view, healthy, { holdoutFrom: '2026-10-01', preregStore: store })).find((g) => g.id === id)!;

describe('gate 2: pre-registered H1, judged on the holdout', () => {
  it('waits for the holdout, and shows the design set as not evidence', async () => {
    const design = [...many(60, { baseline: 90, agent: 60, excess: 6 })];
    const g = await withHoldout(design, 2);
    expect(g.status).toBe('insufficient');
    expect(g.detail).toContain('Awaiting the holdout (signals from 2026-10-01)');
    expect(g.detail).toContain('NOT evidence');
  });

  it('stays insufficient while the holdout is frozen (outcomes withheld)', async () => {
    expect((await withHoldout(holdoutSet(200, 25, { mean: 5, frozen: true }), 2)).status).toBe('insufficient');
  });

  it('passes on the holdout when the top tier is clearly positive net of costs', async () => {
    const g = await withHoldout(holdoutSet(200, 25, { mean: 4, agentEdge: 1, baselineEdge: 1 }), 2);
    expect(g.status).toBe('pass');
    expect(g.detail).toContain('Holdout: baseline top third');
  });

  it('fails when the holdout top tier is not positive, whatever the design set did', async () => {
    // The design set is strongly positive; the gate must use only the holdout's own (clearly negative) numbers.
    const facts = [...many(60, { baseline: 90, agent: 60, excess: 8 }), ...holdoutSet(200, 25, { mean: -6 })];
    expect((await withHoldout(facts, 2)).status).toBe('fail');
  });
});

describe('gate 3: the agent is not promoted by default', () => {
  it('resolves to "not promoted" while the registered test is pending, and never blocks Phase 2', async () => {
    const g = await withHoldout([...many(60, { baseline: 90, agent: 60, excess: 3 })], 3);
    expect(g.status).toBe('pass');
    expect(g.detail).toMatch(/^Not promoted \(default\)/);
    expect(g.detail).toContain('shadow scorer');
    expect(g.detail).toContain('NOT evidence');
    expect(g.detail).toContain(`n=${300}`);
  });

  it('promotes the agent only when it clearly out-ranks the baseline on the holdout (n=300)', async () => {
    const g = await withHoldout(holdoutSet(400, 40, { agentEdge: 4, baselineEdge: 0 }), 3);
    expect(g.status).toBe('pass');
    expect(g.detail).toMatch(/^Promote the agent/);
  });

  it('is not promoted when there is no difference, or the baseline out-ranks it', async () => {
    expect((await withHoldout(holdoutSet(400, 40), 3)).detail).toMatch(/^Not promoted: holdout/);
    expect((await withHoldout(holdoutSet(400, 40, { baselineEdge: 4 }), 3)).detail).toMatch(/^Not promoted: holdout/);
  });
});

describe('gate 4: pipeline health', () => {
  const g = (h: Partial<PipelineHealth>) => gate([], { ...healthy, ...h }, 4);

  it('passes under 1% parse errors and over 95% uptime', async () => {
    expect((await g({})).status).toBe('pass');
  });

  it('fails at 1% parse errors or worse', async () => {
    expect((await g({ filings: 1000, parseFailures: 10 })).status).toBe('fail');
    expect((await g({ filings: 1000, parseFailures: 9 })).status).toBe('pass');
  });

  it('fails at 95% uptime or worse (it must be over 95%)', async () => {
    expect((await g({ weekdays: 20, weekdaysWithSuccessfulIngest: 19 })).status).toBe('fail'); // exactly 95%
    expect((await g({ weekdays: 22, weekdaysWithSuccessfulIngest: 21 })).status).toBe('pass'); // 95.45%
  });

  it('is insufficient with nothing to judge', async () => {
    expect((await g({ filings: 0, parseFailures: 0 })).status).toBe('insufficient');
    expect((await g({ weekdays: 0, weekdaysWithSuccessfulIngest: 0 })).status).toBe('insufficient');
  });

  it('is insufficient until the pipeline has 30 days of history, however good it looks', async () => {
    const short = await g({ daysObserved: 12 });
    expect(short.status).toBe('insufficient');
    expect(short.detail).toContain('12 of 30 days observed');
  });
});

describe('allGatesPass', () => {
  it('needs every gate to pass; gate 3 always resolves so it never blocks', async () => {
    const facts = [...many(60, { baseline: 90, agent: 60, excess: 4 }), ...holdoutSet(240, 30, { mean: 4, agentEdge: 1, baselineEdge: 1 })];
    const gates = await evaluateGates(facts, view, healthy, { preregStore: memoryPreregStore() });
    expect(gates.map((x) => x.status)).toEqual(['pass', 'pass', 'pass', 'pass']);
    expect(allGatesPass(gates)).toBe(true);
    expect(allGatesPass(await evaluateGates(facts.slice(0, 10), view, healthy, { preregStore: memoryPreregStore() }))).toBe(false);
  });

  it('is false for a partial list', async () => {
    expect(allGatesPass([])).toBe(false);
  });
});
