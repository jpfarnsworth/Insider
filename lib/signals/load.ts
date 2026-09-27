import { eq } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { clusters, signals } from '@/db/schema';
import { loadSignalFacts } from '@/lib/analytics/load';
import type { SignalRow } from './filters';

/** Every signal as a list row. Filtering and sorting happen in memory (hundreds of rows, not millions). */
export async function loadSignalRows(db: Db): Promise<SignalRow[]> {
  const [facts, statuses] = await Promise.all([
    loadSignalFacts(db),
    db.select({ id: signals.id, status: clusters.status }).from(signals).innerJoin(clusters, eq(clusters.id, signals.clusterId)),
  ]);
  const byId = new Map(statuses.map((s) => [s.id, s.status]));
  return facts.map((f) => ({ ...f, clusterStatus: byId.get(f.id) ?? 'closed' }));
}
