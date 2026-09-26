import { roleOf } from '@/lib/scoring/baseline';
import { etDate } from '@/lib/market/asof';
import type { EightKList } from './eightk';

// The input bundle (spec §5.2) is assembled here in code from data as of the signal date;
// the model never fetches anything itself. Caps keep the token count, and the amount of
// untrusted filing text passed to the model, bounded.
const MAX_FOOTNOTES = 3;
const MAX_FOOTNOTE_CHARS = 600;
const MAX_RECENT_PER_INSIDER = 25;
const HISTORY_YEARS = 3;
const SESSIONS = { m1: 21, m3: 63, m12: 252, liquidity: 30 } as const;

export interface PurchaseRow {
  insiderCik: string;
  insider: string;
  isOfficer: boolean | null;
  officerTitle: string | null;
  isDirector: boolean | null;
  isTenPctOwner: boolean | null;
  transactionDate: string;
  shares: number;
  price: number;
  sharesOwnedAfter: number | null;
  ownership: 'D' | 'I' | null;
  acceptedAt: Date;
  footnotes: string[];
}

export interface HistoryRow {
  insiderCik: string;
  insider: string;
  transactionDate: string;
  code: string;
  acquiredDisposed: 'A' | 'D' | null;
  shares: number | null;
  price: number | null;
  isDerivative: boolean;
}

export interface BarRow {
  date: string;
  close: number;
  adjClose: number;
  volume: number;
}

export interface BundleInput {
  signalAt: Date;
  issuer: { name: string; ticker: string | null; industry: string | null; marketCap: number | null };
  cluster: { windowStart: string; windowEnd: string; insiderCount: number; totalValue: number };
  purchases: PurchaseRow[];
  /** The cluster insiders' other transactions in this issuer, accepted before the signal. */
  history: HistoryRow[];
  /** Sales by insiders outside the cluster in the 90 days before the signal. */
  otherSales: { count: number; totalValue: number };
  /** Bars strictly before the signal's Eastern day, ascending. */
  bars: BarRow[];
  /** null = the SEC request failed. */
  eightKs: EightKList | null;
}

const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;
const money = (n: number) => Math.round(n);

export function priceContext(bars: BarRow[]) {
  const last = bars.at(-1);
  if (!last) return null;
  const back = (n: number) => (bars.length > n ? bars[bars.length - 1 - n] : null);
  const ret = (n: number) => {
    const from = back(n);
    return from && from.adjClose > 0 ? round((last.adjClose / from.adjClose - 1) * 100) : null;
  };
  const year = bars.slice(-SESSIONS.m12);
  const high = Math.max(...year.map((b) => b.adjClose));
  const liquid = bars.slice(-SESSIONS.liquidity);
  return {
    lastCloseDate: last.date,
    lastClose: round(last.close),
    return1mPct: ret(SESSIONS.m1),
    return3mPct: ret(SESSIONS.m3),
    return12mPct: ret(SESSIONS.m12),
    // Null when there isn't a year of bars to define a 52-week high.
    drawdownFrom52wHighPct: bars.length >= SESSIONS.m12 && high > 0 ? round((1 - last.adjClose / high) * 100) : null,
    avgDailyDollarVolume30d: money(liquid.reduce((s, b) => s + b.close * b.volume, 0) / liquid.length),
  };
}

const side = (r: HistoryRow) => (r.code === 'P' && r.acquiredDisposed !== 'D' ? 'buy' : r.code === 'S' ? 'sell' : 'other');
const value = (r: HistoryRow) => (r.shares !== null && r.price !== null ? r.shares * r.price : 0);

export function summarizeHistory(rows: HistoryRow[], signalAt: Date) {
  const since = new Date(signalAt);
  since.setUTCFullYear(since.getUTCFullYear() - HISTORY_YEARS);
  const cutoff = since.toISOString().slice(0, 10);

  const byInsider = new Map<string, HistoryRow[]>();
  for (const r of rows) {
    if (r.transactionDate < cutoff) continue;
    byInsider.set(r.insiderCik, [...(byInsider.get(r.insiderCik) ?? []), r]);
  }

  return [...byInsider.values()].map((list) => {
    const buys = list.filter((r) => side(r) === 'buy');
    const sells = list.filter((r) => side(r) === 'sell');
    return {
      insider: list[0].insider,
      priorOpenMarketBuys: { count: buys.length, totalValue: money(buys.reduce((s, r) => s + value(r), 0)) },
      priorOpenMarketSales: { count: sells.length, totalValue: money(sells.reduce((s, r) => s + value(r), 0)) },
      otherTransactionCount: list.length - buys.length - sells.length,
      mostRecent: [...list]
        .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate))
        .slice(0, MAX_RECENT_PER_INSIDER)
        .map((r) => ({
          date: r.transactionDate,
          code: r.code,
          side: r.acquiredDisposed,
          shares: r.shares,
          price: r.price,
          derivative: r.isDerivative,
        })),
    };
  });
}

export function buildBundle(input: BundleInput) {
  const notes: string[] = [];
  if (input.issuer.marketCap === null) notes.push('Market cap is unavailable.');
  const price = priceContext(input.bars);
  if (!price) notes.push('No price history before the signal.');
  if (input.eightKs === null) notes.push('The 8-K list could not be retrieved.');
  else if (!input.eightKs.complete) notes.push('The 8-K list may be incomplete: the SEC file does not reach back the full 90 days.');

  return {
    asOf: etDate(input.signalAt),
    signalTimeUtc: input.signalAt.toISOString(),
    company: {
      name: input.issuer.name,
      ticker: input.issuer.ticker,
      industry: input.issuer.industry,
      marketCapUsd: input.issuer.marketCap,
    },
    cluster: {
      firstPurchaseDate: input.cluster.windowStart,
      lastPurchaseDate: input.cluster.windowEnd,
      insiderCount: input.cluster.insiderCount,
      totalPurchasedUsd: money(input.cluster.totalValue),
    },
    purchases: input.purchases.map((p) => ({
      insider: p.insider,
      role: roleOf({ isOfficer: !!p.isOfficer, officerTitle: p.officerTitle, isDirector: !!p.isDirector }),
      officerTitle: p.officerTitle,
      isDirector: !!p.isDirector,
      isTenPercentOwner: !!p.isTenPctOwner,
      transactionDate: p.transactionDate,
      shares: p.shares,
      pricePerShare: p.price,
      valueUsd: money(p.shares * p.price),
      sharesOwnedAfter: p.sharesOwnedAfter,
      ownership: p.ownership === 'I' ? 'indirect' : p.ownership === 'D' ? 'direct' : null,
      filingAcceptedUtc: p.acceptedAt.toISOString(),
      footnotes: p.footnotes.slice(0, MAX_FOOTNOTES).map((f) => f.slice(0, MAX_FOOTNOTE_CHARS)),
    })),
    insiderHistoryInThisCompany: summarizeHistory(input.history, input.signalAt),
    salesByOtherInsiders90d: { count: input.otherSales.count, totalValueUsd: money(input.otherSales.totalValue) },
    priceContext: price,
    recent8Ks: input.eightKs?.filings ?? null,
    dataNotes: notes,
  };
}

export type AgentBundle = ReturnType<typeof buildBundle>;
