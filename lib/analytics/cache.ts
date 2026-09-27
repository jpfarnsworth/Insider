import { unstable_cache as nextCache } from 'next/cache';
import { db } from '@/lib/db';
import { loadPipelineHealth, loadSignalFacts } from './load';
import { loadPortfolio } from './portfolio-load';
import type { Bench } from './facts';
import type { Costs } from '@/lib/market/costs';

// Analytics tag: only settings saved through the web app (this process) can revalidateTag it, so
// changing costs, the default benchmark, feature flags or the holdout in Settings is instant. Jobs run
// as a separate `npm run worker` CLI process and cannot reach into the Next.js server's cache at all,
// so background changes (a new signal, a fresh score, a matured outcome) show up within the TTL below
// rather than immediately. 60s keeps the dashboard and Performance pages fast under repeat views
// without the site ever being more than a minute behind the pipeline.
export const ANALYTICS_TAG = 'analytics';
const TTL_SECONDS = 60;

/** Every signal with its scores, cluster, roles and outcomes (lib/analytics/load.ts). The slowest single query. */
export const getCachedSignalFacts = nextCache(() => loadSignalFacts(db), ['analytics-signal-facts'], { revalidate: TTL_SECONDS, tags: [ANALYTICS_TAG] });

/** Filing counts, parse failures and ingest uptime for the prior 30 days (lib/analytics/gates.ts). */
export const getCachedPipelineHealth = nextCache(() => loadPipelineHealth(db), ['analytics-pipeline-health'], { revalidate: TTL_SECONDS, tags: [ANALYTICS_TAG] });

/**
 * The calendar-time portfolio (lib/analytics/portfolio-load.ts). Its own DB round trip (one lateral
 * join per signal's held bars) is cached by its call arguments, so a repeat view with the same
 * benchmark/horizon/net toggle and the same signal set is instant.
 */
export const getCachedPortfolio = nextCache(
  (signalIds: string[], benchmark: Bench, holdDays: number, net: boolean, costs: Costs) => loadPortfolio(db, { signalIds, benchmark, holdDays, net, costs }),
  ['analytics-portfolio'],
  { revalidate: TTL_SECONDS, tags: [ANALYTICS_TAG] },
);

/**
 * "Active clusters building" (spec §9.2): re-runs detection with the rule relaxed by one insider over
 * every candidate issuer, same cost as "Preview impact" in Settings. Cached like the rest of the
 * dashboard's data.
 */
export const getCachedBuildingClusters = nextCache(
  async (asOf: string) => {
    const { findBuildingClusters } = await import('@/lib/clusters/store');
    return findBuildingClusters(db, asOf);
  },
  ['analytics-building-clusters'],
  { revalidate: TTL_SECONDS, tags: [ANALYTICS_TAG] },
);
