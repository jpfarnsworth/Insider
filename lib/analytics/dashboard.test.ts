import { describe, expect, it } from 'vitest';
import { DEFAULT_COSTS } from '@/lib/market/costs';
import { computeKpis, cumulativeByTier, meansByHorizon } from './dashboard';
import type { OutcomeFact, ViewOptions } from './facts';
import { fact } from './fixtures';

const view: ViewOptions = { bench: 'SPY', net: false, scope: 'post', costs: DEFAULT_COSTS };
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 5, 30);

const done = (excess: number, exitDate: string): Record<number, { SPY: OutcomeFact }> => ({
  30: { SPY: { status: 'complete', returnPct: excess + 1, excessPct: excess, benchmarkReturnPct: 1, maxDrawdownPct: -2, exitDate } },
});

describe('computeKpis', () => {
  it('counts new signals in the last 7 and 30 days', () => {
    const facts = [1, 3, 10, 29, 31, 90].map((d) => fact({ signalAt: NOW - d * DAY }));
    const k = computeKpis(facts, view, NOW, 4);
    expect(k.newSignals7d).toBe(2);
    expect(k.newSignals30d).toBe(4);
    expect(k.activeClusters).toBe(4);
  });

  it('reports mean excess and hit rate only with enough completed outcomes', () => {
    const few = computeKpis(Array.from({ length: 19 }, () => fact({ excess: 2 })), view, NOW, 0);
    expect(few).toMatchObject({ complete30d: 19, meanExcess30d: null, hitRate30d: null });
    const enough = computeKpis([...Array.from({ length: 15 }, () => fact({ excess: 4 })), ...Array.from({ length: 5 }, () => fact({ excess: -2 }))], view, NOW, 0);
    expect(enough.meanExcess30d).toBeCloseTo(2.5, 10);
    expect(enough.hitRate30d).toBe(0.75);
  });

  it('correlates the two scores once at least 20 signals have both', () => {
    const facts = Array.from({ length: 25 }, (_, i) => fact({ baselineScore: 40 + i, agentScore: 30 + i * 2 }));
    expect(computeKpis(facts, view, NOW, 0).agentBaselineCorrelation).toEqual({ r: expect.closeTo(1, 10), n: 25 });
    expect(computeKpis(facts.slice(0, 10), view, NOW, 0).agentBaselineCorrelation).toBeNull();
  });

  it('is null when a score does not vary, not a misleading zero', () => {
    const facts = Array.from({ length: 25 }, (_, i) => fact({ baselineScore: 40 + i, agentScore: 70 }));
    expect(computeKpis(facts, view, NOW, 0).agentBaselineCorrelation).toBeNull();
  });
});

describe('cumulativeByTier', () => {
  it('builds running sums by exit date for each tier, skipping empty tiers', () => {
    const facts = [
      fact({ agentScore: 80, baselineScore: 90, outcomes: done(2, '2026-03-10') }),
      fact({ agentScore: 80, baselineScore: 20, outcomes: done(3, '2026-03-05') }),
      fact({ agentScore: 10, baselineScore: 10, outcomes: done(-1, '2026-03-20') }),
    ];
    const lines = cumulativeByTier(facts, view);
    const agent = lines.find((l) => l.key === 'agent')!;
    expect(agent.points.map((p) => p.y)).toEqual([3, 5]); // ordered by exit date, not input order
    expect(lines.find((l) => l.key === 'all')!.points.map((p) => p.y)).toEqual([3, 5, 4]);
    expect(cumulativeByTier([fact({ outcomeStatus: 'pending' })], view)).toEqual([]);
  });

  it('uses net returns when asked', () => {
    const f = fact({ agentScore: 80, avgDollarVolume: 5_000_000, outcomes: done(2, '2026-03-10') });
    const gross = cumulativeByTier([f], view).find((l) => l.key === 'all')!.points[0].y;
    const net = cumulativeByTier([f], { ...view, net: true }).find((l) => l.key === 'all')!.points[0].y;
    expect(gross - net).toBeCloseTo(0.3, 10);
  });
});

describe('meansByHorizon', () => {
  it('gives a mean per horizon only where there are enough completed outcomes', () => {
    const facts = Array.from({ length: 25 }, () => fact({ conviction: 'high', excess: 3 }));
    const rows = meansByHorizon(facts, view);
    const all = rows.find((r) => r.key === 'all')!;
    expect(all.means).toEqual([null, null, 3, null, null]); // fact() only has 30-day outcomes
    expect(all.counts).toEqual([0, 0, 25, 0, 0]);
    expect(rows.find((r) => r.key === 'agent')!.means[2]).toBe(3);
  });

  it('leaves the agent row empty without high-conviction calls', () => {
    const rows = meansByHorizon(Array.from({ length: 25 }, () => fact({ conviction: 'low' })), view);
    expect(rows.find((r) => r.key === 'agent')!.means.every((m) => m === null)).toBe(true);
  });
});
