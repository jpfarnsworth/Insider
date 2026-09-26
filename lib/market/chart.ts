import type { AdjBar } from './returns';

export interface ChartPoint {
  date: string;
  /** Index level: 100 = the entry day's open. null on days the stock has no bar. */
  stock: number | null;
  bench: number | null;
}

export interface ChartData {
  points: ChartPoint[];
  /** Index into `points` of the entry day. */
  entryIndex: number;
}

const BEFORE = 20;
const AFTER = 90;

/**
 * Stock and benchmark closes rebased so each equals 100 at its entry-day open, over
 * the 20 sessions before entry to the 90th session after. The benchmark's own dates
 * are the x axis (it trades every session); a day the stock has no bar is a gap.
 * null when there is no entry day in the benchmark's history.
 */
export function buildChart(stock: AdjBar[], bench: AdjBar[], entryDate: string): ChartData | null {
  const entryIdx = bench.findIndex((b) => b.date === entryDate);
  const stockEntry = stock.find((b) => b.date === entryDate);
  if (entryIdx === -1 || !stockEntry || stockEntry.adjOpen <= 0) return null;

  const benchBase = bench[entryIdx].adjOpen;
  const stockByDate = new Map(stock.map((b) => [b.date, b.adjClose]));
  const from = Math.max(0, entryIdx - BEFORE);
  const to = Math.min(bench.length - 1, entryIdx + AFTER - 1);

  const points = bench.slice(from, to + 1).map((b) => {
    const s = stockByDate.get(b.date);
    return {
      date: b.date,
      stock: s === undefined ? null : (s / stockEntry.adjOpen) * 100,
      bench: (b.adjClose / benchBase) * 100,
    };
  });
  return { points, entryIndex: entryIdx - from };
}
