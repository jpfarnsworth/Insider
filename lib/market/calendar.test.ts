import { describe, expect, it } from 'vitest';
import { entryDay, horizonDay, sessionOpen, type MarketDay } from './calendar';

const d = (date: string, close = '16:00'): MarketDay => ({ date, open: '09:30', close });

// Thu Nov 26 2026 is Thanksgiving; Fri Nov 27 is an early close.
const days = [d('2026-11-23'), d('2026-11-24'), d('2026-11-25'), d('2026-11-27', '13:00'), d('2026-11-30')];

describe('sessionOpen', () => {
  it('converts the Eastern open to UTC, honouring daylight time', () => {
    expect(sessionOpen(d('2026-07-01')).toISOString()).toBe('2026-07-01T13:30:00.000Z'); // EDT
    expect(sessionOpen(d('2026-12-01')).toISOString()).toBe('2026-12-01T14:30:00.000Z'); // EST
  });
});

describe('entryDay', () => {
  const at = (iso: string) => new Date(iso);

  it('enters at the same day open for a filing accepted before the open', () => {
    // 08:00 ET on Tue Nov 24 (EST = UTC-5).
    expect(entryDay(days, at('2026-11-24T13:00:00Z'))?.date).toBe('2026-11-24');
  });

  it('enters at the next day open for a filing accepted during the session', () => {
    expect(entryDay(days, at('2026-11-24T17:00:00Z'))?.date).toBe('2026-11-25'); // noon ET
  });

  it('enters at the next day open for a filing accepted after the close', () => {
    expect(entryDay(days, at('2026-11-24T23:00:00Z'))?.date).toBe('2026-11-25'); // 6pm ET
  });

  it('skips the holiday and the weekend', () => {
    expect(entryDay(days, at('2026-11-25T23:00:00Z'))?.date).toBe('2026-11-27'); // Wed evening -> Fri
    expect(entryDay(days, at('2026-11-27T23:00:00Z'))?.date).toBe('2026-11-30'); // Fri evening -> Mon
  });

  it('is not the same day when accepted exactly at the open', () => {
    expect(entryDay(days, at('2026-11-24T14:30:00Z'))?.date).toBe('2026-11-25');
  });

  it('returns null past the end of the calendar', () => {
    expect(entryDay(days, at('2026-11-30T23:00:00Z'))).toBeNull();
  });
});

describe('horizonDay', () => {
  it('counts the entry day as day 1', () => {
    expect(horizonDay(days, '2026-11-23', 1)?.date).toBe('2026-11-23');
    expect(horizonDay(days, '2026-11-23', 4)?.date).toBe('2026-11-27');
  });

  it('skips non-trading days', () => {
    expect(horizonDay(days, '2026-11-25', 3)?.date).toBe('2026-11-30');
  });

  it('is null when the calendar is too short or the entry is unknown', () => {
    expect(horizonDay(days, '2026-11-25', 10)).toBeNull();
    expect(horizonDay(days, '2026-11-26', 1)).toBeNull();
  });
});
