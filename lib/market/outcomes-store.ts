import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { issuers, priceBars, signalOutcomes, signals } from '@/db/schema';
import { loadCalendar, toAlpacaSymbol } from './store';
import { BENCHMARKS, computeOutcomes, type OutcomeRow } from './outcomes';
import { toAdjBars, type AdjBar } from './returns';

const CHUNK = 100;
const fixed = (n: number | null) => (n === null ? null : n.toFixed(6));
const same = (a: string | null, b: string | null) => (a === null || b === null ? a === b : Number(a) === Number(b));

async function loadBars(db: Db, tickers: string[]): Promise<Map<string, { adj: AdjBar[]; rawOpen: Map<string, string> }>> {
  const rows = await db.select().from(priceBars).where(inArray(priceBars.ticker, tickers)).orderBy(asc(priceBars.date));
  const byTicker = new Map<string, typeof rows>();
  for (const r of rows) byTicker.set(r.ticker, [...(byTicker.get(r.ticker) ?? []), r]);

  const out = new Map<string, { adj: AdjBar[]; rawOpen: Map<string, string> }>();
  for (const [ticker, list] of byTicker) {
    out.set(ticker, {
      adj: toAdjBars(
        list.map((r) => ({
          date: r.date,
          open: Number(r.open),
          high: Number(r.high),
          low: Number(r.low),
          close: Number(r.close),
          volume: r.volume,
          adjClose: Number(r.adjClose),
        })),
      ),
      rawOpen: new Map(list.map((r) => [r.date, r.open])),
    });
  }
  return out;
}

export interface OutcomeStats {
  signals: number;
  rowsWritten: number;
  dataEnded: number;
  asOf: string | null;
}

/**
 * Fills every signal's forward returns from the stored bars (spec §7). Recomputes
 * everything and writes only what changed, so it is idempotent and also corrects
 * returns when adjusted prices have been restated.
 */
export async function computeAndStoreOutcomes(db: Db): Promise<OutcomeStats> {
  const [days, bench] = await Promise.all([loadCalendar(db), loadBars(db, [...BENCHMARKS])]);
  const spy = bench.get('SPY')?.adj ?? [];
  const asOf = spy.at(-1)?.date ?? null;
  const stats: OutcomeStats = { signals: 0, rowsWritten: 0, dataEnded: 0, asOf };
  if (!asOf || !days.length) return stats;

  const benchmarks = Object.fromEntries(BENCHMARKS.map((b) => [b, bench.get(b)?.adj ?? []]));
  const all = await db
    .select({
      id: signals.id,
      signalAt: signals.signalAt,
      status: signals.status,
      entryDate: signals.entryDate,
      entryPrice: signals.entryPrice,
      ticker: issuers.ticker,
    })
    .from(signals)
    .innerJoin(issuers, eq(issuers.cik, signals.issuerCik));
  stats.signals = all.length;

  for (let i = 0; i < all.length; i += CHUNK) {
    const chunk = all.slice(i, i + CHUNK);
    const symbols = [...new Set(chunk.filter((s) => s.ticker).map((s) => toAlpacaSymbol(s.ticker!)))];
    const [bars, existing] = await Promise.all([
      symbols.length ? loadBars(db, symbols) : Promise.resolve(new Map()),
      db.select().from(signalOutcomes).where(inArray(signalOutcomes.signalId, chunk.map((s) => s.id))),
    ]);
    const have = new Map(existing.map((r) => [`${r.signalId}|${r.horizonDays}|${r.benchmarkTicker}`, r]));

    for (const s of chunk) {
      const own = s.ticker ? bars.get(toAlpacaSymbol(s.ticker)) : undefined;
      const result = computeOutcomes({ signalAt: s.signalAt, days, stock: own?.adj ?? [], benchmarks, asOf });

      const changed: OutcomeRow[] = result.rows.filter((r) => {
        const old = have.get(`${s.id}|${r.horizonDays}|${r.benchmarkTicker}`);
        return (
          !old ||
          old.status !== r.status ||
          old.exitDate !== r.exitDate ||
          !same(old.returnPct, fixed(r.returnPct)) ||
          !same(old.benchmarkReturnPct, fixed(r.benchmarkReturnPct)) ||
          !same(old.maxDrawdownPct, fixed(r.maxDrawdownPct))
        );
      });
      for (const r of changed) {
        const values = {
          signalId: s.id,
          horizonDays: r.horizonDays,
          benchmarkTicker: r.benchmarkTicker,
          status: r.status,
          exitDate: r.exitDate,
          exitPrice: fixed(r.exitPrice),
          returnPct: fixed(r.returnPct),
          benchmarkReturnPct: fixed(r.benchmarkReturnPct),
          excessReturnPct: fixed(r.excessReturnPct),
          maxDrawdownPct: fixed(r.maxDrawdownPct),
        };
        await db
          .insert(signalOutcomes)
          .values(values)
          .onConflictDoUpdate({
            target: [signalOutcomes.signalId, signalOutcomes.horizonDays, signalOutcomes.benchmarkTicker],
            set: values,
          });
        stats.rowsWritten++;
      }

      const ended = result.rows.some((r) => r.status === 'data_ended');
      if (ended) stats.dataEnded++;
      const entryPrice = result.entryDate ? (own?.rawOpen.get(result.entryDate) ?? null) : null;
      const status = s.status === 'amended' ? s.status : ended ? 'data_ended' : 'active';
      if (s.entryDate !== result.entryDate || s.entryPrice !== entryPrice || s.status !== status) {
        await db.update(signals).set({ entryDate: result.entryDate, entryPrice, status }).where(and(eq(signals.id, s.id)));
      }
    }
  }
  return stats;
}
