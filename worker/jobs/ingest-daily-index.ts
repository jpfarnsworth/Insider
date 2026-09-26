import type { Db } from '@/lib/db';
import { EdgarError, type EdgarClient } from '@/lib/edgar/client';
import { dailyIndexUrl, parseDailyIndex, parseSubmission } from '@/lib/edgar/filings';
import { parseForm4 } from '@/lib/form4';
import { mapFiling, type ParseOutcome } from '@/lib/ingest/map-filing';
import { existingAccessions, relinkAmendments, storeFiling } from '@/lib/ingest/store';
import { log } from '@/lib/log';
import type { JobResult } from '../run-job';

const FETCH_CONCURRENCY = 8;

/**
 * EDGAR has no index for holidays: 404, or 403 on some. Both mean "nothing filed", but a
 * run where many days are missing more likely means the SEC is refusing us (bad
 * User-Agent, blocked IP), which must fail loudly instead of looking like a quiet run.
 */
export function tooManyMissingIndexes(missing: number, total: number): boolean {
  return missing > 3 && missing > total * 0.1;
}

interface DayStats {
  date: string;
  indexed: number;
  alreadyStored: number;
  stored: number;
  parseFailed: number;
  fetchFailed: number;
  note?: string;
}

/**
 * Queues every Form 4 / 4/A in the given days' EDGAR daily indexes, fetches and
 * parses each, and stores the result. Safe to re-run: filings already stored are
 * skipped before any network request, and one bad filing never stops the batch.
 * Looking back a few days (not just yesterday) lets a missed run heal itself.
 */
export async function ingestDailyIndex(db: Db, client: EdgarClient, dates: string[]): Promise<JobResult> {
  const days: DayStats[] = [];
  const failedDays: string[] = [];
  const noIndex: string[] = [];

  for (const date of dates) {
    const stats: DayStats = { date, indexed: 0, alreadyStored: 0, stored: 0, parseFailed: 0, fetchFailed: 0 };
    days.push(stats);

    let indexText: string;
    try {
      indexText = await client.getText(dailyIndexUrl(date));
    } catch (err) {
      // No index means EDGAR was closed (holiday) or the day isn't published yet.
      if (err instanceof EdgarError && (err.status === 404 || err.status === 403)) {
        noIndex.push(date);
        stats.note = 'no index (holiday or not yet published)';
        log('no daily index', { date });
        continue;
      }
      // Any other failure loses only this day; the rest of the batch still runs and
      // the job is failed at the end so it is visible (rerunning retries the day).
      stats.note = `index failed: ${err instanceof Error ? err.message : String(err)}`;
      failedDays.push(date);
      log('daily index failed', { date, error: stats.note }, 'error');
      continue;
    }

    const filings = parseDailyIndex(indexText);
    stats.indexed = filings.length;
    const have = await existingAccessions(db, filings.map((f) => f.accession));
    const todo = filings.filter((f) => !have.has(f.accession));
    stats.alreadyStored = filings.length - todo.length;
    log('ingesting day', { date, indexed: filings.length, todo: todo.length });

    // Fetches and writes overlap; the shared rate limiter still caps EDGAR at 8 req/s.
    let done = 0;
    const next = todo[Symbol.iterator]();
    const worker = async () => {
      for (let item = next.next(); !item.done; item = next.next()) {
        const f = item.value;
        try {
          const sub = parseSubmission(await client.getText(f.url));

          let outcome: ParseOutcome;
          try {
            if (!sub.xml) throw new Error('No XML document in this submission');
            outcome = { parsed: parseForm4(sub.xml) };
          } catch (err) {
            outcome = { error: err instanceof Error ? err.message : String(err) };
            stats.parseFailed++;
            log('parse failed', { accession: f.accession, error: outcome.error }, 'warn');
          }

          if ((await storeFiling(db, mapFiling(f.url, sub, outcome))) === 'stored') stats.stored++;
        } catch (err) {
          // Not stored, so the next run retries it.
          stats.fetchFailed++;
          log('filing failed', { accession: f.accession, error: err instanceof Error ? err.message : String(err) }, 'warn');
        }
        if (++done % 100 === 0) log('progress', { date, done, of: todo.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, todo.length) }, worker));
  }

  const relinked = await relinkAmendments(db);
  const stored = days.reduce((n, d) => n + d.stored, 0);
  if (tooManyMissingIndexes(noIndex.length, dates.length)) {
    throw new Error(`No daily index for ${noIndex.length} of ${dates.length} days (EDGAR 403/404), which is more than holidays explain`);
  }
  if (failedDays.length) {
    throw new Error(`Daily index failed for ${failedDays.length} day(s): ${failedDays.slice(0, 10).join(', ')}`);
  }
  return { itemsProcessed: stored, meta: { days, amendmentsRelinked: relinked } };
}
