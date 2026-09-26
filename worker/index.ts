// Entry point for scheduled jobs:  npm run worker -- <job> [--dates=YYYYMMDD,...] [--days=N] [--from=YYYY-MM-DD --to=YYYY-MM-DD] [--limit=N]
import { db, pool } from '@/lib/db';
import { createEdgarClient, resolveUserAgent } from '@/lib/edgar/client';
import { chicagoToday, priorBusinessDays, weekdaysBetween, yearsBefore } from '@/lib/edgar/dates';
import { drizzleJobStore, runJob, type JobResult } from './run-job';
import { ingestDailyIndex } from './jobs/ingest-daily-index';
import { refreshTickers } from './jobs/refresh-tickers';
import { detectClustersJob } from './jobs/detect-clusters';
import { scoreBaselineJob } from './jobs/score-baseline';
import { refreshPricesJob } from './jobs/refresh-prices';
import { computeOutcomesJob } from './jobs/compute-outcomes';
import { scoreAgentJob } from './jobs/score-agent';
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

// --limit=N overrides the daily evaluation cap for one run (the monthly token budget still applies).
function limitFromArgs(args: string[]): number | undefined {
  const raw = flag(args, 'limit');
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error('--limit must be a non-negative integer');
  return n;
}

const BACKFILL_YEARS = 2;

// Default: two years back through yesterday (spec §14 step 3). Already stored
// filings are skipped, so an interrupted backfill resumes by running it again.
function backfillDates(args: string[]): string[] {
  const today = chicagoToday();
  const yesterday = priorBusinessDays(today, 1)[0];
  const to = flag(args, 'to') ?? `${yesterday.slice(0, 4)}-${yesterday.slice(4, 6)}-${yesterday.slice(6)}`;
  const from = flag(args, 'from') ?? yearsBefore(today, BACKFILL_YEARS);
  if (![from, to].every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))) throw new Error('--from/--to must be YYYY-MM-DD');
  if (from > to) throw new Error('--from must not be after --to');
  return weekdaysBetween(from, to);
}

async function main() {
  const [name, ...args] = process.argv.slice(2);
  if (!JOB_NAMES.includes(name as JobName)) {
    throw new Error(`Usage: npm run worker -- <${JOB_NAMES.join('|')}> [--dates=...] [--days=N] [--from=...] [--to=...]`);
  }

  const client = createEdgarClient({ userAgent: resolveUserAgent() });
  const jobs: Record<JobName, () => Promise<JobResult>> = {
    'refresh-tickers': () => refreshTickers(db, client),
    'ingest-daily-index': () => ingestDailyIndex(db, client, datesFromArgs(args)),
    backfill: () => ingestDailyIndex(db, client, backfillDates(args)),
    'detect-clusters': () => detectClustersJob(db),
    'score-baseline': () => scoreBaselineJob(db, { force: args.includes('--force') }),
    'score-agent': () => scoreAgentJob(db, { limit: limitFromArgs(args) }),
    'refresh-prices': () => refreshPricesJob(db),
    'compute-outcomes': () => computeOutcomesJob(db),
  };

  const store = drizzleJobStore(db);
  const ingesting = name === 'ingest-daily-index' || name === 'backfill';
  try {
    await runJob(store, name, jobs[name as JobName]);
  } catch (err) {
    // An ingest that failed partway still stored what it got, so the pipeline runs on that.
    if (!ingesting) throw err;
    process.exitCode = 1;
  }

  // Detection follows every ingest, then prices, scoring and outcomes (spec §8). Each step
  // is recorded on its own, and one failing (e.g. Alpaca is down) doesn't skip the rest.
  if (ingesting) {
    for (const next of ['detect-clusters', 'refresh-prices', 'score-baseline', 'score-agent', 'compute-outcomes'] as const) {
      try {
        await runJob(store, next, jobs[next]);
      } catch {
        process.exitCode = 1;
      }
    }
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
