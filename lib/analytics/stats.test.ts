import { describe, expect, it } from 'vitest';
import {
  cumulative,
  histogram,
  mean,
  median,
  MIN_N,
  pearson,
  ranks,
  rollingHitRate,
  scoreBand,
  spearman,
  stdev,
  summarize,
  topThirdThreshold,
} from './stats';

describe('basic stats', () => {
  it('computes mean, median and sample standard deviation', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 4);
  });

  it('returns NaN, not a misleading number, for empty or too-small inputs', () => {
    expect(mean([])).toBeNaN();
    expect(median([])).toBeNaN();
    expect(stdev([5])).toBeNaN();
  });
});

describe('summarize', () => {
  it('reports n, mean, median, hit rate and t statistic', () => {
    const xs = Array.from({ length: 25 }, (_, i) => (i % 5 === 0 ? -1 : 2)); // 20 up, 5 down
    const s = summarize(xs);
    expect(s.n).toBe(25);
    expect(s.mean).toBeCloseTo((20 * 2 - 5) / 25, 10);
    expect(s.hitRate).toBeCloseTo(0.8, 10);
    expect(s.tStat).toBeCloseTo(s.mean / (stdev(xs) / 5), 10);
    expect(s.sufficient).toBe(true);
  });

  it('marks fewer than MIN_N observations insufficient', () => {
    expect(MIN_N).toBe(20);
    expect(summarize(Array.from({ length: 19 }, () => 1)).sufficient).toBe(false);
    expect(summarize(Array.from({ length: 20 }, (_, i) => i)).sufficient).toBe(true);
  });

  it('leaves t undefined when every value is identical', () => {
    expect(summarize([1, 1, 1, 1]).tStat).toBeNaN();
  });

  it('counts only gains as hits (zero is not a hit)', () => {
    expect(summarize([0, 0, 1, -1]).hitRate).toBe(0.25);
  });

  it('handles no data', () => {
    const s = summarize([]);
    expect(s.n).toBe(0);
    expect(s.hitRate).toBeNaN();
    expect(s.sufficient).toBe(false);
  });
});

describe('correlation', () => {
  it('finds perfect and inverse relationships', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 10);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 10);
  });

  it('is undefined with no spread or too few pairs', () => {
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNaN();
    expect(pearson([1, 2], [1, 2])).toBeNaN();
  });

  it('ranks ties by their average', () => {
    expect(ranks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
  });

  it('spearman sees monotonic but nonlinear relationships as perfect', () => {
    expect(spearman([1, 2, 3, 4, 5], [1, 4, 9, 16, 1000])).toBeCloseTo(1, 10);
  });
});

describe('topThirdThreshold', () => {
  it('is the score at the top-third boundary', () => {
    expect(topThirdThreshold([10, 20, 30, 40, 50, 60])).toBe(50); // top two of six
    expect(topThirdThreshold([10, 20, 30])).toBe(30);
  });

  it('includes ties at the boundary rather than splitting them', () => {
    const scores = [75, 75, 75, 75, 60, 50];
    const t = topThirdThreshold(scores);
    expect(t).toBe(75);
    expect(scores.filter((s) => s >= t)).toHaveLength(4);
  });

  it('is NaN with no scores', () => {
    expect(topThirdThreshold([])).toBeNaN();
  });
});

describe('histogram', () => {
  it('bins values and clamps outliers into the end bins so none are lost', () => {
    const bins = histogram([-50, -5, -4, 0, 3, 99], -10, 10, 5);
    // Bins: [-10,-5) [-5,0) [0,5) [5,10). -50 clamps into the first and 99 into the last.
    expect(bins.map((b) => b.count)).toEqual([1, 2, 2, 1]);
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(6);
  });

  it('has edges that tile the range', () => {
    const bins = histogram([], 0, 20, 5);
    expect(bins.map((b) => [b.from, b.to])).toEqual([[0, 5], [5, 10], [10, 15], [15, 20]]);
  });
});

describe('scoreBand', () => {
  it('groups a 0-100 score into ten-point bands, with 100 in the top band', () => {
    expect(scoreBand(0)).toBe('0-9');
    expect(scoreBand(73)).toBe('70-79');
    expect(scoreBand(89.9)).toBe('80-89');
    expect(scoreBand(90)).toBe('90-100');
    expect(scoreBand(100)).toBe('90-100');
  });
});

describe('rollingHitRate', () => {
  const DAY = 86_400_000;
  const at = (d: number) => Date.UTC(2026, 0, 1) + d * DAY;

  it('reports the hit rate of signals in the trailing window', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ at: at(i * 5), value: i % 2 ? 1 : -1 }));
    const pts = rollingHitRate(items, { windowDays: 30, stepDays: 10, minN: 3 });
    expect(pts.length).toBeGreaterThan(0);
    for (const p of pts) {
      expect(p.hitRate).toBeGreaterThanOrEqual(0);
      expect(p.hitRate).toBeLessThanOrEqual(1);
      expect(p.n).toBeGreaterThanOrEqual(3);
    }
  });

  it('skips windows with too few observations', () => {
    const items = [{ at: at(0), value: 1 }, { at: at(200), value: 1 }];
    expect(rollingHitRate(items, { windowDays: 30, stepDays: 10, minN: 2 })).toEqual([]);
  });

  it('is empty with no data', () => {
    expect(rollingHitRate([], { windowDays: 90, stepDays: 7, minN: 5 })).toEqual([]);
  });
});

describe('cumulative', () => {
  it('sums values in time order regardless of input order', () => {
    const out = cumulative([{ at: 3, value: 1 }, { at: 1, value: 5 }, { at: 2, value: -2 }]);
    expect(out).toEqual([{ at: 1, total: 5, n: 1 }, { at: 2, total: 3, n: 2 }, { at: 3, total: 4, n: 3 }]);
  });
});
