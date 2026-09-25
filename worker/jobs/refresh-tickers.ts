import { isNull, sql } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { issuers } from '@/db/schema';
import type { EdgarClient } from '@/lib/edgar/client';
import { parseTickerFile, TICKERS_URL } from '@/lib/edgar/tickers';
import type { JobResult } from '../run-job';

/**
 * Refreshes the CIK -> ticker map from SEC's company_tickers_exchange.json
 * (spec §3.1). Updates ticker and exchange; never renames an issuer we already
 * know. Companies that dropped out of the file keep their last ticker.
 */
export async function refreshTickers(db: Db, client: EdgarClient): Promise<JobResult> {
  const entries = parseTickerFile(await client.getJson(TICKERS_URL));

  for (let i = 0; i < entries.length; i += 1000) {
    await db
      .insert(issuers)
      .values(entries.slice(i, i + 1000).map((e) => ({ cik: e.cik, name: e.name, ticker: e.ticker, exchange: e.exchange })))
      .onConflictDoUpdate({
        target: issuers.cik,
        set: { ticker: sql`excluded.ticker`, exchange: sql`excluded.exchange` },
      });
  }

  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(issuers).where(isNull(issuers.ticker));
  return { itemsProcessed: entries.length, meta: { companies: entries.length, issuersWithoutTicker: count } };
}
