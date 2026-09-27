import { describe, expect, it } from 'vitest';
import type { AdjBar } from '@/lib/market/returns';
import { cumulativeExcess, nwLag, portfolioSeries, portfolioStats } from './portfolio';

const bar = (date: string, open: number, close: number): AdjBar => ({ date, adjOpen: open, adjClose: close });
// Benchmark: flat open->close on day 1, then +1% then -1% close to close.
const bench = [bar('d0', 100, 100), bar('d1', 100, 100), bar('d2', 100, 101), bar('d3', 101, 99.99)];

describe('portfolioSeries', () => {
  it('day 1 is open to close, later days close to close, both net of the benchmark', () => {
    const s = { id: 'a', costPct: 0, bars: [bar('d1', 100, 102), bar('d2', 102, 103.02)] };
    const out = portfolioSeries([s], bench, false);
    expect(out.map((p) => p.date)).toEqual(['d1', 'd2']);
    expect(out[0].excess).toBeCloseTo(2, 6); // +2% stock, 0% benchmark
    expect(out[1].excess).toBeCloseTo(1 - 1, 6); // +1% stock, +1% benchmark
  });

  it('averages signals held the same day, equal weight', () => {
    const a = { id: 'a', costPct: 0, bars: [bar('d1', 100, 104)] };
    const b = { id: 'b', costPct: 0, bars: [bar('d1', 100, 100)] };
    const [p] = portfolioSeries([a, b], bench, false);
    expect(p.n).toBe(2);
    expect(p.excess).toBeCloseTo(2, 6);
  });

  it('takes half the round-trip cost on the first and last day when net', () => {
    const s = { id: 'a', costPct: 1, bars: [bar('d1', 100, 100), bar('d2', 100, 101), bar('d3', 101, 99.99)] };
    const gross = portfolioSeries([s], bench, false).map((p) => p.excess);
    const net = portfolioSeries([s], bench, true).map((p) => p.excess);
    expect(net[0]).toBeCloseTo(gross[0] - 0.5, 6);
    expect(net[1]).toBeCloseTo(gross[1], 6);
    expect(net[2]).toBeCloseTo(gross[2] - 0.5, 6);
  });

  it('skips days the benchmark does not have and returns nothing for no signals', () => {
    expect(portfolioSeries([{ id: 'a', costPct: 0, bars: [bar('zz', 1, 2)] }], bench, false)).toEqual([]);
    expect(portfolioSeries([], bench, true)).toEqual([]);
  });
});

describe('portfolioStats', () => {
  const series = (xs: number[]) => xs.map((excess, i) => ({ date: `d${i}`, n: 2, excess }));

  it('with lag 0 it is the ordinary t statistic', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8];
    const s = portfolioStats(series(xs), 0)!;
    const m = 4.5;
    const varPop = xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length;
    expect(s.meanDaily).toBeCloseTo(m, 9);
    expect(s.t).toBeCloseTo(m / Math.sqrt(varPop / xs.length), 9);
    expect(s.annualised).toBeCloseTo(m * 252, 9);
    expect(s.avgHeld).toBe(2);
  });

  it('positive autocorrelation shrinks the t statistic', () => {
    const xs = [1, 1.2, 0.9, 1.1, -1, -1.2, -0.8, -1.1, 1, 1.1, 0.8, 1.2, -1, -0.9, -1.1, -1.2];
    const naive = portfolioStats(series(xs), 0)!.t;
    const robust = portfolioStats(series(xs), 4)!.t;
    expect(Math.abs(robust)).toBeLessThan(Math.abs(naive));
  });

  it('needs at least two days; a flat series has no t', () => {
    expect(portfolioStats(series([1]))).toBeNull();
    expect(portfolioStats(series([2, 2, 2]), 0)!.t).toBeNaN();
  });

  it('lag rule and cumulative sum', () => {
    expect(nwLag(100)).toBe(4);
    expect(nwLag(0)).toBe(0);
    expect(cumulativeExcess(series([1, -0.5, 2])).map((p) => p.value)).toEqual([1, 0.5, 2.5]);
  });
});
