import { asc, eq } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { priceBars, signalOutcomes } from '@/db/schema';
import { getSetting } from '@/lib/settings';
import { buildChart, type ChartData } from './chart';
import { averageDollarVolume, COSTS_KEY, costsSchema, roundTripCostPct } from './costs';
import { toAdjBars } from './returns';
import { toAlpacaSymbol } from './store';

const VOLUME_SESSIONS = 30;

export interface HorizonRow {
  horizonDays: number;
  status: 'pending' | 'complete' | 'data_ended';
  exitDate: string | null;
  returnPct: number | null;
  netReturnPct: number | null;
  /** Gross return minus the benchmark's over the same dates. */
  excess: Record<string, number | null>;
  maxDrawdownPct: number | null;
}

export interface SignalPerformance {
  horizons: HorizonRow[];
  costPct: number;
  chart: ChartData | null;
}

const num = (v: string | null) => (v === null ? null : Number(v));

/** Forward returns (gross and net of costs) and the price chart for one signal. */
export async function loadSignalPerformance(
  db: Db,
  signal: { id: string; ticker: string | null; entryDate: string | null },
): Promise<SignalPerformance> {
  const [rows, costs] = await Promise.all([
    db.select().from(signalOutcomes).where(eq(signalOutcomes.signalId, signal.id)).orderBy(asc(signalOutcomes.horizonDays)),
    getSetting(db, COSTS_KEY, costsSchema),
  ]);

  const symbol = signal.ticker ? toAlpacaSymbol(signal.ticker) : null;
  const loadBars = (ticker: string) =>
    db.select().from(priceBars).where(eq(priceBars.ticker, ticker)).orderBy(asc(priceBars.date));
  const [stockRows, spyRows] = await Promise.all([symbol ? loadBars(symbol) : Promise.resolve([]), loadBars('SPY')]);

  const numeric = (r: (typeof stockRows)[number]) => ({
    date: r.date,
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: r.volume,
    adjClose: Number(r.adjClose),
  });
  const stock = stockRows.map(numeric);

  const before = signal.entryDate ? stock.filter((b) => b.date < signal.entryDate!).slice(-VOLUME_SESSIONS) : [];
  const costPct = roundTripCostPct(averageDollarVolume(before), costs);

  const byHorizon = new Map<number, HorizonRow>();
  for (const r of rows) {
    const row =
      byHorizon.get(r.horizonDays) ??
      ({
        horizonDays: r.horizonDays,
        status: r.status,
        exitDate: r.exitDate,
        returnPct: num(r.returnPct),
        netReturnPct: num(r.returnPct) === null ? null : num(r.returnPct)! - costPct,
        excess: {},
        maxDrawdownPct: num(r.maxDrawdownPct),
      } satisfies HorizonRow);
    row.excess[r.benchmarkTicker] = num(r.excessReturnPct);
    byHorizon.set(r.horizonDays, row);
  }

  const chart = signal.entryDate && stock.length && spyRows.length
    ? buildChart(toAdjBars(stock), toAdjBars(spyRows.map(numeric)), signal.entryDate)
    : null;

  return { horizons: [...byHorizon.values()], costPct, chart };
}

