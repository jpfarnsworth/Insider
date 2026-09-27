import { z } from 'zod';

// A job that "succeeds" while ingesting or producing nothing is a quieter failure than a thrown error
// (a changed SEC index format, an empty feed, a rule regression) and job_runs.status alone never shows
// it. These checks compare the freshest real-world timestamp against how long a healthy pipeline could
// plausibly go without one.
export const FRESHNESS_KEY = 'pipeline_freshness_alerts';

export const freshnessAlertsSchema = z.object({
  /** Chicago date (YYYY-MM-DD) the last "no new filings" alert fired, or null. Cleared once filings resume. */
  filingsStaleAlertedOn: z.string().nullable().default(null),
  /** Chicago date the last "no new signals" alert fired, or null. Cleared once a signal is created. */
  signalsStaleAlertedOn: z.string().nullable().default(null),
});

export type FreshnessAlerts = z.infer<typeof freshnessAlertsSchema>;

/** No filing accepted this recently means the daily index probably returned nothing for two business days running. */
export const FILING_STALE_BUSINESS_DAYS = 2;
/** No signal created this recently means clusters have stopped forming, well past normal week-to-week variation. */
export const SIGNAL_STALE_DAYS = 14;
/** Once alerted, wait this long before repeating the same alert (it still shows on /system every run). */
export const RE_ALERT_AFTER_DAYS = 3;
const DAY_MS = 86_400_000;

export interface FreshnessInput {
  /** `today` in YYYY-MM-DD (Chicago). */
  today: string;
  /** The oldest acceptable date (YYYY-MM-DD) for the freshest filing/signal: older than this is stale. */
  filingsCutoff: string;
  signalsCutoff: string;
  /** The latest filing.accepted_at / signals.signal_at date (YYYY-MM-DD, Chicago), or null if there are none at all. */
  latestFilingDay: string | null;
  latestSignalDay: string | null;
}

export interface FreshnessDecision {
  filingsStale: boolean;
  signalsStale: boolean;
}

export const isStale = (latestDay: string | null, cutoff: string): boolean => latestDay === null || latestDay < cutoff;

export function decideFreshness(input: FreshnessInput): FreshnessDecision {
  return {
    filingsStale: isStale(input.latestFilingDay, input.filingsCutoff),
    signalsStale: isStale(input.latestSignalDay, input.signalsCutoff),
  };
}

/** Whether to (re-)send a given alert now: stale, and either never alerted or the last alert has aged out. */
export function shouldAlert(stale: boolean, lastAlertedOn: string | null, today: string): boolean {
  if (!stale) return false;
  if (!lastAlertedOn) return true;
  const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${lastAlertedOn}T00:00:00Z`)) / DAY_MS;
  return days >= RE_ALERT_AFTER_DAYS;
}

/** The next stored state: today's date once (re-)alerted, or cleared once the condition resolves. */
export const nextAlertedOn = (stale: boolean, sentThisRun: boolean, today: string, previous: string | null): string | null =>
  !stale ? null : sentThisRun ? today : previous;
