import { and, asc, eq, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { clusterTransactions, filingOwners, filings, issuers, priceBars, signals, transactions } from '@/db/schema';
import { etDate } from '@/lib/market/asof';
import { toAlpacaSymbol } from '@/lib/market/store';
import { loadClusterRule } from '@/lib/clusters/store';
import { getRevision, getSetting } from '@/lib/settings';
import {
  BASELINE_VERSION,
  BASELINE_WEIGHTS_KEY,
  baselineScore,
  baselineWeightsSchema,
  type BaselineInsider,
} from './baseline';

const CHUNK = 200;
const SELL_LOOKBACK_DAYS = 90;
const DAY_MS = 86_400_000;
const HIGH_LOOKBACK_DAYS = 365;

/**
 * How far below its 52-week high the stock last closed before the signal. Only bars
 * strictly before the signal's Eastern calendar day are used, so nothing after the
 * signal time can leak in (even if the filing came in after that day's close).
 */
async function drawdownFrom52wHigh(db: Db, ticker: string | null, signalAt: Date): Promise<number | null> {
  if (!ticker) return null;
  const day = etDate(signalAt);
  const from = etDate(new Date(signalAt.getTime() - HIGH_LOOKBACK_DAYS * DAY_MS));
  const bars = await db
    .select({ date: priceBars.date, adjClose: priceBars.adjClose })
    .from(priceBars)
    .where(and(eq(priceBars.ticker, toAlpacaSymbol(ticker)), gte(priceBars.date, from), lt(priceBars.date, day)))
    .orderBy(asc(priceBars.date));
  if (bars.length < 20) return null; // too little history to say what the high was
  const high = Math.max(...bars.map((b) => Number(b.adjClose)));
  const last = Number(bars.at(-1)!.adjClose);
  return high > 0 ? Math.max(0, 1 - last / high) : null;
}

/**
 * Scores signals that have no baseline score or an older formula version (all of
 * them with `force`). Everything is read as of the signal time: only sales in
 * filings accepted by then count, so scoring a past signal later can't peek ahead.
 */
export async function scoreBaseline(db: Db, opts: { force?: boolean } = {}): Promise<{ scored: number }> {
  const [rule, weights, revision] = await Promise.all([
    loadClusterRule(db),
    getSetting(db, BASELINE_WEIGHTS_KEY, baselineWeightsSchema),
    getRevision(db, BASELINE_WEIGHTS_KEY),
  ]);

  const todo = await db
    .select({
      id: signals.id,
      clusterId: signals.clusterId,
      issuerCik: signals.issuerCik,
      signalAt: signals.signalAt,
      marketCap: issuers.marketCap,
      ticker: issuers.ticker,
    })
    .from(signals)
    .innerJoin(issuers, eq(issuers.cik, signals.issuerCik))
    .where(opts.force ? undefined : or(isNull(signals.baselineVersion), lt(signals.baselineVersion, BASELINE_VERSION)));

  let scored = 0;
  for (let i = 0; i < todo.length; i += CHUNK) {
    const chunk = todo.slice(i, i + CHUNK);

    const members = await db
      .select({
        clusterId: clusterTransactions.clusterId,
        insiderCik: transactions.insiderCik,
        shares: transactions.shares,
        price: transactions.price,
        date: transactions.transactionDate,
        sharesOwnedAfter: transactions.sharesOwnedAfter,
        isOfficer: filingOwners.isOfficer,
        officerTitle: filingOwners.officerTitle,
        isDirector: filingOwners.isDirector,
      })
      .from(clusterTransactions)
      .innerJoin(transactions, eq(transactions.id, clusterTransactions.transactionId))
      .leftJoin(
        filingOwners,
        and(eq(filingOwners.filingId, transactions.filingId), eq(filingOwners.insiderCik, transactions.insiderCik)),
      )
      .where(inArray(clusterTransactions.clusterId, chunk.map((s) => s.clusterId)));

    for (const s of chunk) {
      const mine = members.filter((m) => m.clusterId === s.clusterId);

      const byInsider = new Map<string, typeof mine>();
      for (const m of mine) byInsider.set(m.insiderCik, [...(byInsider.get(m.insiderCik) ?? []), m]);

      const insiders: BaselineInsider[] = [];
      let totalValue = 0;
      for (const rows of byInsider.values()) {
        const value = rows.reduce((sum, r) => sum + Number(r.shares) * Number(r.price), 0);
        if (value < rule.minPerInsiderValue) continue; // doesn't count toward the cluster
        totalValue += value;
        const latest = [...rows].sort((a, b) => a.date.localeCompare(b.date)).at(-1)!;
        insiders.push({
          isOfficer: rows.some((r) => r.isOfficer),
          officerTitle: rows.find((r) => r.officerTitle)?.officerTitle ?? null,
          isDirector: rows.some((r) => r.isDirector),
          sharesBought: rows.reduce((sum, r) => sum + Number(r.shares), 0),
          sharesOwnedAfter: latest.sharesOwnedAfter === null ? null : Number(latest.sharesOwnedAfter),
        });
      }

      const since = new Date(s.signalAt.getTime() - SELL_LOOKBACK_DAYS * DAY_MS).toISOString().slice(0, 10);
      const [{ sold }] = await db
        .select({ sold: sql<string>`coalesce(sum(${transactions.shares} * ${transactions.price}), 0)` })
        .from(transactions)
        .innerJoin(filings, eq(filings.id, transactions.filingId))
        .where(
          and(
            eq(transactions.issuerCik, s.issuerCik),
            eq(transactions.code, 'S'),
            eq(transactions.acquiredDisposed, 'D'),
            eq(transactions.isDerivative, false),
            sql`${transactions.transactionDate} >= ${since}`,
            lte(filings.acceptedAt, s.signalAt),
            eq(filings.parseStatus, 'parsed'),
            sql`${transactions.insiderCik} not in (select ${transactions.insiderCik} from ${clusterTransactions} ct join ${transactions} t2 on t2.id = ct.transaction_id where ct.cluster_id = ${s.clusterId})`,
          ),
        );

      const result = baselineScore(
        {
          insiders,
          totalValue,
          marketCap: s.marketCap === null ? null : Number(s.marketCap),
          priorSaleValue: Number(sold),
          drawdownFrom52wHigh: await drawdownFrom52wHigh(db, s.ticker, s.signalAt),
        },
        weights,
      );
      await db
        .update(signals)
        .set({ baselineScore: String(result.score), baselineVersion: result.version, baselineRevision: revision, baselineBreakdown: result })
        .where(eq(signals.id, s.id));
      scored++;
    }
  }
  return { scored };
}
