import { describe, expect, it } from 'vitest';
import { decideFreshness, isStale, nextAlertedOn, shouldAlert, RE_ALERT_AFTER_DAYS } from './freshness';

describe('isStale', () => {
  it('is stale when there is nothing at all, or the latest day is before the cutoff', () => {
    expect(isStale(null, '2026-09-01')).toBe(true);
    expect(isStale('2026-08-31', '2026-09-01')).toBe(true);
  });

  it('is not stale on or after the cutoff', () => {
    expect(isStale('2026-09-01', '2026-09-01')).toBe(false);
    expect(isStale('2026-09-02', '2026-09-01')).toBe(false);
  });
});

describe('decideFreshness', () => {
  it('checks filings and signals independently', () => {
    const d = decideFreshness({
      today: '2026-09-27',
      filingsCutoff: '2026-09-24',
      signalsCutoff: '2026-09-13',
      latestFilingDay: '2026-09-20', // before filings cutoff -> stale
      latestSignalDay: '2026-09-20', // after signals cutoff -> fine
    });
    expect(d).toEqual({ filingsStale: true, signalsStale: false });
  });
});

describe('shouldAlert', () => {
  it('never alerts when not stale', () => {
    expect(shouldAlert(false, null, '2026-09-27')).toBe(false);
    expect(shouldAlert(false, '2026-09-01', '2026-09-27')).toBe(false);
  });

  it('alerts the first time it goes stale', () => {
    expect(shouldAlert(true, null, '2026-09-27')).toBe(true);
  });

  it('does not repeat until RE_ALERT_AFTER_DAYS have passed', () => {
    expect(shouldAlert(true, '2026-09-26', '2026-09-27')).toBe(false);
    expect(shouldAlert(true, '2026-09-25', '2026-09-27')).toBe(false);
    expect(shouldAlert(true, '2026-09-24', '2026-09-27')).toBe(true);
    expect(RE_ALERT_AFTER_DAYS).toBe(3);
  });
});

describe('nextAlertedOn', () => {
  it('clears once the condition resolves', () => {
    expect(nextAlertedOn(false, false, '2026-09-27', '2026-09-20')).toBeNull();
  });

  it('records today when an alert was actually sent', () => {
    expect(nextAlertedOn(true, true, '2026-09-27', null)).toBe('2026-09-27');
  });

  it('keeps the previous date when still stale but not re-alerting yet', () => {
    expect(nextAlertedOn(true, false, '2026-09-27', '2026-09-25')).toBe('2026-09-25');
  });
});
