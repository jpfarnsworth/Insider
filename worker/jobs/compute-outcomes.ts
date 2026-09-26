import type { Db } from '@/lib/db';
import { computeAndStoreOutcomes } from '@/lib/market/outcomes-store';
import type { JobResult } from '../run-job';

/** Fills forward-return horizons that have matured (spec §7). */
export async function computeOutcomesJob(db: Db): Promise<JobResult> {
  const stats = await computeAndStoreOutcomes(db);
  return { itemsProcessed: stats.rowsWritten, meta: { ...stats } };
}
