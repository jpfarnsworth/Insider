import { sql } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { roundTripCostPct, type Costs } from '@/lib/market/costs';
import { toAdjBars, type AdjBar } from '@/lib/market/returns';
import { cumulativeExcess, portfolioSeries, portfolioStats, type HeldSignal, type PortfolioStats } from './portfolio';

export interface PortfolioResult {
  stats: PortfolioStats | null;
  /** Cumulative excess return, percent points, one per day the portfolio held something. */
  cumulative: Array<{ date: string; value: number }>;
  /** Signals that could be included (had a ticker, an entry and bars). */
  signals: number;
}

/**
 * Builds the calendar-time portfolio for the given signals. Reads only the `holdDays` bars after
 * each signal's entry (about 50k rows for the whole book), not every stored bar.
 */
export async function loadPortfolio(
  db: Db,
  opts: { signalIds: string[]; benchmark: 'SPY' | 'IWM'; holdDays: number; net: boolean; costs: Costs },
): Promise<PortfolioResult> {
  if (!opts.signalIds.length) return { stats: null, cumulative: [], signals: 0 };
  // Drizzle expands a JS array into a parameter list, so build the IN (...) list explicitly.
  const ids = sql.join(opts.signalIds.map((id) => sql`${id}`), sql`, `);

  const [rows, benchRows, advRows] = await Promise.all([
    db.execute<{ signal_id: string; date: string; open: string; close: string; adj_close: string }>(sql`
      select s.id as signal_id, b.date, b.open, b.close, b.adj_close
      from signals s
      join issuers i on i.cik = s.issuer_cik
      cross join lateral (
        select pb.date, pb.open, pb.close, pb.adj_close from price_bars pb
        where pb.ticker = replace(upper(trim(i.ticker)), '-', '.') and pb.date >= s.entry_date
        order by pb.date limit ${opts.holdDays}
      ) b
      where s.id in (${ids}) and s.entry_date is not null and i.ticker is not null
      order by s.id, b.date`),
    db.execute<{ date: string; open: string; close: string; adj_close: string }>(sql`
      select date, open, close, adj_close from price_bars where ticker = ${opts.benchmark} order by date`),
    db.execute<{ id: string; adv: string | null }>(sql`select id, avg_dollar_volume as adv from signals where id in (${ids})`),
  ]);

  const toBars = (r: Array<{ date: string; open: string; close: string; adj_close: string }>): AdjBar[] =>
    toAdjBars(r.map((x) => ({ date: x.date, open: Number(x.open), high: 0, low: 0, close: Number(x.close), volume: 0, adjClose: Number(x.adj_close) })));

  const adv = new Map(advRows.rows.map((r) => [r.id, r.adv === null ? null : Number(r.adv)]));
  const bySignal = new Map<string, typeof rows.rows>();
  for (const r of rows.rows) bySignal.set(r.signal_id, [...(bySignal.get(r.signal_id) ?? []), r]);

  const held: HeldSignal[] = [...bySignal].map(([id, list]) => ({
    id,
    bars: toBars(list),
    costPct: roundTripCostPct(adv.get(id) ?? null, opts.costs),
  }));

  const series = portfolioSeries(held, toBars(benchRows.rows), opts.net);
  return { stats: portfolioStats(series), cumulative: cumulativeExcess(series), signals: held.length };
}
