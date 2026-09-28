# Rename trader to insider

Renamed the app from `trader` to `insider` everywhere it's identified, clearing the name for a new, separate
`trader` repo that will hold the upcoming Alpaca trading app (Phase 2). This had to happen first: creating a
repo named `trader` before the rename would have cancelled GitHub's redirect from the old name.

## What changed

- GitHub repo `jpfarnsworth/Trader` renamed to `jpfarnsworth/Insider` (`gh repo rename`, sets up the redirect).
- Directory moved from `~/Projects/trader/v1` to `~/Projects/insider/v1`, matching the `~/Projects/<name>/v1`
  convention used by every other app on this Pi. `.env.local` and the `backup/pre-ci-removal` branch moved
  with it; git remote repointed to the new GitHub URL.
- All 6 scheduled PM2 apps from `ecosystem.config.js` (`insider-signals-dev`, `insider-refresh-tickers`,
  `insider-ingest-daily-index`, `insider-refresh-prices`, `insider-compute-outcomes`, `insider-check-freshness`)
  deleted and restarted from the new path, since PM2 stores absolute paths and a plain restart wouldn't have
  picked up the move.
- `CLAUDE.md`'s reference to the spec issue's repo (`jpfarnsworth/Trader` -> `jpfarnsworth/Insider`) updated.

## Decisions

- `insider-backfill` (a manually-started, one-off PM2 entry for the resumable backfill job) was not part of
  `ecosystem.config.js` and was already stopped before this change; it was deleted along with the others but
  not recreated, since it isn't part of the scheduled fleet. Run `npm run worker -- backfill` directly (or
  `pm2 start` it ad hoc) next time it's needed.
- Nginx (`insider-dev.nginx` / `/etc/nginx/sites-available/insider-dev`), crontab, and `package.json` needed no
  changes: none of them contain a path or name reference to `trader` (nginx only proxies by port, the one
  related cron entry already used database names, and `package.json`'s `name` was already `insider-signals`).

## Verified

- `git fetch`/`git status` clean from the new remote; `backup/pre-ci-removal` branch present.
- All 6 PM2 entries show `pm_cwd` under `/home/johnathan/Projects/insider/v1` after `pm2 save`.
- `sudo nginx -t` passed and nginx reloaded without error.
- `https://insider.jpfarnsworth.com` returns its sign-in redirect; `/api/mcp` returns 401 (route is up).
- `npm run worker -- check-freshness` ran from the new path and wrote a fresh `job_runs` row.

## Follow-ups

- None. The old `Trader` GitHub name now redirects to `Insider`; a new `trader` repo can be created for the
  Alpaca app.
