import { describe, expect, it } from 'vitest';
import { tooManyMissingIndexes } from './ingest-daily-index';

describe('tooManyMissingIndexes', () => {
  it('accepts the handful of holidays in a long backfill', () => {
    expect(tooManyMissingIndexes(10, 520)).toBe(false);
  });

  it('accepts one or two missing days in a short run', () => {
    expect(tooManyMissingIndexes(1, 3)).toBe(false);
    expect(tooManyMissingIndexes(3, 5)).toBe(false);
  });

  it('flags a run where a large share of days have no index', () => {
    expect(tooManyMissingIndexes(4, 5)).toBe(true);
    expect(tooManyMissingIndexes(100, 520)).toBe(true);
  });
});
