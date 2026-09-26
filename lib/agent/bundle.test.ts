import { describe, expect, it } from 'vitest';
import { buildBundle, priceContext, summarizeHistory, type BarRow, type BundleInput, type HistoryRow, type PurchaseRow } from './bundle';

const signalAt = new Date('2026-06-15T20:00:00Z');

/** n bars, closing 100 + i (so the trend is a steady climb) on consecutive dates. */
const bars = (n: number, volume = 10_000): BarRow[] =>
  Array.from({ length: n }, (_, i) => ({
    date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10),
    close: 100 + i,
    adjClose: 100 + i,
    volume,
  }));

describe('priceContext', () => {
  it('is null with no bars', () => {
    expect(priceContext([])).toBeNull();
  });

  it('computes 1m/3m/12m returns from the last close by session count', () => {
    const b = bars(300);
    const last = b.at(-1)!.adjClose;
    const c = priceContext(b)!;
    expect(c.lastClose).toBe(last);
    expect(c.return1mPct).toBeCloseTo((last / b[299 - 21].adjClose - 1) * 100, 1);
    expect(c.return3mPct).toBeCloseTo((last / b[299 - 63].adjClose - 1) * 100, 1);
    expect(c.return12mPct).toBeCloseTo((last / b[299 - 252].adjClose - 1) * 100, 1);
  });

  it('leaves returns null when the history is too short', () => {
    const c = priceContext(bars(30))!;
    expect(c.return1mPct).not.toBeNull();
    expect(c.return3mPct).toBeNull();
    expect(c.return12mPct).toBeNull();
    expect(c.drawdownFrom52wHighPct).toBeNull();
  });

  it('measures drawdown from the 52-week high and average dollar volume', () => {
    const b = bars(260);
    b[200] = { ...b[200], adjClose: 400 }; // a spike inside the last 252 sessions
    const c = priceContext(b)!;
    expect(c.drawdownFrom52wHighPct).toBeCloseTo((1 - b.at(-1)!.adjClose / 400) * 100, 1);
    expect(priceContext(bars(40, 1_000))!.avgDailyDollarVolume30d).toBeGreaterThan(100_000);
  });
});

describe('summarizeHistory', () => {
  const row = (o: Partial<HistoryRow>): HistoryRow => ({
    insiderCik: 'A',
    insider: 'Ann Lee',
    transactionDate: '2026-01-10',
    code: 'P',
    acquiredDisposed: 'A',
    shares: 1000,
    price: 10,
    isDerivative: false,
    ...o,
  });

  it('counts prior buys, sales and other transactions per insider', () => {
    const [s] = summarizeHistory(
      [row({}), row({ transactionDate: '2026-02-01', shares: 500 }), row({ code: 'S', acquiredDisposed: 'D', shares: 200 }), row({ code: 'A', price: null })],
      signalAt,
    );
    expect(s.priorOpenMarketBuys).toEqual({ count: 2, totalValue: 15_000 });
    expect(s.priorOpenMarketSales).toEqual({ count: 1, totalValue: 2_000 });
    expect(s.otherTransactionCount).toBe(1);
  });

  it('ignores history older than three years and separates insiders', () => {
    const out = summarizeHistory([row({ transactionDate: '2022-01-01' }), row({ insiderCik: 'B', insider: 'Bo Kim' })], signalAt);
    expect(out.map((s) => s.insider)).toEqual(['Bo Kim']);
  });

  it('lists the most recent transactions first and caps them', () => {
    const many = Array.from({ length: 40 }, (_, i) => row({ transactionDate: `2026-01-${String((i % 28) + 1).padStart(2, '0')}` }));
    const [s] = summarizeHistory(many, signalAt);
    expect(s.mostRecent).toHaveLength(25);
    expect(s.mostRecent[0].date >= s.mostRecent[24].date).toBe(true);
  });
});

describe('buildBundle', () => {
  const purchase = (o: Partial<PurchaseRow> = {}): PurchaseRow => ({
    insiderCik: 'A',
    insider: 'Ann Lee',
    isOfficer: true,
    officerTitle: 'Chief Executive Officer',
    isDirector: true,
    isTenPctOwner: false,
    transactionDate: '2026-06-10',
    shares: 10_000,
    price: 12.5,
    sharesOwnedAfter: 60_000,
    ownership: 'D',
    acceptedAt: new Date('2026-06-12T21:00:00Z'),
    footnotes: [],
    ...o,
  });
  const input = (o: Partial<BundleInput> = {}): BundleInput => ({
    signalAt,
    issuer: { name: 'Acme Corp', ticker: 'ACME', industry: 'Software', marketCap: 250_000_000 },
    cluster: { windowStart: '2026-06-08', windowEnd: '2026-06-12', insiderCount: 3, totalValue: 400_000 },
    purchases: [purchase()],
    history: [],
    otherSales: { count: 0, totalValue: 0 },
    bars: bars(300),
    eightKs: { filings: [], complete: true },
    ...o,
  });

  it('describes the company, cluster and purchases with roles', () => {
    const b = buildBundle(input());
    expect(b.asOf).toBe('2026-06-15');
    expect(b.company).toEqual({ name: 'Acme Corp', ticker: 'ACME', industry: 'Software', marketCapUsd: 250_000_000 });
    expect(b.cluster.totalPurchasedUsd).toBe(400_000);
    expect(b.purchases[0]).toMatchObject({ role: 'ceo', valueUsd: 125_000, ownership: 'direct', filingAcceptedUtc: '2026-06-12T21:00:00.000Z' });
    expect(b.dataNotes).toEqual([]);
  });

  it('does not include the baseline score, so the two scorers stay independent', () => {
    expect(JSON.stringify(buildBundle(input()))).not.toMatch(/baseline/i);
  });

  it('caps and truncates footnotes', () => {
    const long = 'x'.repeat(2000);
    const b = buildBundle(input({ purchases: [purchase({ footnotes: [long, 'b', 'c', 'd'] })] }));
    expect(b.purchases[0].footnotes).toHaveLength(3);
    expect(b.purchases[0].footnotes[0]).toHaveLength(600);
  });

  it('states what data is missing instead of leaving it silent', () => {
    const b = buildBundle(input({ issuer: { name: 'A', ticker: null, industry: null, marketCap: null }, bars: [], eightKs: null }));
    expect(b.dataNotes).toEqual(['Market cap is unavailable.', 'No price history before the signal.', 'The 8-K list could not be retrieved.']);
    expect(b.priceContext).toBeNull();
    expect(b.recent8Ks).toBeNull();
  });

  it('notes an incomplete 8-K list', () => {
    expect(buildBundle(input({ eightKs: { filings: [], complete: false } })).dataNotes[0]).toMatch(/8-K list may be incomplete/);
  });
});
