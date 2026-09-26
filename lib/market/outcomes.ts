import { entryDay, horizonDay, type MarketDay } from './calendar';
import { holdingReturn, type AdjBar } from './returns';

// Spec §7: exit at the close on these trading days after entry; SPY is the default
// benchmark and IWM the small-cap alternative. Both are stored.
export const HORIZONS = [5, 10, 30, 60, 90] as const;
export const BENCHMARKS = ['SPY', 'IWM'] as const;

/** A last bar this many calendar days before the exit day means the ticker's data stopped (delisting, halt). */
const STALE_DAYS = 7;

export type OutcomeStatus = 'pending' | 'complete' | 'data_ended';

export interface OutcomeRow {
  horizonDays: number;
  benchmarkTicker: string;
  status: OutcomeStatus;
  exitDate: string | null;
  exitPrice: number | null;
  returnPct: number | null;
  benchmarkReturnPct: number | null;
  excessReturnPct: number | null;
  maxDrawdownPct: number | null;
}

export interface SignalOutcomes {
  entryDate: string | null;
  rows: OutcomeRow[];
}

export interface OutcomeInput {
  signalAt: Date;
  /** Trading calendar, ascending. */
  days: MarketDay[];
  stock: AdjBar[];
  benchmarks: Record<string, AdjBar[]>;
  /** Latest date we have market data for: horizons that end later are still pending. */
  asOf: string;
}

const daysBetween = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;

const pendingRow = (horizonDays: number, benchmarkTicker: string): OutcomeRow => ({
  horizonDays,
  benchmarkTicker,
  status: 'pending',
  exitDate: null,
  exitPrice: null,
  returnPct: null,
  benchmarkReturnPct: null,
  excessReturnPct: null,
  maxDrawdownPct: null,
});

/**
 * Forward returns for one signal at every horizon and benchmark. All timing keys off
 * the filing's acceptance time (via the entry day), never the transaction date.
 * A horizon is pending until its exit day has market data; if the ticker's own data
 * ended before then, the outcome is kept as `data_ended` with the last available
 * price, never dropped (spec §3.3).
 */
export function computeOutcomes(input: OutcomeInput): SignalOutcomes {
  const entry = entryDay(input.days, input.signalAt);
  const tickers = Object.keys(input.benchmarks);
  const rows: OutcomeRow[] = [];

  for (const horizon of HORIZONS) {
    const exit = entry ? horizonDay(input.days, entry.date, horizon) : null;
    if (!entry || !exit || exit.date > input.asOf) {
      for (const b of tickers) rows.push(pendingRow(horizon, b));
      continue;
    }

    const stock = holdingReturn(input.stock, entry.date, exit.date);
    const stale = !stock || daysBetween(stock.exitDate, exit.date) > STALE_DAYS;

    for (const b of tickers) {
      const bench = stock ? holdingReturn(input.benchmarks[b], entry.date, stock.exitDate) : null;
      rows.push({
        horizonDays: horizon,
        benchmarkTicker: b,
        status: stale ? 'data_ended' : 'complete',
        exitDate: stock?.exitDate ?? null,
        exitPrice: stock?.exitPrice ?? null,
        returnPct: stock?.returnPct ?? null,
        benchmarkReturnPct: bench?.returnPct ?? null,
        excessReturnPct: stock && bench ? stock.returnPct - bench.returnPct : null,
        maxDrawdownPct: stock?.maxDrawdownPct ?? null,
      });
    }
  }
  return { entryDate: entry?.date ?? null, rows };
}
