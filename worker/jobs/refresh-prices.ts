import type { Db } from '@/lib/db';
import { createAlpacaClient, resolveAlpacaCredentials } from '@/lib/alpaca/client';
import { chicagoToday } from '@/lib/edgar/dates';
import { refreshCalendar, refreshPrices } from '@/lib/market/store';
import type { JobResult } from '../run-job';

/** Trading calendar plus daily bars for every signal ticker and the benchmarks (spec §3.3). */
export async function refreshPricesJob(db: Db): Promise<JobResult> {
  const alpaca = createAlpacaClient(resolveAlpacaCredentials());
  const today = chicagoToday();
  const calendarDays = await refreshCalendar(db, alpaca, today);
  const stats = await refreshPrices(db, alpaca, today);
  return { itemsProcessed: stats.bars, meta: { calendarDays, ...stats } };
}
