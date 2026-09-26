import { describe, expect, it } from 'vitest';
import { dedupePurchases, detectClusters, type Purchase } from './detect';
import { clusterRuleSchema } from './rule';

const at = (iso: string) => Date.parse(iso);
let n = 0;

function buy(o: Partial<Purchase> & { insiderCik: string; transactionDate: string }): Purchase {
  n++;
  return {
    id: `t${String(n).padStart(4, '0')}`,
    issuerCik: '0000001',
    filingId: `f${n}`,
    // Default: accepted the evening of the transaction date.
    acceptedAt: at(`${o.transactionDate}T22:00:00Z`),
    securityTitle: 'Common Stock',
    shares: 10_000,
    price: 10,
    sharesOwnedAfter: 10_000 + n,
    tenPctOnly: false,
    ...o,
  };
}

const rule = clusterRuleSchema.parse({});
const run = (ps: Purchase[], extra: { marketCap?: number | null; asOf?: string } = {}) =>
  detectClusters(ps, { rule, asOf: '2026-01-01', ...extra });

// Three insiders x $100K = $300K.
const trio = () => [
  buy({ insiderCik: 'A', transactionDate: '2025-03-03' }),
  buy({ insiderCik: 'B', transactionDate: '2025-03-05' }),
  buy({ insiderCik: 'C', transactionDate: '2025-03-07' }),
];

describe('detectClusters: qualifying rule', () => {
  it('creates one cluster from three insiders over the value floor', () => {
    const [c, ...rest] = run(trio());
    expect(rest).toEqual([]);
    expect(c.insiderCount).toBe(3);
    expect(c.totalValue).toBe(300_000);
    expect(c.windowStart).toBe('2025-03-03');
    expect(c.windowEnd).toBe('2025-03-07');
  });

  it('dates the signal at the acceptance of the filing that completed the rule', () => {
    const ps = trio();
    const [c] = run(ps);
    expect(c.signalAt).toBe(ps[2].acceptedAt);
    expect(c.triggerFilingId).toBe(ps[2].filingId);
    expect(c.events[0].type).toBe('signal_created');
  });

  it('needs the minimum number of insiders', () => {
    expect(run(trio().slice(0, 2))).toEqual([]);
  });

  it('needs the minimum total value', () => {
    const ps = trio().map((p) => ({ ...p, shares: 2_000 })); // $20K each = $60K
    expect(run(ps)).toEqual([]);
  });

  it("does not count an insider below the per-insider minimum", () => {
    const ps = [
      buy({ insiderCik: 'A', transactionDate: '2025-03-03', shares: 30_000 }),
      buy({ insiderCik: 'B', transactionDate: '2025-03-05', shares: 30_000 }),
      buy({ insiderCik: 'C', transactionDate: '2025-03-07', shares: 500 }), // $5K
    ];
    expect(run(ps)).toEqual([]);
  });

  it("sums one insider's purchases toward the per-insider minimum", () => {
    const ps = [
      buy({ insiderCik: 'A', transactionDate: '2025-03-03', shares: 12_000 }),
      buy({ insiderCik: 'B', transactionDate: '2025-03-05', shares: 12_000 }),
      buy({ insiderCik: 'C', transactionDate: '2025-03-06', shares: 600 }), // $6K
      buy({ insiderCik: 'C', transactionDate: '2025-03-07', shares: 600 }), // $12K together
    ];
    expect(run(ps)).toHaveLength(1);
  });

  it('excludes 10%-owner-only buyers', () => {
    const ps = trio();
    ps[2] = { ...ps[2], tenPctOnly: true };
    expect(run(ps)).toEqual([]);
    const allowed = detectClusters(ps, { rule: { ...rule, excludeTenPctOnly: false }, asOf: '2026-01-01' });
    expect(allowed).toHaveLength(1);
  });

  it('ignores purchases below the minimum share price', () => {
    const ps = trio().map((p) => ({ ...p, price: 1.5, shares: 100_000 }));
    expect(run(ps)).toEqual([]);
  });

  it('blocks clusters under the minimum market cap, but only when the cap is known', () => {
    expect(run(trio(), { marketCap: 10_000_000 })).toEqual([]);
    expect(run(trio(), { marketCap: null })).toHaveLength(1);
    expect(run(trio(), { marketCap: 500_000_000 })).toHaveLength(1);
  });

  it('requires all purchases inside the rolling window', () => {
    const ps = [
      buy({ insiderCik: 'A', transactionDate: '2025-03-01' }),
      buy({ insiderCik: 'B', transactionDate: '2025-03-10' }),
      buy({ insiderCik: 'C', transactionDate: '2025-03-20' }), // 19 days after A
    ];
    expect(run(ps)).toEqual([]);
  });

  it('treats a 14-day window as 14 calendar days inclusive', () => {
    const fits = [
      buy({ insiderCik: 'A', transactionDate: '2025-03-01' }),
      buy({ insiderCik: 'B', transactionDate: '2025-03-07' }),
      buy({ insiderCik: 'C', transactionDate: '2025-03-14' }), // day 14
    ];
    const tooFar = [{ ...fits[0] }, { ...fits[1] }, buy({ insiderCik: 'C', transactionDate: '2025-03-15' })];
    expect(run(fits)).toHaveLength(1);
    expect(run(tooFar)).toEqual([]);
  });
});

