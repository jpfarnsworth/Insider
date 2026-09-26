import type { Db } from '@/lib/db';
import { scoreBaseline } from '@/lib/scoring/store';
import type { JobResult } from '../run-job';

/** Baseline-scores signals that are new or were scored with an older formula. */
export async function scoreBaselineJob(db: Db, opts: { force?: boolean } = {}): Promise<JobResult> {
  const { scored } = await scoreBaseline(db, opts);
  return { itemsProcessed: scored };
}
