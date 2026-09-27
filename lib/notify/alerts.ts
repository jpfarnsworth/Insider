import { and, eq, gte, isNull, ne, sql } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { agentEvaluations, clusters, filings, issuers, signals } from '@/db/schema';
import { chicagoToday, priorBusinessDays } from '@/lib/edgar/dates';
import { getFlags } from '@/lib/flags';
import { getSetting, saveSetting } from '@/lib/settings';
import { log } from '@/lib/log';
import { FRESHNESS_KEY, decideFreshness, freshnessAlertsSchema, nextAlertedOn, shouldAlert, FILING_STALE_BUSINESS_DAYS, SIGNAL_STALE_DAYS } from './freshness';
import { meetsThreshold, signalAlertMessage, jobFailureMessage, staleFilingsMessage, staleSignalsMessage } from './format';
import { NOTIFICATIONS_KEY, notificationsSchema } from './settings';
import { sendTelegram, telegramConfigured } from './telegram';

/** Only recent signals are alerted, so switching notifications on never replays history. */
export const ALERT_WINDOW_DAYS = 3;
const DAY_MS = 86_400_000;
const num = (v: string | null) => (v === null ? null : Number(v));

/**
 * Sends one alert per signal whose baseline or agent score reaches the threshold. A signal below
 * it stays eligible for the window, because the agent's score may arrive later. Marks a signal
 * alerted only after Telegram accepted the message, so a failed send is retried next run.
 */
export async function alertNewSignals(db: Db, now: Date = new Date()): Promise<{ sent: number }> {
  const [flags, cfg] = await Promise.all([getFlags(db), getSetting(db, NOTIFICATIONS_KEY, notificationsSchema)]);
  if (!flags.notifications || !cfg.signalAlerts || !telegramConfigured()) return { sent: 0 };

  const rows = await db
    .select({
      id: signals.id,
      ticker: issuers.ticker,
      issuer: issuers.name,
      insiderCount: clusters.insiderCount,
      totalValue: clusters.totalValue,
      baselineScore: signals.baselineScore,
      agentScore: agentEvaluations.score,
      conviction: agentEvaluations.conviction,
    })
    .from(signals)
    .innerJoin(clusters, eq(clusters.id, signals.clusterId))
    .innerJoin(issuers, eq(issuers.cik, signals.issuerCik))
    .leftJoin(agentEvaluations, eq(agentEvaluations.id, signals.latestAgentEvalId))
    .where(and(isNull(signals.alertedAt), ne(signals.status, 'superseded'), gte(signals.signalAt, new Date(now.getTime() - ALERT_WINDOW_DAYS * DAY_MS))));

  let sent = 0;
  for (const r of rows) {
    const s = { ...r, totalValue: Number(r.totalValue), baselineScore: num(r.baselineScore) };
    if (!meetsThreshold(s, cfg.minScore)) continue;
    const res = await sendTelegram(signalAlertMessage(s, process.env.AUTH_URL));
    if (!res.ok) {
      log('signal alert failed', { signalId: r.id, error: res.error }, 'error');
      continue;
    }
    await db.update(signals).set({ alertedAt: now }).where(eq(signals.id, r.id));
    sent++;
  }
  return { sent };
}

/**
 * Alerts on a job that "succeeds" while quietly ingesting or producing nothing: no new filing accepted
 * in `FILING_STALE_BUSINESS_DAYS` business days (SEC changed the index format, the feed is empty), or no
 * new signal in `SIGNAL_STALE_DAYS` days (ingest is fine but detection or scoring stopped). Neither
 * condition shows up as a job failure. Re-alerts periodically while the condition persists rather than
 * once and never again, and clears once it resolves, so the next occurrence alerts fresh.
 */
export async function checkPipelineFreshness(db: Db, now: Date = new Date()): Promise<{ filingsStale: boolean; signalsStale: boolean }> {
  const [flags, cfg, state] = await Promise.all([
    getFlags(db),
    getSetting(db, NOTIFICATIONS_KEY, notificationsSchema),
    getSetting(db, FRESHNESS_KEY, freshnessAlertsSchema),
  ]);
  const today = chicagoToday(now);
  const [[{ latestFiling }], [{ latestSignal }]] = await Promise.all([
    db.execute<{ latestFiling: string | null }>(sql`select max(${filings.acceptedAt} at time zone 'America/Chicago')::date as "latestFiling" from ${filings}`).then((r) => r.rows),
    db.execute<{ latestSignal: string | null }>(sql`select max(${signals.signalAt} at time zone 'America/Chicago')::date as "latestSignal" from ${signals} where ${signals.status} <> 'superseded'`).then((r) => r.rows),
  ]);

  const decision = decideFreshness({
    today,
    filingsCutoff: priorBusinessDays(today, FILING_STALE_BUSINESS_DAYS).at(-1)!.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3'),
    signalsCutoff: chicagoToday(new Date(now.getTime() - SIGNAL_STALE_DAYS * 86_400_000)),
    latestFilingDay: latestFiling,
    latestSignalDay: latestSignal,
  });

  const canSend = flags.notifications && cfg.pipelineStale && telegramConfigured();
  const sendFilings = shouldAlert(decision.filingsStale, state.filingsStaleAlertedOn, today) && canSend;
  const sendSignals = shouldAlert(decision.signalsStale, state.signalsStaleAlertedOn, today) && canSend;

  if (sendFilings) {
    const res = await sendTelegram(staleFilingsMessage(latestFiling, FILING_STALE_BUSINESS_DAYS));
    if (!res.ok) log('stale-filings notice failed', { error: res.error }, 'error');
  }
  if (sendSignals) {
    const res = await sendTelegram(staleSignalsMessage(latestSignal, SIGNAL_STALE_DAYS));
    if (!res.ok) log('stale-signals notice failed', { error: res.error }, 'error');
  }

  await saveSetting(db, FRESHNESS_KEY, freshnessAlertsSchema, {
    filingsStaleAlertedOn: nextAlertedOn(decision.filingsStale, sendFilings, today, state.filingsStaleAlertedOn),
    signalsStaleAlertedOn: nextAlertedOn(decision.signalsStale, sendSignals, today, state.signalsStaleAlertedOn),
  });

  return decision;
}

/** Tells the user a job failed, if notifications are on. Never throws. */
export async function notifyJobFailure(db: Db, job: string, error: string): Promise<void> {
  try {
    const [flags, cfg] = await Promise.all([getFlags(db), getSetting(db, NOTIFICATIONS_KEY, notificationsSchema)]);
    if (!flags.notifications || !cfg.jobFailures || !telegramConfigured()) return;
    const res = await sendTelegram(jobFailureMessage(job, error));
    if (!res.ok) log('job failure notice failed', { job, error: res.error }, 'error');
  } catch (err) {
    log('job failure notice failed', { job, error: err instanceof Error ? err.message : String(err) }, 'error');
  }
}
