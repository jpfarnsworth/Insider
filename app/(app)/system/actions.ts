'use server';

import { spawn } from 'node:child_process';
import { and, eq, gt } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { jobRuns } from '@/db/schema';
import { requireUser } from '@/lib/auth/require-user';
import { reparseFiling } from '@/lib/ingest/store';
import { JOB_NAMES, type JobName } from '@/worker/job-names';

const RECENT_MS = 60 * 60 * 1000;

export async function retryParse(formData: FormData) {
  await requireUser();
  await reparseFiling(db, String(formData.get('id')));
  revalidatePath('/system');
}

// Workers run on the same server as the web app (spec §2), so a manual run is
// the same CLI the scheduler uses, started as a detached process.
export async function runJobNow(formData: FormData) {
  await requireUser();
  const name = String(formData.get('job'));
  if (!JOB_NAMES.includes(name as JobName)) throw new Error('Unknown job');

  const [running] = await db
    .select({ id: jobRuns.id })
    .from(jobRuns)
    .where(and(eq(jobRuns.jobName, name), eq(jobRuns.status, 'running'), gt(jobRuns.startedAt, new Date(Date.now() - RECENT_MS))))
    .limit(1);
  if (!running) {
    spawn('npm', ['run', 'worker', '--', name], { cwd: process.cwd(), detached: true, stdio: 'ignore' }).unref();
  }
  revalidatePath('/system');
}
