import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { filings, insiders, issuers, priceBars, transactions } from '@/db/schema';
import { loadCalendar, toAlpacaSymbol } from './store';
import { computeOutcomes } from './outcomes';
import { toAdjBars } from './returns';

export interface PurchaseOutcome {
  transactionId: string;
  issuerCik: string;
  ticker: string | null;
  issuer: string;
  date: string;
  shares: number;
  price: number;
  value: number;
  filingUrl: string;
  status30: 'pending' | 'complete' | 'data_ended' | 'no_prices';
  excess30: number | null;
  status90: 'pending' | 'complete' | 'data_ended' | 'no_prices';
  excess90: number | null;
}

/**
 * Every open-market purchase by an insider with 30- and 90-day forward returns against SPY, timed
 * exactly like a signal: entry at the next open after the filing was accepted. Prices are stored
 * for tickers that have a signal, so purchases elsewhere show `no_prices` rather than a made-up number.
 */
export async function loadInsiderTrackRecord(db: Db, insiderCik: string): Promise<PurchaseOutcome[]> {
  const purchases = await db
    .select({
      id: transactions.id,
      issuerCik: transactions.issuerCik,
      ticker: issuers.ticker,
      issuer: issuers.name,
      date: transactions.transactionDate,
      shares: transactions.shares,
      price: transactions.price,
      value: transactions.value,
      acceptedAt: filings.acceptedAt,
      url: filings.url,
    })
    .from(transactions)
    .innerJoin(filings, eq(filings.id, transactions.filingId))
    .innerJoin(issuers, eq(issuers.cik, transactions.issuerCik))
    .where(and(eq(transactions.insiderCik, insiderCik), eq(transactions.code, 'P'), eq(transactions.isDerivative, false), eq(filings.parseStatus, 'parsed')))
    .orderBy(desc(transactions.transactionDate))
    .limit(200);
  if (!purchases.length) return [];

  const symbols = [...new Set([...purchases.flatMap((p) => (p.ticker ? [toAlpacaSymbol(p.ticker)] : [])), 'SPY'])];
  const [days, rows] = await Promise.all([loadCalendar(db), db.select().from(priceBars).where(inArray(priceBars.ticker, symbols)).orderBy(asc(priceBars.date))]);

  const byTicker = new Map<string, typeof rows>();
  for (const r of rows) byTicker.set(r.ticker, [...(byTicker.get(r.ticker) ?? []), r]);
  const adj = (t: string) =>
    toAdjBars((byTicker.get(t) ?? []).map((r) => ({ date: r.date, open: Number(r.open), high: Number(r.high), low: Number(r.low), close: Number(r.close), volume: r.volume, adjClose: Number(r.adjClose) })));
  const spy = adj('SPY');
  const asOf = spy.at(-1)?.date;

  return purchases.map((p) => {
    const base = {
      transactionId: p.id,
      issuerCik: p.issuerCik,
      ticker: p.ticker,
      issuer: p.issuer,
      date: p.date,
      shares: Number(p.shares),
      price: Number(p.price),
      value: Number(p.value),
      filingUrl: p.url,
    };
    const stock = p.ticker ? adj(toAlpacaSymbol(p.ticker)) : [];
    if (!stock.length || !asOf || !days.length) return { ...base, status30: 'no_prices', excess30: null, status90: 'no_prices', excess90: null } as PurchaseOutcome;

    const { rows: o } = computeOutcomes({ signalAt: p.acceptedAt, days, stock, benchmarks: { SPY: spy }, asOf });
    const at = (h: number) => o.find((r) => r.horizonDays === h && r.benchmarkTicker === 'SPY')!;
    return { ...base, status30: at(30).status, excess30: at(30).excessReturnPct, status90: at(90).status, excess90: at(90).excessReturnPct };
  });
}

export async function insiderName(db: Db, cik: string): Promise<string | null> {
  const [row] = await db.select({ name: insiders.name }).from(insiders).where(eq(insiders.cik, cik)).limit(1);
  return row?.name ?? null;
}
