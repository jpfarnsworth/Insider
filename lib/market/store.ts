import { and, asc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { issuers, marketDays, priceBars, signals } from '@/db/schema';
import type { AlpacaClient, RawBar } from '@/lib/alpaca/client';
import { log } from '@/lib/log';
import { BENCHMARKS } from './outcomes';
import type { MarketDay } from './calendar';

const BATCH = 50;
const UPSERT_CHUNK = 1000;
/** Spec §3.3: a year of history before the first signal, for price context. */
const HISTORY_DAYS = 400;
const OVERLAP_DAYS = 7;
/** Relative change in adjClose/close that means a split or dividend restated history. */
const DRIFT = 1e-6;

const shift = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Alpaca writes share classes with a dot (BRK.B); SEC's ticker file uses a dash. */
export const toAlpacaSymbol = (ticker: string) => ticker.trim().toUpperCase().replaceAll('-', '.');

export async function loadCalendar(db: Db): Promise<MarketDay[]> {
  const rows = await db.select().from(marketDays).orderBy(asc(marketDays.date));
  return rows.map((r) => ({ date: r.date, open: r.open, close: r.close }));
}

/** Caches the trading calendar from two years back to well past the longest horizon. */
export async function refreshCalendar(db: Db, alpaca: AlpacaClient, today: string): Promise<number> {
  const days = await alpaca.getCalendar(shift(today, -3 * 365), shift(today, 220));
  for (let i = 0; i < days.length; i += UPSERT_CHUNK) {
    await db
      .insert(marketDays)
      .values(days.slice(i, i + UPSERT_CHUNK))
      .onConflictDoUpdate({ target: marketDays.date, set: { open: sql`excluded.open`, close: sql`excluded.close` } });
  }
  return days.length;
}

interface Needed {
  ticker: string;
  /** Earliest date of bars wanted (a year before the first signal). */
  from: string;
}

/** Tickers with signals, plus the benchmarks, and how far back each needs history. */
async function neededTickers(db: Db): Promise<Needed[]> {
  const rows = await db
    .select({ ticker: issuers.ticker, first: sql<string>`min(${signals.signalAt})::date::text` })
    .from(signals)
    .innerJoin(issuers, eq(issuers.cik, signals.issuerCik))
    .where(isNotNull(issuers.ticker))
    .groupBy(issuers.ticker);

  const byTicker = new Map<string, string>();
  let earliest: string | null = null;
  for (const r of rows) {
    const from = shift(r.first, -HISTORY_DAYS);
    const symbol = toAlpacaSymbol(r.ticker!);
    byTicker.set(symbol, byTicker.has(symbol) && byTicker.get(symbol)! < from ? byTicker.get(symbol)! : from);
    if (!earliest || from < earliest) earliest = from;
  }
  for (const b of BENCHMARKS) if (earliest) byTicker.set(b, earliest);
  return [...byTicker].map(([ticker, from]) => ({ ticker, from }));
}

const toRow = (ticker: string, raw: RawBar, adjClose: number) => ({
  ticker,
  date: raw.date,
  open: String(raw.open),
  high: String(raw.high),
  low: String(raw.low),
  close: String(raw.close),
  adjClose: String(adjClose),
  volume: raw.volume,
});

async function fetchAndStore(
  db: Db,
  alpaca: AlpacaClient,
  symbols: string[],
  start: string,
  end: string,
): Promise<{ through: string; stored: number }> {
  const [raw, adj] = await Promise.all([
    alpaca.getDailyBars(symbols, start, end, 'raw'),
    alpaca.getDailyBars(symbols, start, end, 'all'),
  ]);
  const through = raw.through < adj.through ? raw.through : adj.through;

  const rows: ReturnType<typeof toRow>[] = [];
  for (const [symbol, bars] of raw.bars) {
    const adjByDate = new Map((adj.bars.get(symbol) ?? []).map((b) => [b.date, b.close]));
    for (const b of bars) rows.push(toRow(symbol, b, adjByDate.get(b.date) ?? b.close));
  }
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    await db
      .insert(priceBars)
      .values(rows.slice(i, i + UPSERT_CHUNK))
      .onConflictDoUpdate({
        target: [priceBars.ticker, priceBars.date],
        set: {
          open: sql`excluded.open`,
          high: sql`excluded.high`,
          low: sql`excluded.low`,
          close: sql`excluded.close`,
          adjClose: sql`excluded.adj_close`,
          volume: sql`excluded.volume`,
        },
      });
  }
  return { through, stored: rows.length };
}

