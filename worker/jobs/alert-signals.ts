import type { Db } from '@/lib/db';
import { alertNewSignals } from '@/lib/notify/alerts';
import type { JobResult } from '../run-job';

/** Sends Telegram alerts for new signals that reach the score threshold (no-op unless notifications are on). */
export async function alertSignalsJob(db: Db): Promise<JobResult> {
  const { sent } = await alertNewSignals(db);
  return { itemsProcessed: sent };
}
