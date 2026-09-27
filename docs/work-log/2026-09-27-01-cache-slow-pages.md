# Cache the dashboard and Performance pages

Both pages were taking 11-14 seconds to load. Dashboard and Performance dropped to about 5-6s and about 1.8s respectively (Pi contention still adds noise to the dashboard's remaining DB calls).

## What was slow and why
- `loadSignalFacts` (6.4s cold): mostly per-connection latency to the remote AWS Postgres, not a bad query plan; the base/outcomes/roles sub-queries are individually fast once a connection is warm.
- `findBuildingClusters` (6.1s): re-runs cluster detection with the rule relaxed by one insider over every candidate issuer, same cost as "Preview impact" in Settings.
- `loadPortfolio` (3.5s): its own lateral-join query per signal's held bars.
- The dashboard's "recent buys" panel: a full scan and sort of all 250k+ transactions (2.3s), because no index supported `where code='P' and not is_derivative order by transaction_date desc, value desc`.

## What changed
- `lib/analytics/cache.ts`: `unstable_cache`-wraps `loadSignalFacts`, `loadPipelineHealth`, `loadPortfolio` and `findBuildingClusters` under one tag, 60s TTL. Used by the dashboard, Performance, and MCP's `list_signals`/`get_performance` (same Next.js server process).
- Settings' shared `save()` helper now also calls `updateTag(ANALYTICS_TAG)` (Next 16's `revalidateTag` now requires a cache-life profile argument; `updateTag` is the one meant for immediate invalidation from a Server Action).
- `transactions_recent_buys_idx`: a partial btree index `(transaction_date desc, value desc) where code='P' and not is_derivative`. Migration `0007_odd_swarm.sql`.

## Decisions
- Jobs run as a separate `npm run worker` CLI process and can't call into the Next.js server's cache, so background changes (new signal, new score, matured outcome) surface within the 60s TTL rather than instantly. Given the pipeline's own cadence (cron every 15-90 min, or a manual trigger), a minute of staleness was judged an acceptable trade for cutting page loads by 5-10x. Settings-driven changes (costs, benchmark, flags, holdout) still invalidate immediately, since those saves run in this same process.

## Verified
- 446 tests pass. Timed page loads before/after with a minted session cookie: Performance 14s to consistently ~1.8s; dashboard ~11-14s to ~5-6.5s typical (occasional slower runs track the Pi's load average, which was 3.8-4 on 4 cores from other projects, not this app).
