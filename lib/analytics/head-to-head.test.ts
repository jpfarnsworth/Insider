import { describe, expect, it } from 'vitest';
import { headToHead, mulberry32, tierMeans, topThirdWeights, weightedMean, type Paired } from './head-to-head';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('topThirdWeights', () => {
  it('gives a tier of exactly n/3 whatever the ties', () => {
    expect(sum(topThirdWeights([9, 8, 7, 6, 5, 4]))).toBeCloseTo(2, 9);
    expect(sum(topThirdWeights([5, 5, 5, 5, 5, 5]))).toBeCloseTo(2, 9); // all tied: each counts one third
    expect(sum(topThirdWeights([9, 5, 5, 5, 1, 1, 1, 1, 1]))).toBeCloseTo(3, 9);
  });

  it('counts strictly higher scores fully and shares the boundary group', () => {
    // n=9, tier=3: the 9 counts fully, the three 5s share the remaining 2 -> 2/3 each.
    const w = topThirdWeights([9, 5, 5, 5, 1, 1, 1, 1, 1]);
    expect(w[0]).toBe(1);
    expect(w[1]).toBeCloseTo(2 / 3, 9);
    expect(w.slice(4)).toEqual([0, 0, 0, 0, 0]);
  });

  it('handles tiny and empty inputs', () => {
    expect(topThirdWeights([])).toEqual([]);
    expect(sum(topThirdWeights([3]))).toBeCloseTo(1 / 3, 9);
  });
});

describe('weightedMean / tierMeans', () => {
  it('weights the mean', () => {
    expect(weightedMean([10, 20], [1, 3])).toBeCloseTo(17.5, 9);
    expect(weightedMean([], [])).toBeNaN();
  });

  it('builds each tier from its own scorer', () => {
    const items: Paired[] = [
      { week: 1, agent: 90, baseline: 10, excess: 10 },
      { week: 1, agent: 80, baseline: 20, excess: 8 },
      { week: 2, agent: 10, baseline: 90, excess: -2 },
      { week: 2, agent: 20, baseline: 80, excess: -4 },
      { week: 3, agent: 50, baseline: 50, excess: 0 },
      { week: 3, agent: 40, baseline: 60, excess: 1 },
    ];
    const m = tierMeans(items);
    expect(m.tierSize).toBe(2);
    expect(m.agent).toBeCloseTo(9, 9); // top two by agent: 10 and 8
    expect(m.baseline).toBeCloseTo(-3, 9); // top two by baseline: -2 and -4
  });
});

describe('mulberry32', () => {
  it('is deterministic per seed and spreads over [0,1)', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const xs = Array.from({ length: 5 }, () => a());
    expect(xs).toEqual(Array.from({ length: 5 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(mulberry32(8)()).not.toBe(mulberry32(7)());
  });
});

/** n signals over `weeks` weeks; the agent's score tracks excess with the given strength, the baseline's is noise. */
function synthetic(n: number, weeks: number, agentEdge: number): Paired[] {
  const r = mulberry32(42);
  return Array.from({ length: n }, (_, i) => {
    const excess = (r() - 0.5) * 20;
    return { week: i % weeks, excess, agent: 50 + agentEdge * excess + (r() - 0.5) * 20, baseline: 50 + (r() - 0.5) * 60 };
  });
}

describe('headToHead', () => {
  it('is undecided until each tier has enough signals', () => {
    const h = headToHead(synthetic(50, 10, 3));
    expect(h.verdict).toBeNull();
    expect(h.reason).toContain('20+');
  });

  it('keeps the agent when its tier clearly beats the baseline tier', () => {
    const h = headToHead(synthetic(300, 40, 3), { bootstraps: 500 });
    expect(h.verdict).toBe('keep_agent');
    expect(h.lo).toBeGreaterThan(0);
    expect(h.difference).toBeGreaterThan(0);
    expect(h.spearmanAgent).toBeGreaterThan(h.spearmanBaseline);
  });

  it('drops the agent when there is no difference: the burden of proof is on it', () => {
    const h = headToHead(synthetic(300, 40, 0), { bootstraps: 500 });
    expect(h.verdict).toBe('drop_agent');
    expect(h.lo).toBeLessThanOrEqual(0);
    expect(h.reason).toMatch(/no distinguishable difference|baseline tier is ahead/);
  });

  it('drops the agent when the baseline is clearly ahead', () => {
    const items = synthetic(300, 40, 0).map((p) => ({ ...p, baseline: 50 + 3 * p.excess + 0 }));
    const h = headToHead(items, { bootstraps: 500 });
    expect(h.verdict).toBe('drop_agent');
    expect(h.hi).toBeLessThan(0);
    expect(h.reason).toContain('baseline tier is ahead');
  });

  it('is reproducible: same signals, same interval', () => {
    const items = synthetic(150, 25, 1);
    expect(headToHead(items, { bootstraps: 300 })).toEqual(headToHead(items, { bootstraps: 300 }));
  });

  it('needs more than one week of signals to bootstrap', () => {
    expect(headToHead(synthetic(120, 1, 3), { bootstraps: 100 }).verdict).toBeNull();
  });
});
