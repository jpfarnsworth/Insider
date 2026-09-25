// Entry point for scheduled jobs:  npm run worker -- <job> [--dates=YYYYMMDD,...] [--days=N]
import { db, pool } from '@/lib/db';
import { createEdgarClient, resolveUserAgent } from '@/lib/edgar/client';
import { chicagoToday, priorBusinessDays } from '@/lib/edgar/dates';
import { drizzleJobStore, runJob, type JobResult } from './run-job';
import { ingestDailyIndex } from './jobs/ingest-daily-index';
import { refreshTickers } from './jobs/refresh-tickers';
import { JOB_NAMES, type JobName } from './job-names';

const DEFAULT_LOOKBACK_DAYS = 3;

function flag(args: string[], name: string): string | undefined {
  return args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function datesFromArgs(args: string[]): string[] {
  const explicit = flag(args, 'dates');
  if (explicit) {
    const dates = explicit.split(',');
    if (dates.some((d) => !/^\d{8}$/.test(d))) throw new Error('--dates must be YYYYMMDD,YYYYMMDD,...');
    return dates;
  }
  const days = Number(flag(args, 'days') ?? DEFAULT_LOOKBACK_DAYS);
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error('--days must be 1-30');
  return priorBusinessDays(chicagoToday(), days);
}

async function main() {
  const [name, ...args] = process.argv.slice(2);
  if (!JOB_NAMES.includes(name as JobName)) {
    throw new Error(`Usage: npm run worker -- <${JOB_NAMES.join('|')}> [--dates=...] [--days=N]`);
  }

  const client = createEdgarClient({ userAgent: resolveUserAgent() });
  const jobs: Record<JobName, () => Promise<JobResult>> = {
    'refresh-tickers': () => refreshTickers(db, client),
    'ingest-daily-index': () => ingestDailyIndex(db, client, datesFromArgs(args)),
  };

  await runJob(drizzleJobStore(db), name, jobs[name as JobName]);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
