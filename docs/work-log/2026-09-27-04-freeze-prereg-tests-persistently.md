# Freeze each pre-registered test's result persistently, once, forever

Outside review caught a serious gap: H1 and H3 recomputed on whatever population currently qualified (90+ signals, 30+ tagged), which meant the result would keep changing as more holdout signals matured -- a running number you could watch drift across zero and stop on when it looked good. That's the classic optional-stopping problem, and it would have undone the whole point of pre-registering. H2 already fixed its population size (earliest 300), but had the same quieter exposure: nothing stopped a late-filed Form 4 (this has happened -- TRIN, 221 days late) or a later-restated price from silently changing which 300 signals counted, or their answer, after the fact.

## What changed
- New table `prereg_results` (migration `0008_majestic_war_machine.sql`): one row per test, unique on `test_id`, holding the exact signal ids used, the estimate/interval/status, and the freeze timestamp (`created_at`). Never updated after insert.
- `lib/analytics/prereg-store.ts`: `PreregStore` interface (`get`/`freeze`), a real `drizzlePreregStore(db)` (insert with `onConflictDoNothing`, always read back afterward, so two concurrent requests both crossing the threshold at once still agree on one answer -- first writer wins), and a `memoryPreregStore()` for tests.
- H1 and H3's selection rules now fix a snapshot the moment they first qualify, sorted by signal date, matching H2's existing "earliest 300" pattern: H1 takes the earliest 90 signals with a matured outcome; H3 takes the earliest prefix (tagged and untagged together) whose tagged count first reaches 30. Neither grows again after that.
- `evaluatePrereg` (sync, no persistence) is replaced by `evaluateOfficialPrereg` (async, store-backed): checks the store first and returns the frozen result verbatim if one exists; otherwise computes on the fixed snapshot and freezes it the moment it resolves. `evaluateGates` is now async for the same reason, taking an optional `preregStore` (defaults to an in-memory one, never `db`, to keep this module and its tests free of a database dependency at import time).
- All five call sites updated (Performance page, Settings page, `holdoutAction`, MCP `get_performance`, plus `evaluateGates`'s internal call) to await the new async chain and pass the real `drizzlePreregStore(db)`.

## Verified
- 456 tests pass, including a new case that freezes H1 at exactly 90 signals, then feeds it 50 more (much worse) signals and confirms the result is byte-for-byte unchanged, and a case confirming a second call reads back the same frozen row rather than recomputing.
- Against the real database: exercised the store's actual SQL (insert, conflict, read-back, first-writer-wins with two different payloads) using a scratch test id that is not one of the three real ones, then deleted it. Confirmed the real `prereg_results` table has zero rows (no test has resolved, since no holdout signals exist yet), so nothing was frozen prematurely by any of tonight's changes.
- Rebuilt, restarted, confirmed `/`, `/performance`, `/settings` and MCP `get_performance` all still work end to end.

## A process note (from review)
Testing the masking mechanism two entries ago involved temporarily moving the live holdout date and restoring it exactly -- harmless (that data had already been seen, and the lock now blocks the same move going forward), but the right way to test this kind of thing is a copy of the database, not live settings. Noted for next time.
