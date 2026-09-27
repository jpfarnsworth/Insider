# Alert on jobs that "succeed" but produce nothing

Notifications only fired on a thrown error. The quieter risk -- a job that exits successfully while the SEC index format changed, a feed returned empty, or detection/scoring silently regressed -- had no coverage at all: `job_runs.status = 'success'` would look fine forever while the pipeline produced nothing.

## What changed
- `lib/notify/freshness.ts`: pure decision logic (`decideFreshness`, `shouldAlert`, `nextAlertedOn`), tested. Two conditions: no filing accepted in 2 business days, no signal created in 14 days -- thresholds chosen well past normal week-to-week variation (the observed pace is roughly 24 signals/month).
- `checkPipelineFreshness` (`lib/notify/alerts.ts`): reads the freshest `filings.accepted_at` and `signals.signal_at` (Chicago dates), decides staleness, and alerts via Telegram. Re-alerts every 3 days while the condition persists (not once, not every run); clears automatically once it resolves, so a later recurrence alerts fresh. State lives in a new `pipeline_freshness_alerts` setting.
- New `check-freshness` job: chained after ingest and after a standalone `score-agent` (worker/index.ts), **and** given its own PM2 cron entry (daily 18:00 CT) so it still runs even if ingest's own cron never fires at all -- the scenario this exists to catch.
- New `pipelineStale` toggle in Settings' Notifications section (default on), alongside the existing signal-alert and job-failure toggles.

## Verified
- 465 tests pass, including 9 new pure-logic cases (staleness decision, first-alert vs re-alert timing, clearing on recovery).
- Ran `checkPipelineFreshness` against the real database: correctly reports not stale (filings and signals are both current), and wrote no alert state change.
- Ran the job via the worker CLI directly; registered and saved the new PM2 cron entry (`insider-check-freshness`, `0 18 * * *`), confirmed present in `pm2 jlist`.
