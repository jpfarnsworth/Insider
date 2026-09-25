import type { Db } from '@/lib/db';
import { EdgarError, type EdgarClient } from '@/lib/edgar/client';
import { dailyIndexUrl, parseDailyIndex, parseSubmission } from '@/lib/edgar/filings';
import { parseForm4 } from '@/lib/form4';
import { mapFiling, type ParseOutcome } from '@/lib/ingest/map-filing';
import { existingAccessions, relinkAmendments, storeFiling } from '@/lib/ingest/store';
import { log } from '@/lib/log';
import type { JobResult } from '../run-job';

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

  for (const date of dates) {
    const stats: DayStats = { date, indexed: 0, alreadyStored: 0, stored: 0, parseFailed: 0, fetchFailed: 0 };
    days.push(stats);

    let indexText: string;
    try {
      indexText = await client.getText(dailyIndexUrl(date));
    } catch (err) {
      // No index means EDGAR was closed (holiday) or the day isn't published yet.
      if (err instanceof EdgarError && err.status === 404) {
        stats.note = 'no index (holiday or not yet published)';
        log('no daily index', { date });
        continue;
      }
      throw err;
    }

    const filings = parseDailyIndex(indexText);
    stats.indexed = filings.length;
    const have = await existingAccessions(db, filings.map((f) => f.accession));
    const todo = filings.filter((f) => !have.has(f.accession));
    stats.alreadyStored = filings.length - todo.length;
    log('ingesting day', { date, indexed: filings.length, todo: todo.length });

    for (const [i, f] of todo.entries()) {
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
      if ((i + 1) % 100 === 0) log('progress', { date, done: i + 1, of: todo.length });
    }
  }

  const relinked = await relinkAmendments(db);
  const stored = days.reduce((n, d) => n + d.stored, 0);
  return { itemsProcessed: stored, meta: { days, amendmentsRelinked: relinked } };
}
