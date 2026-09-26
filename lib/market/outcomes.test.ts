import { describe, expect, it } from 'vitest';
import type { MarketDay } from './calendar';
import { BENCHMARKS, HORIZONS, computeOutcomes } from './outcomes';
import type { AdjBar } from './returns';

// 12 weekday sessions starting Mon 2026-03-02.
const dates = ['02', '03', '04', '05', '06', '09', '10', '11', '12', '13', '16', '17'].map((d) => `2026-03-${d}`);
const days: MarketDay[] = dates.map((date) => ({ date, open: '09:30', close: '16:00' }));

/** A steady climb of 1%/day compounded from `start` (open = previous close). */
function series(start: number, dailyPct: number, upTo = dates.length): AdjBar[] {
  const out: AdjBar[] = [];
  let px = start;
  for (const date of dates.slice(0, upTo)) {
    const close = px * (1 + dailyPct / 100);
    out.push({ date, adjOpen: px, adjClose: close });
    px = close;
  }
  return out;
}

// Accepted 6pm ET Mon Mar 2 (EST: 23:00Z) -> enters Tue Mar 3's open.
const signalAt = new Date('2026-03-02T23:00:00Z');
const flat = series(100, 0);
const base = { signalAt, days, benchmarks: { SPY: series(100, 0.5), IWM: flat }, asOf: '2026-03-17' };

describe('computeOutcomes', () => {
  it('enters at the next open after acceptance', () => {
    expect(computeOutcomes({ ...base, stock: flat }).entryDate).toBe('2026-03-03');
  });

  it('produces a row for every horizon and benchmark', () => {
    const { rows } = computeOutcomes({ ...base, stock: flat });
    expect(rows).toHaveLength(HORIZONS.length * BENCHMARKS.length);
  });

  it('completes matured horizons with return, benchmark and excess', () => {
    const { rows } = computeOutcomes({ ...base, stock: series(100, 1) });
    const r = rows.find((x) => x.horizonDays === 5 && x.benchmarkTicker === 'SPY')!;
    expect(r.status).toBe('complete');
    expect(r.exitDate).toBe('2026-03-09'); // entry Mar 3 is day 1
    expect(r.returnPct).toBeGreaterThan(0);
    expect(r.excessReturnPct).toBeCloseTo(r.returnPct! - r.benchmarkReturnPct!, 10);
    expect(r.excessReturnPct).toBeGreaterThan(0); // 1%/day beats 0.5%/day
  });

  it('leaves horizons pending until their exit day has market data', () => {
    const { rows } = computeOutcomes({ ...base, stock: flat, asOf: '2026-03-06' });
    const five = rows.find((x) => x.horizonDays === 5)!;
    expect(five).toMatchObject({ status: 'pending', returnPct: null, exitDate: null });
  });

  it('leaves long horizons pending when the calendar is too short, and keeps short ones', () => {
    const { rows } = computeOutcomes({ ...base, stock: flat });
    expect(rows.find((x) => x.horizonDays === 5)?.status).toBe('complete');
    expect(rows.find((x) => x.horizonDays === 10)?.status).toBe('complete'); // day 10 = Mar 16
    expect(rows.find((x) => x.horizonDays === 30)?.status).toBe('pending');
  });

  it('keeps a signal whose ticker data ended, using the last available price', () => {
    // Bars stop after Mar 5; the 10-day exit is Mar 16.
    const { rows } = computeOutcomes({ ...base, stock: series(100, 1, 4) });
    const r = rows.find((x) => x.horizonDays === 10 && x.benchmarkTicker === 'SPY')!;
    expect(r.status).toBe('data_ended');
    expect(r.exitDate).toBe('2026-03-05');
    expect(r.returnPct).not.toBeNull();
    // Excess compares the benchmark over the same, shorter, dates.
    expect(r.benchmarkReturnPct).not.toBeNull();
  });

  it('treats a short gap in a thinly traded name as complete, carrying the last close forward', () => {
    const gap = series(100, 1).filter((b) => b.date !== '2026-03-09'); // no bar on the 5-day exit day
    const r = computeOutcomes({ ...base, stock: gap }).rows.find((x) => x.horizonDays === 5)!;
    expect(r.status).toBe('complete');
    expect(r.exitDate).toBe('2026-03-06');
  });

  it('marks outcomes data_ended with no returns when the ticker has no bars at entry', () => {
    const r = computeOutcomes({ ...base, stock: [] }).rows.find((x) => x.horizonDays === 5)!;
    expect(r).toMatchObject({ status: 'data_ended', returnPct: null, excessReturnPct: null });
  });

  it('is all pending when the filing is accepted after the last calendar day', () => {
    const late = computeOutcomes({ ...base, stock: flat, signalAt: new Date('2026-03-17T23:00:00Z') });
    expect(late.entryDate).toBeNull();
    expect(late.rows.every((r) => r.status === 'pending')).toBe(true);
  });

  it('records the max drawdown while held', () => {
    const dip = series(100, 1);
    dip[3] = { ...dip[3], adjClose: 90 }; // a crash mid-hold
    const r = computeOutcomes({ ...base, stock: dip }).rows.find((x) => x.horizonDays === 5)!;
    expect(r.maxDrawdownPct!).toBeLessThan(-5);
  });
});
