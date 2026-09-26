import type { Db } from '@/lib/db';
import { chicagoToday } from '@/lib/edgar/dates';
import { detectAndStoreClusters } from '@/lib/clusters/store';
import type { JobResult } from '../run-job';

/** Builds and updates clusters and creates signals (spec §4.2). Idempotent. */
export async function detectClustersJob(db: Db): Promise<JobResult> {
  const stats = await detectAndStoreClusters(db, chicagoToday());
  return { itemsProcessed: stats.created, meta: { ...stats } };
}
