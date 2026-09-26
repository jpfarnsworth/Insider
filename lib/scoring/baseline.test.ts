import { describe, expect, it } from 'vitest';
import { baselineScore, roleOf, type BaselineInput, type BaselineInsider } from './baseline';

const insider = (o: Partial<BaselineInsider> = {}): BaselineInsider => ({
  isOfficer: false,
  officerTitle: null,
  isDirector: true,
  sharesBought: 10_000,
  sharesOwnedAfter: 110_000,
  ...o,
});

const input = (o: Partial<BaselineInput> = {}): BaselineInput => ({
  insiders: [insider(), insider(), insider()],
  totalValue: 300_000,
  marketCap: 100_000_000,
  priorSaleValue: 0,
  drawdownFrom52wHigh: 0.2,
  ...o,
});

describe('roleOf', () => {
  it('ranks CEO and CFO titles above other officers and directors', () => {
    expect(roleOf({ isOfficer: true, officerTitle: 'Chief Executive Officer', isDirector: true })).toBe('ceo');
    expect(roleOf({ isOfficer: true, officerTitle: 'CEO and President', isDirector: false })).toBe('ceo');
    expect(roleOf({ isOfficer: true, officerTitle: 'SVP & Chief Financial Officer', isDirector: false })).toBe('cfo');
    expect(roleOf({ isOfficer: true, officerTitle: 'VP Sales', isDirector: false })).toBe('officer');
    expect(roleOf({ isOfficer: false, officerTitle: null, isDirector: true })).toBe('director');
    expect(roleOf({ isOfficer: false, officerTitle: null, isDirector: false })).toBe('other');
  });

  it('does not treat other executive titles as CEO or CFO', () => {
    expect(roleOf({ isOfficer: true, officerTitle: 'Executive Vice President', isDirector: false })).toBe('officer');
  });
});

describe('baselineScore', () => {
  it('stays within 0-100 and reports a component for each factor', () => {
    const r = baselineScore(input());
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.components.map((c) => c.key)).toEqual(['insiders', 'valueVsMarketCap', 'seniority', 'holdingsIncrease', 'priceContext']);
    expect(r.version).toBe(2);
  });

  it('scores more insiders higher, with diminishing returns', () => {
    const score = (n: number) => baselineScore(input({ insiders: Array.from({ length: n }, () => insider()) })).score;
    expect(score(5)).toBeGreaterThan(score(3));
    expect(score(8) - score(5)).toBeLessThan(score(5) - score(3) + 5);
  });

  it('scores a CEO/CFO cluster above a directors-only one', () => {
    const execs = [
      insider({ isOfficer: true, officerTitle: 'CEO' }),
      insider({ isOfficer: true, officerTitle: 'CFO' }),
      insider(),
    ];
    expect(baselineScore(input({ insiders: execs })).score).toBeGreaterThan(baselineScore(input()).score);
  });

  it('scores larger purchases relative to market cap higher', () => {
    expect(baselineScore(input({ marketCap: 50_000_000 })).score).toBeGreaterThan(
      baselineScore(input({ marketCap: 5_000_000_000 })).score,
    );
  });

  it('scores buying after a bigger drop from the 52-week high higher', () => {
    const at = (dd: number) => baselineScore(input({ drawdownFrom52wHigh: dd }));
    expect(at(0.35).score).toBeGreaterThan(at(0.1).score);
    expect(at(0).components.find((c) => c.key === 'priceContext')?.raw).toBe(0);
    expect(at(0.6).components.find((c) => c.key === 'priceContext')?.raw).toBe(1);
    expect(at(0.25).components.find((c) => c.key === 'priceContext')?.note).toContain('25% below');
  });

  it('redistributes weight when there is no price history', () => {
    const r = baselineScore(input({ drawdownFrom52wHigh: null }));
    expect(r.components.find((c) => c.key === 'priceContext')).toMatchObject({ raw: null, points: 0, note: 'No price history' });
  });

  it('scores first-time buyers and big position increases higher', () => {
    const firstTime = input({ insiders: [1, 2, 3].map(() => insider({ sharesOwnedAfter: 10_000 })) });
    const small = input({ insiders: [1, 2, 3].map(() => insider({ sharesOwnedAfter: 10_000_000 })) });
    expect(baselineScore(firstTime).score).toBeGreaterThan(baselineScore(small).score);
    const c = baselineScore(firstTime).components.find((x) => x.key === 'holdingsIncrease');
    expect(c?.raw).toBe(1);
    expect(c?.note).toContain('3 first-time buyers');
  });

  it('redistributes the weight of unavailable components instead of scoring them zero', () => {
    const noCap = baselineScore(input({ marketCap: null }));
    const cap = noCap.components.find((c) => c.key === 'valueVsMarketCap');
    expect(cap).toMatchObject({ raw: null, points: 0, note: 'Market cap unavailable' });
    const top = baselineScore(
      input({
        marketCap: null,
        drawdownFrom52wHigh: 0.5,
        insiders: Array.from({ length: 8 }, () => insider({ isOfficer: true, officerTitle: 'CEO', sharesOwnedAfter: 10_000 })),
      }),
    );
    expect(top.score).toBe(100); // every available component maxed
  });

  it('handles insiders whose holdings are not reported', () => {
    const r = baselineScore(input({ insiders: [insider({ sharesOwnedAfter: null }), insider({ sharesOwnedAfter: null })] }));
    expect(r.components.find((c) => c.key === 'holdingsIncrease')?.raw).toBeNull();
  });

  it('penalises heavy recent selling by other insiders, capped at the maximum', () => {
    const base = baselineScore(input());
    const some = baselineScore(input({ priorSaleValue: 300_000 }));
    const lots = baselineScore(input({ priorSaleValue: 10_000_000 }));
    expect(base.penalty.points).toBe(0);
    expect(some.score).toBeLessThan(base.score);
    expect(lots.penalty.points).toBe(20);
    expect(lots.score).toBeLessThan(some.score);
  });

  it('never goes below zero', () => {
    const r = baselineScore(input({ insiders: [], totalValue: 1, priorSaleValue: 1_000_000, marketCap: null }));
    expect(r.score).toBe(0);
  });

  it('is deterministic', () => {
    expect(baselineScore(input())).toEqual(baselineScore(input()));
  });
});
