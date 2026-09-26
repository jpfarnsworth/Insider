import { describe, expect, it } from 'vitest';
import { DEFAULT_COSTS } from '@/lib/market/costs';
import { bandOf, bucketSummaries, calibration, capBucket, clusterSizeBucket, excessAt, inScope, tiersFor, type ViewOptions } from './facts';
import { fact, out } from './fixtures';

const view = (o: Partial<ViewOptions> = {}): ViewOptions => ({ bench: 'SPY', net: false, scope: 'post', costs: DEFAULT_COSTS, ...o });

describe('excessAt', () => {
  it('returns gross excess for the chosen benchmark', () => {
    expect(excessAt(fact({ excess: 5, iwmExcess: 2 }), 30, view())).toBe(5);
    expect(excessAt(fact({ excess: 5, iwmExcess: 2 }), 30, view({ bench: 'IWM' }))).toBe(2);
  });

  it('subtracts the round-trip cost when net, at the liquid or thin tier', () => {
    expect(excessAt(fact({ excess: 5 }), 30, view({ net: true }))).toBeCloseTo(4.7, 10);
    expect(excessAt(fact({ excess: 5, avgDollarVolume: 200_000 }), 30, view({ net: true }))).toBeCloseTo(4.0, 10);
    expect(excessAt(fact({ excess: 5, avgDollarVolume: null }), 30, view({ net: true }))).toBeCloseTo(4.0, 10);
  });

  it('counts only complete outcomes', () => {
    expect(excessAt(fact({ outcomeStatus: 'pending' }), 30, view())).toBeNull();
    expect(excessAt(fact({ outcomeStatus: 'data_ended' }), 30, view())).toBeNull();
  });

  it('is null for a horizon with no outcome or no excess value', () => {
    expect(excessAt(fact(), 90, view())).toBeNull();
    const f = fact();
    f.outcomes[30]!.SPY = out({ excessPct: null });
    expect(excessAt(f, 30, view())).toBeNull();
  });
});

describe('inScope', () => {
  it('keeps only post-cutoff signals by default and everything when asked', () => {
    expect(inScope(fact({ postCutoff: false }), view())).toBe(false);
    expect(inScope(fact({ postCutoff: true }), view())).toBe(true);
    expect(inScope(fact({ postCutoff: false }), view({ scope: 'all' }))).toBe(true);
  });
});

describe('tiersFor', () => {
  const pop = [90, 80, 70, 60, 50, 40].map((s) => fact({ baselineScore: s, agentScore: s === 40 ? 75 : 30 }));

  it('defines the baseline tier as the top third and the agent tier as 70 or more', () => {
    const t = tiersFor(pop);
    expect(pop.filter(t.isBaselineTop).map((f) => f.baselineScore)).toEqual([90, 80]);
    expect(pop.filter(t.isAgentTop).map((f) => f.baselineScore)).toEqual([40]);
    expect(pop.filter(t.isTop).map((f) => f.baselineScore)).toEqual([90, 80, 40]);
  });

  it('never puts an unscored signal in a tier', () => {
    const t = tiersFor([...pop, fact({ baselineScore: null, agentScore: null })]);
    expect(t.isTop(fact({ baselineScore: null, agentScore: null }))).toBe(false);
  });
});

describe('bucket helpers', () => {
  it('buckets market cap, cluster size and score', () => {
    expect(capBucket(null)).toBe('Unknown');
    expect(capBucket(100e6)).toBe('Micro (< $300M)');
    expect(capBucket(1e9)).toBe('Small ($300M-2B)');
    expect(capBucket(5e9)).toBe('Mid ($2B-10B)');
    expect(capBucket(50e9)).toBe('Large (> $10B)');
    expect([3, 4, 5, 6, 7, 12].map(clusterSizeBucket)).toEqual(['3 insiders', '4 insiders', '5-6 insiders', '5-6 insiders', '7+ insiders', '7+ insiders']);
    expect(bandOf(73)).toBe('70-79');
    expect(bandOf(null)).toBeNull();
  });

  it('summarises a horizon per bucket, in order, skipping empty and unkeyed buckets', () => {
    const facts = [fact({ agentScore: 75, excess: 4 }), fact({ agentScore: 78, excess: 6 }), fact({ agentScore: 45, excess: -2 }), fact({ agentScore: null })];
    const rows = bucketSummaries(facts, (f) => bandOf(f.agentScore), ['40-49', '50-59', '70-79'], 30, view());
    expect(rows.map((r) => r.key)).toEqual(['40-49', '70-79']);
    expect(rows[1].summary).toMatchObject({ n: 2, mean: 5, sufficient: false });
  });
});

describe('bucketSummaries: empty buckets', () => {
  it('omits buckets whose signals have no completed outcome', () => {
    const facts = [fact({ roleMix: 'ceo_cfo', excess: 3 }), fact({ roleMix: 'director', outcomeStatus: 'pending' })];
    const rows = bucketSummaries(facts, (f) => f.roleMix, null, 30, view());
    expect(rows.map((r) => r.key)).toEqual(['ceo_cfo']);
  });
});

describe('calibration', () => {
  it('reports realised hit rate by conviction level', () => {
    const facts = [
      fact({ conviction: 'high', excess: 3 }),
      fact({ conviction: 'high', excess: -1 }),
      fact({ conviction: 'low', excess: -2 }),
      fact({ conviction: null }),
    ];
    const rows = calibration(facts, view());
    expect(rows.map((r) => r.key)).toEqual(['low', 'high']);
    expect(rows[1].summary.hitRate).toBe(0.5);
  });
});
