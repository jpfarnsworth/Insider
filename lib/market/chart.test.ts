import { describe, expect, it } from 'vitest';
import { buildChart } from './chart';
import type { AdjBar } from './returns';

const dates = Array.from({ length: 140 }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10));
const flat = (px: number, skip: string[] = []): AdjBar[] =>
  dates.filter((d) => !skip.includes(d)).map((date) => ({ date, adjOpen: px, adjClose: px }));

describe('buildChart', () => {
  it('rebases both series to 100 at the entry-day open', () => {
    const stock = flat(50).map((b) => ({ ...b, adjClose: 55 })); // closes 10% above the 50 open
    const bench = flat(400).map((b) => ({ ...b, adjClose: 404 })); // 1% above
    const c = buildChart(stock, bench, dates[30])!;
    const p = c.points[c.entryIndex];
    expect(p.date).toBe(dates[30]);
    expect(p.stock).toBeCloseTo(110, 9);
    expect(p.bench).toBeCloseTo(101, 9);
  });

  it('spans 20 sessions before entry and up to the 90th after', () => {
    const c = buildChart(flat(10), flat(10), dates[30])!;
    expect(c.entryIndex).toBe(20);
    expect(c.points[0].date).toBe(dates[10]);
    expect(c.points.at(-1)?.date).toBe(dates[30 + 89]);
  });

  it('starts at the first session when entry is early in the history', () => {
    const c = buildChart(flat(10), flat(10), dates[5])!;
    expect(c.entryIndex).toBe(5);
    expect(c.points[0].date).toBe(dates[0]);
  });

  it('stops at the last available session when the holding period is still running', () => {
    const c = buildChart(flat(10), flat(10).slice(0, 45), dates[30])!;
    expect(c.points.at(-1)?.date).toBe(dates[44]);
  });

  it('leaves a gap on days the stock has no bar', () => {
    const c = buildChart(flat(10, [dates[32]]), flat(10), dates[30])!;
    expect(c.points.find((p) => p.date === dates[32])?.stock).toBeNull();
    expect(c.points.find((p) => p.date === dates[32])?.bench).toBe(100);
  });

  it('is null without an entry day or without a stock bar to enter on', () => {
    expect(buildChart(flat(10), flat(10), '2030-01-01')).toBeNull();
    expect(buildChart(flat(10, [dates[30]]), flat(10), dates[30])).toBeNull();
  });
});
