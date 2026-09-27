import { describe, expect, it } from 'vitest';
import { findDuplicates, type StoredCluster } from './dedupe';

const c = (id: string, signalAt: number, ...transactionIds: string[]): StoredCluster => ({ id, signalAt, transactionIds });

describe('findDuplicates', () => {
  it('keeps the earliest signal of clusters that share a purchase', () => {
    const out = findDuplicates([c('late', 200, 't1', 't2', 't3'), c('early', 100, 't1', 't2')]);
    expect(out).toEqual([{ keep: 'early', supersede: ['late'] }]);
  });

  it('leaves clusters with no shared purchase alone', () => {
    expect(findDuplicates([c('a', 100, 't1'), c('b', 200, 't2')])).toEqual([]);
    expect(findDuplicates([])).toEqual([]);
    expect(findDuplicates([c('only', 1, 't1')])).toEqual([]);
  });

  it('chains: A shares with B and B shares with C makes one episode', () => {
    const out = findDuplicates([c('c', 300, 't3', 't4'), c('a', 100, 't1'), c('b', 200, 't1', 't3')]);
    expect(out).toEqual([{ keep: 'a', supersede: ['b', 'c'] }]);
  });

  it('handles separate groups independently and breaks time ties by id', () => {
    const out = findDuplicates([c('y', 100, 'x1'), c('x', 100, 'x1'), c('p', 5, 'z1'), c('q', 6, 'z1')]);
    expect(out).toEqual(expect.arrayContaining([{ keep: 'x', supersede: ['y'] }, { keep: 'p', supersede: ['q'] }]));
    expect(out).toHaveLength(2);
  });
});
