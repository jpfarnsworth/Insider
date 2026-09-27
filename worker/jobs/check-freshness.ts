import type { Db } from '@/lib/db';
import { checkPipelineFreshness } from '@/lib/notify/alerts';
import type { JobResult } from '../run-job';

/** Alerts on a job that "succeeded" while quietly ingesting or producing nothing (lib/notify/freshness.ts). */
export async function checkFreshnessJob(db: Db): Promise<JobResult> {
  const decision = await checkPipelineFreshness(db);
  return { itemsProcessed: 0, meta: { ...decision } };
}
