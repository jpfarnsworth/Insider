import { eq } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { jobRuns } from '@/db/schema';
import { log } from '@/lib/log';

export interface JobResult {
  itemsProcessed: number;
  meta?: Record<string, unknown>;
}

export interface JobStore {
  start(jobName: string): Promise<string>;
  finish(
    id: string,
    patch: { status: 'success' | 'failed'; itemsProcessed: number; error: string | null; meta: Record<string, unknown> },
  ): Promise<void>;
}

export function drizzleJobStore(db: Db): JobStore {
  return {
    async start(jobName) {
      const [row] = await db.insert(jobRuns).values({ jobName }).returning({ id: jobRuns.id });
      return row.id;
    },
    async finish(id, patch) {
      await db
        .update(jobRuns)
        .set({ ...patch, finishedAt: new Date() })
        .where(eq(jobRuns.id, id));
    },
  };
}

/**
 * Records a job's run in job_runs (spec §8): started, then success or failed
 * with the error. Failures are rethrown so the process exits non-zero.
 * Notification on failure hooks in here in milestone 8.
 */
export async function runJob(store: JobStore, jobName: string, job: () => Promise<JobResult>): Promise<JobResult> {
  const id = await store.start(jobName);
  log('job started', { job: jobName, runId: id });
  try {
    const result = await job();
    await store.finish(id, {
      status: 'success',
      itemsProcessed: result.itemsProcessed,
      error: null,
      meta: result.meta ?? {},
    });
    log('job finished', { job: jobName, runId: id, items: result.itemsProcessed });
    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await store.finish(id, { status: 'failed', itemsProcessed: 0, error: error.slice(0, 2000), meta: {} });
    log('job failed', { job: jobName, runId: id, error }, 'error');
    throw err;
  }
}