/** Tickers whose stored adjusted history no longer matches Alpaca's (a split or dividend since). */
async function driftedTickers(db: Db, alpaca: AlpacaClient, symbols: string[], from: string, end: string) {
  const [stored, fresh] = await Promise.all([
    db.select().from(priceBars).where(and(inArray(priceBars.ticker, symbols), gte(priceBars.date, from))),
    alpaca.getDailyBars(symbols, from, end, 'all'),
  ]);
  const freshAdj = new Map<string, number>();
  for (const [symbol, bars] of fresh.bars) for (const b of bars) freshAdj.set(`${symbol}|${b.date}`, b.close);

  const drifted = new Set<string>();
  for (const s of stored) {
    const now = freshAdj.get(`${s.ticker}|${s.date}`);
    if (now === undefined) continue;
    const before = Number(s.adjClose);
    if (Math.abs(now - before) > DRIFT * Math.max(Math.abs(before), 1)) drifted.add(s.ticker);
  }
  return drifted;
}

export interface PriceRefreshStats {
  tickers: number;
  bars: number;
  refetched: number;
  through: string | null;
}

/**
 * Daily bars for every ticker with a signal plus SPY and IWM (spec §3.3). Incremental:
 * only the recent days are fetched, unless a corporate action has restated the adjusted
 * history, in which case that ticker's whole history is refetched so returns stay consistent.
 */
export async function refreshPrices(db: Db, alpaca: AlpacaClient, today: string): Promise<PriceRefreshStats> {
  const needed = await neededTickers(db);
  const stats: PriceRefreshStats = { tickers: needed.length, bars: 0, refetched: 0, through: null };

  const lastRows = await db
    .select({ ticker: priceBars.ticker, last: sql<string>`max(${priceBars.date})`, first: sql<string>`min(${priceBars.date})` })
    .from(priceBars)
    .groupBy(priceBars.ticker);
  const stored = new Map(lastRows.map((r) => [r.ticker, r]));

  const note = (through: string) => {
    if (!stats.through || through < stats.through) stats.through = through;
  };

  for (let i = 0; i < needed.length; i += BATCH) {
    const batch = needed.slice(i, i + BATCH);
    const fresh = batch.filter((n) => !stored.has(n.ticker) || stored.get(n.ticker)!.first > n.from);
    const known = batch.filter((n) => !fresh.includes(n));

    // New tickers (or ones now needing older history): the full range.
    if (fresh.length) {
      const r = await fetchAndStore(db, alpaca, fresh.map((n) => n.ticker), fresh.reduce((m, n) => (n.from < m ? n.from : m), fresh[0].from), today);
      stats.bars += r.stored;
      note(r.through);
    }

    if (known.length) {
      const symbols = known.map((n) => n.ticker);
      const start = shift(known.reduce((m, n) => (stored.get(n.ticker)!.last < m ? stored.get(n.ticker)!.last : m), stored.get(known[0].ticker)!.last), -OVERLAP_DAYS);
      const drifted = await driftedTickers(db, alpaca, symbols, start, today);
      const r = await fetchAndStore(db, alpaca, symbols, start, today);
      stats.bars += r.stored;
      note(r.through);

      for (const t of drifted) {
        log('adjusted history restated, refetching', { ticker: t });
        const need = known.find((n) => n.ticker === t)!;
        const full = await fetchAndStore(db, alpaca, [t], need.from, today);
        stats.bars += full.stored;
        stats.refetched++;
      }
    }
    log('prices batch', { done: Math.min(i + BATCH, needed.length), of: needed.length });
  }
  return stats;
}
