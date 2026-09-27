import { and, eq, gte, isNull } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { agentEvaluations, clusters, issuers, signals } from '@/db/schema';
import { getFlags } from '@/lib/flags';
import { getSetting } from '@/lib/settings';
import { log } from '@/lib/log';
import { meetsThreshold, signalAlertMessage, jobFailureMessage } from './format';
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
    .where(and(isNull(signals.alertedAt), gte(signals.signalAt, new Date(now.getTime() - ALERT_WINDOW_DAYS * DAY_MS))));

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
