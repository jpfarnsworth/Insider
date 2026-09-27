import { describe, expect, it } from 'vitest';
import { MIN_OVERRIDE_REASON_LENGTH, canChangeFrom, heldOutFrom, holdoutSchema, isHeldOut } from './holdout';

describe('holdout', () => {
  it('defaults to a frozen window from 2026-10-01', () => {
    const s = holdoutSchema.parse({});
    expect(s).toEqual({ from: '2026-10-01', reveal: false, revealedAt: null, revealedBy: null, abandonReason: null, abandonedTests: [], fromChanges: [] });
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

describe('canChangeFrom', () => {
  it('allows an unchanged date with no reason', () => {
    expect(canChangeFrom('2026-10-01', '2026-10-01', null)).toEqual({ ok: true });
  });

  it('refuses a changed date with no reason, or a too-short one', () => {
    expect(canChangeFrom('2026-10-01', '2026-11-01', null).ok).toBe(false);
    expect(canChangeFrom('2026-10-01', '2026-11-01', 'oops').ok).toBe(false);
  });

  it('allows a changed date with a reason of the minimum length, trimmed', () => {
    expect(canChangeFrom('2026-10-01', '2026-11-01', 'x'.repeat(MIN_OVERRIDE_REASON_LENGTH)).ok).toBe(true);
    expect(canChangeFrom('2026-10-01', '2026-11-01', ` ${'x'.repeat(MIN_OVERRIDE_REASON_LENGTH - 1)} `).ok).toBe(false);
  });

  it('names both dates in the error', () => {
    const r = canChangeFrom('2026-10-01', '2026-11-01', null);
    expect(r.error).toContain('2026-10-01');
    expect(r.error).toContain('2026-11-01');
  });
});
