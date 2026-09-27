import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_COSTS } from '@/lib/market/costs';
import type { SignalFact, ViewOptions } from './facts';
import { fact } from './fixtures';
import { PREREG, blockBootstrap, evaluatePrereg, interimPrereg, offeringGap, quantile, rankCorrelationDifference, runPrereg, topTierMean, type PreregRow } from './prereg';

// The registered bootstrap is 2000 resamples of a few hundred signals per test: slow on a busy Pi.
vi.setConfig({ testTimeout: 30_000 });

const view: ViewOptions = { bench: 'SPY', net: false, scope: 'post', costs: DEFAULT_COSTS };
const WEEK = 7 * 86_400_000;

function lcg(seed: number) {
  let a = seed;
  return () => (a = (a * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

/** n holdout-window facts over `weeks` weeks. agentEdge/baselineEdge: how strongly each score follows the return. */
function holdout(n: number, weeks: number, o: { agentEdge?: number; baselineEdge?: number; taggedEvery?: number; taggedPenalty?: number; meanExcess?: number } = {}): SignalFact[] {
  const r = lcg(777);
  return Array.from({ length: n }, (_, i) => {
    const tagged = o.taggedEvery ? i % o.taggedEvery === 0 : false;
    const excess = (o.meanExcess ?? 0) + (r() - 0.5) * 20 - (tagged ? (o.taggedPenalty ?? 0) : 0);
    return fact({
      signalAt: Date.UTC(2026, 9, 1) + (i % weeks) * WEEK + i * 1000,
      excess,
      agentScore: Math.round(50 + (o.agentEdge ?? 0) * excess + (r() - 0.5) * 20),
      baselineScore: 50 + (o.baselineEdge ?? 0) * excess + (r() - 0.5) * 60,
      holdoutWindow: true,
      tags: tagged ? ['single_day_single_price'] : [],
    });
  });
}

describe('helpers', () => {
  it('quantile picks from a sorted list and is NaN when empty', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(3);
    expect(quantile([], 0.5)).toBeNaN();
  });

  it('block bootstrap resamples whole weeks, is seeded, and needs 2+ weeks', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ week: i % 4, v: i }));
    const stat = (s: typeof items) => s.reduce((a, b) => a + b.v, 0) / s.length;
    expect(blockBootstrap(items, stat, 50, 1)).toEqual(blockBootstrap(items, stat, 50, 1));
    expect(blockBootstrap(items, stat, 50, 1)).toHaveLength(50);
    expect(blockBootstrap(items.map((i) => ({ ...i, week: 0 })), stat, 50, 1)).toEqual([]);
  });
});

describe('statistics', () => {
  const row = (agent: number, baseline: number, excess: number, tagged = false, week = 0): PreregRow => ({ week, at: 0, agent, baseline, excess, tagged });

  it('top tier is the union of each scorer\'s top third', () => {
    // 6 rows: agent top-2 are rows 0,1; baseline top-2 are rows 4,5; union = 4 rows.
    const rows = [row(9, 1, 10), row(8, 2, 8), row(2, 3, 0), row(1, 4, 0), row(3, 9, -4), row(4, 8, -6)];
    expect(topTierMean(rows)).toBeCloseTo((10 + 8 - 4 - 6) / 4, 9);
  });

  it('rank correlation difference favours the scorer that orders returns', () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(i, 30 - i, i));
    expect(rankCorrelationDifference(rows)).toBeCloseTo(2, 6); // agent +1, baseline -1
    expect(rankCorrelationDifference(rows.slice(0, 2))).toBeNaN();
  });

  it('offering gap is tagged minus rest', () => {
    expect(offeringGap([row(0, 0, -5, true), row(0, 0, -3, true), row(0, 0, 1), row(0, 0, 3)])).toBeCloseTo(-6, 9);
    expect(offeringGap([row(0, 0, 1)])).toBeNaN();
  });
});

describe('registered tests', () => {
  it('stay awaiting until the fixed sample size, on holdout-window signals only', () => {
    const facts = [...holdout(50, 10, { meanExcess: 3 }), ...holdout(400, 40).map((f) => ({ ...f, holdoutWindow: false }))];
    const [h1, h2, h3] = evaluatePrereg(facts, view);
    expect([h1.status, h2.status, h3.status]).toEqual(['awaiting', 'awaiting', 'awaiting']);
    expect(h1.progress).toBe(`50 of ${PREREG.h1Signals}`);
  });

  it('H1 is supported when the top tier is clearly positive, and not when it is flat', () => {
    expect(evaluatePrereg(holdout(200, 25, { agentEdge: 1, baselineEdge: 1, meanExcess: 4 }), view)[0].status).toBe('supported');
    expect(evaluatePrereg(holdout(200, 25, { meanExcess: 0 }), view)[0].status).toBe('not_supported');
  });

  it('H2 uses the earliest 300 signals and needs the agent to out-rank the baseline', () => {
    const good = evaluatePrereg(holdout(400, 40, { agentEdge: 4, baselineEdge: 0 }), view)[1];
    expect(good.status).toBe('supported');
    expect(good.progress).toBe('400 of 300');
    expect(evaluatePrereg(holdout(400, 40, { agentEdge: 0, baselineEdge: 0 }), view)[1].status).toBe('not_supported');
    expect(evaluatePrereg(holdout(400, 40, { agentEdge: 0, baselineEdge: 4 }), view)[1].status).toBe('not_supported');
  });

  it('H3 is supported when tagged signals are clearly worse, and not otherwise', () => {
    expect(evaluatePrereg(holdout(260, 30, { taggedEvery: 5, taggedPenalty: 15 }), view)[2].status).toBe('supported');
    expect(evaluatePrereg(holdout(260, 30, { taggedEvery: 5, taggedPenalty: 0 }), view)[2].status).toBe('not_supported');
    expect(evaluatePrereg(holdout(100, 30, { taggedEvery: 10, taggedPenalty: 15 }), view)[2].status).toBe('awaiting'); // 10 tagged of 30
  });

  it('is reproducible', () => {
    const facts = holdout(200, 25, { agentEdge: 1, meanExcess: 2 });
    expect(evaluatePrereg(facts, view)).toEqual(evaluatePrereg(facts, view));
  });

  it('runPrereg keeps working with few weeks, and the interim never counts as a result', () => {
    expect(runPrereg('H1', [], 50).status).toBe('awaiting');
    const interim = interimPrereg(holdout(200, 25, { agentEdge: 1 }).map((f) => ({ ...f, holdoutWindow: false })), view, 100);
    expect(interim.every((r) => r.status === 'awaiting')).toBe(true);
    expect(interim[1].estimate).not.toBeNull();
  });
});
