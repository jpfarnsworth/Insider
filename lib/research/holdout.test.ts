import { describe, expect, it } from 'vitest';
import { heldOutFrom, holdoutSchema, isHeldOut } from './holdout';

describe('holdout', () => {
  it('defaults to a frozen window from 2026-10-01', () => {
    const s = holdoutSchema.parse({});
    expect(s).toEqual({ from: '2026-10-01', reveal: false });
    expect(heldOutFrom(s)).toBe('2026-10-01');
  });

  it('revealing lifts the freeze', () => {
    expect(heldOutFrom(holdoutSchema.parse({ reveal: true }))).toBeNull();
  });

  it('rejects malformed dates', () => {
    expect(holdoutSchema.safeParse({ from: 'Oct 1' }).success).toBe(false);
  });

  it('compares on the Chicago calendar day, inclusive', () => {
    // 2026-10-01 04:59 UTC is still Sep 30 in Chicago (CDT); 05:00 UTC is Oct 1.
    expect(isHeldOut(Date.UTC(2026, 9, 1, 4, 59), '2026-10-01')).toBe(false);
    expect(isHeldOut(Date.UTC(2026, 9, 1, 5, 0), '2026-10-01')).toBe(true);
    expect(isHeldOut(Date.UTC(2030, 0, 1), null)).toBe(false);
  });
});
