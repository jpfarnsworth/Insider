import { describe, expect, it } from 'vitest';
import { holdingReturn, toAdjBars, type AdjBar } from './returns';

const bar = (date: string, adjOpen: number, adjClose: number): AdjBar => ({ date, adjOpen, adjClose });

describe('toAdjBars', () => {
  it("scales the open by the day's adjustment factor and sorts by date", () => {
    const out = toAdjBars([
      { date: '2026-01-05', open: 100, high: 0, low: 0, close: 100, volume: 1, adjClose: 50 }, // 2:1 split later
      { date: '2026-01-02', open: 90, high: 0, low: 0, close: 80, volume: 1, adjClose: 40 },
    ]);
    expect(out).toEqual([
      { date: '2026-01-02', adjOpen: 45, adjClose: 40 },
      { date: '2026-01-05', adjOpen: 50, adjClose: 50 },
    ]);
  });

  it('drops bars with no valid close', () => {
    expect(toAdjBars([{ date: '2026-01-02', open: 1, high: 1, low: 1, close: 0, volume: 0, adjClose: 0 }])).toEqual([]);
  });
});

describe('holdingReturn', () => {
  const bars = [
    bar('2026-03-02', 100, 105),
    bar('2026-03-03', 105, 110), // peak
    bar('2026-03-04', 109, 99), // drawdown -10% from 110
    bar('2026-03-05', 100, 108),
  ];

  it('is exit close over entry open', () => {
    const r = holdingReturn(bars, '2026-03-02', '2026-03-05')!;
    expect(r.entryPrice).toBe(100);
    expect(r.exitPrice).toBe(108);
    expect(r.returnPct).toBeCloseTo(8, 10);
  });

  it('measures max drawdown from the running peak', () => {
    expect(holdingReturn(bars, '2026-03-02', '2026-03-05')!.maxDrawdownPct).toBeCloseTo(-10, 10);
  });

  it('starts the peak at the entry price, so an immediate fall counts', () => {
    const r = holdingReturn([bar('2026-03-02', 100, 90), bar('2026-03-03', 90, 95)], '2026-03-02', '2026-03-03')!;
    expect(r.maxDrawdownPct).toBeCloseTo(-10, 10);
  });

  it('reports zero drawdown for a steady climb', () => {
    const r = holdingReturn([bar('2026-03-02', 100, 101), bar('2026-03-03', 101, 103)], '2026-03-02', '2026-03-03')!;
    expect(r.maxDrawdownPct).toBe(0);
  });

  it('can be a loss', () => {
    expect(holdingReturn(bars, '2026-03-02', '2026-03-04')!.returnPct).toBeCloseTo(-1, 10);
  });

  it('uses the latest bar on or before the exit day when the exit day has no bar', () => {
    const r = holdingReturn(bars, '2026-03-02', '2026-03-06')!;
    expect(r.exitDate).toBe('2026-03-05');
  });

  it('cannot enter on a day with no bar', () => {
    expect(holdingReturn(bars, '2026-03-01', '2026-03-05')).toBeNull();
  });

  it('is unaffected by a later split because prices are adjusted', () => {
    // 2:1 split on 03-04: post-split bars are on the same adjusted scale as the pre-split ones.
    const split = toAdjBars([
      { date: '2026-03-02', open: 100, high: 0, low: 0, close: 100, volume: 1, adjClose: 50 },
      { date: '2026-03-04', open: 55, high: 0, low: 0, close: 60, volume: 1, adjClose: 60 },
    ]);
    expect(holdingReturn(split, '2026-03-02', '2026-03-04')!.returnPct).toBeCloseTo(20, 10);
  });
});
