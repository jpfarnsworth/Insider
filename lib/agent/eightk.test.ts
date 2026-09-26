import { describe, expect, it } from 'vitest';
import { itemTitle, recentEightKs, submissionsUrl } from './eightk';

const at = (iso: string) => new Date(iso);
const sub = (rows: Array<{ form: string; filed: string; accepted?: string; items?: string }>, files: unknown[] = []) => ({
  filings: {
    recent: {
      form: rows.map((r) => r.form),
      filingDate: rows.map((r) => r.filed),
      acceptanceDateTime: rows.map((r) => r.accepted ?? `${r.filed}T12:00:00.000Z`),
      items: rows.map((r) => r.items ?? ''),
    },
    files,
  },
});

describe('submissionsUrl', () => {
  it('zero-pads the CIK to ten digits', () => {
    expect(submissionsUrl('320193')).toBe('https://data.sec.gov/submissions/CIK0000320193.json');
    expect(submissionsUrl('0000320193')).toBe('https://data.sec.gov/submissions/CIK0000320193.json');
  });
});

describe('itemTitle', () => {
  it('names known items and falls back for unknown ones', () => {
    expect(itemTitle('5.02')).toBe('5.02 Departure or Appointment of Directors or Officers');
    expect(itemTitle('9.9')).toBe('Item 9.9');
  });
});

describe('recentEightKs', () => {
  const signalAt = at('2026-06-15T20:00:00Z');

  it('lists 8-Ks in the 90 days before the signal, newest first, with item titles', () => {
    const r = recentEightKs(
      sub([
        { form: '8-K', filed: '2026-06-10', items: '2.02,9.01' },
        { form: '8-K', filed: '2026-04-01', items: '5.02' },
        { form: '10-Q', filed: '2026-05-05' },
        { form: '8-K', filed: '2025-11-01', items: '8.01' }, // older than 90 days
      ]),
      signalAt,
    );
    expect(r.filings).toEqual([
      { date: '2026-06-10', form: '8-K', items: ['2.02 Results of Operations and Financial Condition', '9.01 Financial Statements and Exhibits'] },
      { date: '2026-04-01', form: '8-K', items: ['5.02 Departure or Appointment of Directors or Officers'] },
    ]);
  });

  it('never lists a filing accepted after the signal, even on the same day', () => {
    const r = recentEightKs(
      sub([
        { form: '8-K', filed: '2026-06-15', accepted: '2026-06-15T13:00:00.000Z', items: '7.01' },
        { form: '8-K', filed: '2026-06-15', accepted: '2026-06-15T22:30:00.000Z', items: '8.01' },
        { form: '8-K', filed: '2026-06-20', items: '1.01' },
      ]),
      signalAt,
    );
    expect(r.filings.map((f) => f.items[0])).toEqual(['7.01 Regulation FD Disclosure']);
  });

  it('includes 8-K/A amendments', () => {
    expect(recentEightKs(sub([{ form: '8-K/A', filed: '2026-06-01', items: '2.02' }]), signalAt).filings[0].form).toBe('8-K/A');
  });

  it('handles filings with no item codes and empty submissions', () => {
    expect(recentEightKs(sub([{ form: '8-K', filed: '2026-06-01' }]), signalAt).filings[0].items).toEqual([]);
    expect(recentEightKs({}, signalAt)).toEqual({ filings: [], complete: false });
  });

  it('flags a list as incomplete when the file does not reach back to the window start', () => {
    // Oldest recent filing is 30 days before the signal and older filings live in extra files.
    const r = recentEightKs(sub([{ form: '8-K', filed: '2026-05-20' }], [{ name: 'older.json' }]), signalAt);
    expect(r.complete).toBe(false);
  });

  it('is complete when recent reaches past the window, or there are no older files', () => {
    expect(recentEightKs(sub([{ form: '8-K', filed: '2026-06-01' }, { form: '10-K', filed: '2025-01-01' }], [{}]), signalAt).complete).toBe(true);
    expect(recentEightKs(sub([{ form: '8-K', filed: '2026-06-01' }], []), signalAt).complete).toBe(true);
  });
});