describe('dedupePurchases: related filers reporting the same purchase', () => {
  it('counts identical transactions in separate filings once, keeping the earliest', () => {
    const fund = buy({ insiderCik: 'FUND', transactionDate: '2025-03-03', shares: 1_000_000, price: 15, sharesOwnedAfter: 5_000_000 });
    const adviser = buy({
      insiderCik: 'ADVISER',
      transactionDate: '2025-03-03',
      shares: 1_000_000,
      price: 15,
      sharesOwnedAfter: 5_000_000,
      acceptedAt: fund.acceptedAt + 3_600_000,
    });
    expect(dedupePurchases([adviser, fund])).toEqual([fund]);
  });

  it('does not let a fund and its adviser count as two insiders', () => {
    const fund = buy({ insiderCik: 'FUND', transactionDate: '2025-03-03', shares: 100_000, price: 15, sharesOwnedAfter: 5_000_000 });
    const adviser = { ...fund, id: 'x', insiderCik: 'ADVISER', filingId: 'fx', acceptedAt: fund.acceptedAt + 1 };
    const ps = [fund, adviser, buy({ insiderCik: 'C', transactionDate: '2025-03-05', shares: 100_000, price: 15 })];
    expect(run(ps)).toEqual([]); // two distinct insiders
  });

  it('keeps unrelated insiders who bought the same size at the same price (different holdings)', () => {
    const a = buy({ insiderCik: 'A', transactionDate: '2025-03-03', shares: 1_000, sharesOwnedAfter: 4_000 });
    const b = buy({ insiderCik: 'B', transactionDate: '2025-03-03', shares: 1_000, sharesOwnedAfter: 9_500 });
    expect(dedupePurchases([a, b])).toHaveLength(2);
  });
});

describe('detectClusters: lifecycle', () => {
  it('adds later purchases to the cluster without moving the signal time', () => {
    const ps = trio();
    const fourth = buy({ insiderCik: 'D', transactionDate: '2025-03-12' });
    const [c] = run([...ps, fourth]);
    expect(c.insiderCount).toBe(4);
    expect(c.signalAt).toBe(ps[2].acceptedAt);
    expect(c.triggerFilingId).toBe(ps[2].filingId);
    expect(c.events.map((e) => e.type)).toEqual(['signal_created', 'insider_joined', 'closed']);
    expect(c.windowEnd).toBe('2025-03-12');
  });

  it('records a purchase by an existing insider as purchase_added', () => {
    const [c] = run([...trio(), buy({ insiderCik: 'A', transactionDate: '2025-03-10' })]);
    expect(c.insiderCount).toBe(3);
    expect(c.events.map((e) => e.type)).toContain('purchase_added');
  });

  it('closes after a full window with no purchases and starts a new signal for a later group', () => {
    const later = [
      buy({ insiderCik: 'D', transactionDate: '2025-08-01' }),
      buy({ insiderCik: 'E', transactionDate: '2025-08-03' }),
      buy({ insiderCik: 'F', transactionDate: '2025-08-05' }),
    ];
    const clusters = run([...trio(), ...later]);
    expect(clusters).toHaveLength(2);
    expect(clusters.map((c) => c.status)).toEqual(['closed', 'closed']);
    expect(clusters[0].members.map((m) => m.insiderCik)).toEqual(['A', 'B', 'C']);
    expect(clusters[1].members.map((m) => m.insiderCik)).toEqual(['D', 'E', 'F']);
    expect(clusters[0].events.at(-1)?.type).toBe('closed');
  });

  it('keeps the latest cluster active while inside its window and closes it after', () => {
    expect(run(trio(), { asOf: '2025-03-15' })[0].status).toBe('active');
    expect(run(trio(), { asOf: '2025-03-21' })[0].status).toBe('active');
    expect(run(trio(), { asOf: '2025-03-22' })[0].status).toBe('closed');
  });

  it('dates the signal at a late-filed purchase when it is the one that completes the rule', () => {
    const [a, b] = trio();
    const lateC = buy({ insiderCik: 'C', transactionDate: '2025-03-04', acceptedAt: at('2025-03-20T15:00:00Z') });
    const [c] = run([a, b, lateC]);
    expect(c.signalAt).toBe(lateC.acceptedAt);
    expect(c.triggerFilingId).toBe(lateC.filingId);
  });

  it('gives the same clusters whatever order the purchases are supplied in', () => {
    const ps = [...trio(), buy({ insiderCik: 'D', transactionDate: '2025-03-12' }), buy({ insiderCik: 'E', transactionDate: '2025-09-01' })];
    const forward = run(ps);
    expect(run([...ps].reverse())).toEqual(forward);
    expect(run(ps)).toEqual(forward);
  });

  it('returns nothing for no purchases', () => {
    expect(run([])).toEqual([]);
  });
});
