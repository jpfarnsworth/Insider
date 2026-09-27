import { describe, expect, it } from 'vitest';
import { fact } from '@/lib/analytics/fixtures';
import { EMPTY_FILTERS, activeCount, applyFilters, matches, parseFilters, toQuery, type SignalRow } from './filters';

const row = (o: Parameters<typeof fact>[0] = {}, clusterStatus: SignalRow['clusterStatus'] = 'active'): SignalRow => ({ ...fact(o), clusterStatus });
const f = (o: Partial<typeof EMPTY_FILTERS>) => ({ ...EMPTY_FILTERS, ...o });

describe('parseFilters', () => {
  it('reads valid values and ignores junk', () => {
    const p = parseFilters({ q: ' abc ', from: '2026-01-02', to: 'nope', bmin: '50', bmax: 'x', conviction: 'high', role: 'bogus', status: 'closed', outcome: 'pending', sort: 'agent' });
    expect(p).toMatchObject({ q: 'abc', from: '2026-01-02', to: null, baselineMin: 50, baselineMax: null, conviction: 'high', role: null, status: 'closed', outcome: 'pending', sort: 'agent' });
  });

  it('clamps scores to 0..100 and takes the first of repeated params', () => {
    expect(parseFilters({ bmin: '-5', amax: '250' })).toMatchObject({ baselineMin: 0, agentMax: 100 });
    expect(parseFilters({ q: ['a', 'b'] }).q).toBe('a');
  });

  it('rejects impossible dates', () => {
    expect(parseFilters({ from: '2026-13-45' }).from).toBeNull();
  });

  it('round-trips through toQuery', () => {
    const filters = f({ q: 'ab', from: '2026-01-01', baselineMin: 40, agentMin: 70, role: 'officer', status: 'active', sort: 'value' });
    expect(parseFilters(Object.fromEntries(new URLSearchParams(toQuery(filters))))).toEqual(filters);
    expect(toQuery(EMPTY_FILTERS)).toBe('');
  });
});

describe('matches', () => {
  it('filters by text on ticker or company', () => {
    expect(matches(row({ ticker: 'ZZZ', issuer: 'Acme Widgets' }), f({ q: 'zz' }))).toBe(true);
    expect(matches(row({ ticker: 'ZZZ', issuer: 'Acme Widgets' }), f({ q: 'widget' }))).toBe(true);
    expect(matches(row({ ticker: null, issuer: 'Acme' }), f({ q: 'zz' }))).toBe(false);
  });

  it('uses the Chicago calendar day, inclusive at both ends', () => {
    // 2026-01-02 03:00 UTC is still Jan 1 in Chicago.
    const r = row({ signalAt: Date.UTC(2026, 0, 2, 3) });
    expect(matches(r, f({ from: '2026-01-01', to: '2026-01-01' }))).toBe(true);
    expect(matches(r, f({ from: '2026-01-02' }))).toBe(false);
  });

  it('score ranges exclude unscored signals', () => {
    expect(matches(row({ agentScore: null }), f({ agentMin: 0 }))).toBe(false);
    expect(matches(row({ agentScore: null }), f({}))).toBe(true);
    expect(matches(row({ baselineScore: 70 }), f({ baselineMin: 70, baselineMax: 70 }))).toBe(true);
    expect(matches(row({ baselineScore: 71 }), f({ baselineMax: 70 }))).toBe(false);
  });

  it('role: officer includes CEO/CFO', () => {
    expect(matches(row({ roleMix: 'ceo_cfo' }), f({ role: 'officer' }))).toBe(true);
    expect(matches(row({ roleMix: 'other_officer' }), f({ role: 'ceo_cfo' }))).toBe(false);
    expect(matches(row({ roleMix: 'director' }), f({ role: 'director' }))).toBe(true);
  });

  it('cluster status, conviction and outcome availability', () => {
    expect(matches(row({}, 'closed'), f({ status: 'active' }))).toBe(false);
    expect(matches(row({ conviction: 'low' }), f({ conviction: 'high' }))).toBe(false);
    expect(matches(row({ outcomeStatus: 'complete' }), f({ outcome: 'complete' }))).toBe(true);
    expect(matches(row({ outcomeStatus: 'pending' }), f({ outcome: 'complete' }))).toBe(false);
    expect(matches(row({ outcomeStatus: 'pending' }), f({ outcome: 'pending' }))).toBe(true);
  });
});

describe('applyFilters', () => {
  const a = row({ signalAt: 3, agentScore: 50, totalValue: 1 });
  const b = row({ signalAt: 2, agentScore: 90, totalValue: 9 });
  const c = row({ signalAt: 1, agentScore: null, totalValue: 5 });

  it('sorts, with unscored signals last', () => {
    expect(applyFilters([c, a, b], f({})).map((r) => r.id)).toEqual([a.id, b.id, c.id]);
    expect(applyFilters([c, a, b], f({ sort: 'agent' })).map((r) => r.id)).toEqual([b.id, a.id, c.id]);
    expect(applyFilters([c, a, b], f({ sort: 'value' })).map((r) => r.id)).toEqual([b.id, c.id, a.id]);
  });

  it('counts active filters, ignoring sort', () => {
    expect(activeCount(f({ sort: 'agent' }))).toBe(0);
    expect(activeCount(f({ q: 'x', role: 'officer', agentMin: 0 }))).toBe(3);
  });
});
