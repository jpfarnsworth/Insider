import { describe, expect, it } from 'vitest';
import type { Purchase } from './detect';
import { OFFERING_LIKE, tagsFor } from './tags';

const p = (date: string, price: number, insiderCik = 'x'): Purchase => ({
  id: `${date}${price}${insiderCik}`,
  issuerCik: '1',
  insiderCik,
  filingId: 'f',
  acceptedAt: 0,
  transactionDate: date,
  securityTitle: 'Common Stock',
  shares: 100,
  price,
  sharesOwnedAfter: null,
  tenPctOnly: false,
});

describe('tagsFor', () => {
  it('tags one day at one price', () => {
    expect(tagsFor([p('2026-01-02', 10, 'a'), p('2026-01-02', 10, 'b'), p('2026-01-02', 10, 'c')], 3)).toEqual([OFFERING_LIKE]);
  });

  it('does not tag a different day or a different price', () => {
    expect(tagsFor([p('2026-01-02', 10), p('2026-01-03', 10)], 3)).toEqual([]);
    expect(tagsFor([p('2026-01-02', 10), p('2026-01-02', 10.5)], 3)).toEqual([]);
  });

  it('needs three or more insiders, and members', () => {
    expect(tagsFor([p('2026-01-02', 10)], 2)).toEqual([]);
    expect(tagsFor([], 3)).toEqual([]);
  });
});
