# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Insider Signals: a single-user research platform that ingests SEC Form 4 filings, detects clusters of insider
open-market purchases, scores them (deterministic baseline + an LLM agent, Gemini 2.5 Flash), and tracks forward returns vs. SPY.
**Phase 1 has no trading of any kind.** The full spec is GitHub issue #1 on `jpfarnsworth/Trader`; read it before
changing behavior. Build order is spec §14 (milestones 1–9).

## Commands

```bash
npm run dev            # dev server on 0.0.0.0:3040 (Turbopack)
npm run dev:local      # localhost only
npm run build && npm run start
npm run lint
npm run typecheck
npm test               # vitest
npm run test:coverage  # enforces 100% coverage on lib/form4 (spec §3.2)
npm run db:generate    # drizzle-kit: generate SQL from db/schema (works offline)
npm run db:migrate     # apply migrations as insider_migrator (explicit deploy step, never on app start)
npm run db:studio
npm run set-password   # set/change the sign-in password (needs a real terminal)
npm run worker -- refresh-tickers
npm run worker -- ingest-daily-index [--dates=YYYYMMDD,...] [--days=N]   # default: last 3 weekdays
npm run worker -- backfill [--from=YYYY-MM-DD --to=YYYY-MM-DD]   # default: 2 years back; resumable, newest first
npm run worker -- detect-clusters   # rebuild clusters/signals; idempotent (also runs after ingest and backfill)
npm run worker -- score-baseline [--force]   # score new signals, or all of them with --force
npm run worker -- refresh-prices   # trading calendar + daily bars (Alpaca) for signal tickers, SPY, IWM
npm run worker -- score-agent [--limit=N]   # Gemini evaluations under the daily cap; --limit overrides the cap for one run
npm run worker -- compute-outcomes   # forward returns for matured horizons
npm run worker -- alert-signals   # Telegram alerts for new signals at/above the score threshold (no-op unless notifications are on)
npm run fixtures:fetch -- YYYYMMDD ...   # re-download real Form 4 fixtures (see tests/fixtures)
```

## Architecture

- **Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4 + shadcn/ui (warm light theme by default, blue accent, DM Sans; tokens shared with Life OS/Tasks), Drizzle ORM on
  AWS PostgreSQL via `pg`, Auth.js v5, Vitest. npm, not pnpm/yarn.
- **Layout:** `app/` routes, `components/`, `lib/` shared code (`db`, `auth`, `edgar`, `form4`, `clusters`, `agent`),
  `worker/` scheduled jobs, `db/schema` (source of truth), `db/migrations` (generated), `tests/fixtures` (real Form 4 XML).
- **Path alias:** `@/*` maps to the repo root.
- **Schema:** snake_case, UUID PKs except natural keys (`issuers.cik`, `insiders.cik`, `price_bars` ticker+date),
  `created_at`/`updated_at` on every table. Money and share counts are `numeric`, not float.

## Database and roles

Same AWS Postgres server as `tasks`, `life-os`, `workout` and `offload`, with its own databases: `insider_signals`
(prod) and `insider_signals_dev`. Two roles, neither superuser (`db/setup-roles.sql` provisions them):

- `insider_app` — DML only. `DATABASE_URL`. Used by the web app and workers.
- `insider_migrator` — DDL. `DATABASE_MIGRATOR_URL`. Used only by `db:migrate` / `drizzle.config.ts`.

Never point the app at the migrator role. Never commit credentials; `.env.local` is gitignored, and
`.env.local.example` lists every variable.

## Auth (spec §6.0, §13)

Email + password (Auth.js Credentials, bcrypt hash in `users.password_hash`), single allowlisted email
(`ALLOWED_EMAIL`, `lib/auth/allowlist.ts`). Set the password with `npm run set-password`. Sessions are signed JWT cookies
(7 days), a deliberate deviation from the spec's DB sessions: Auth.js can't store database sessions with the Credentials
provider. They can't be revoked server-side; rotating `AUTH_SECRET` signs everything out. Failed logins are throttled
per IP (`lib/auth/rate-limit.ts`, in-memory).
There is no Row Level Security, so access control is entirely in code:

- `proxy.ts` (Next 16's middleware) only checks that a session cookie *exists*. It is not proof of a valid session.
- `requireUser()` (`lib/auth/require-user.ts`) is the real check. Call it in **every** page, route handler (except `/api/mcp`, which uses its bearer token), server
  action and data-access function. Layouts do not re-run on client navigation, so the layout check is not enough.

## Ingestion (verified against live EDGAR)

- Source: the daily form index (`form.YYYYMMDD.idx`). A filing is listed once per filer (issuer and each owner), so
  the same accession repeats: **dedupe by accession** (618 rows were 297 filings). The filing's full-submission `.txt`
  gives both the acceptance datetime and the XML in one request.
- `ACCEPTANCE-DATETIME` is **Eastern time** with no zone marker (`lib/edgar/time.ts` converts to UTC, DST-aware).
  Real acceptances fall 06:00-22:00 ET, EDGAR's operating hours.
- Ingest is idempotent: stored accessions are skipped before any network call, so the job looks back a few days and
  heals missed runs. A filing that fails to parse is stored (`parse_status='failed'`, raw XML kept) and shows on
  `/system`; "Retry parse" re-runs the parser on the stored XML.
- A 4/A's XML has no original accession, only `dateOfOriginalSubmission`. The original is inferred from issuer + a
  shared owner + that date (`lib/ingest/store.ts`); unlinked amendments are retried at the end of every ingest.
- **Joint filings:** each transaction is stored once, attributed to the filing's first owner; other owners are in
  `filing_owners`. Real data shows the same purchase can also arrive in *separate* filings by related filers (a fund
  and its adviser both reported the same 1,000,000 shares at $15). Cluster detection dedupes
  identical transactions across filings so related entities don't count as distinct insiders.
- Filers abbreviate security titles ("Comm Stock - $.16-2/3 value"); see `lib/form4/normalize.ts`.
- `ticker` comes from `refresh-tickers` (SEC's company_tickers_exchange.json). A filing's own trading symbol is only
  a fallback for issuers not in that file and never overwrites it.

## Clusters and scoring (milestone 4)

- `lib/clusters/detect.ts` is pure and deterministic (per issuer); `lib/clusters/store.ts` loads purchases and reconciles
  the result into `clusters`, `cluster_transactions`, `cluster_events` and `signals`. Parameters live in `settings`
  (`cluster_rule`), defaults in `lib/clusters/rule.ts`; bump `CLUSTER_RULE_VERSION` when the logic (not a parameter) changes.
- Purchases arrive in acceptance order; the signal time is the acceptance of the filing that first completed the rule and
  never moves after creation. Identical transactions in different filings (fund + adviser) count once, and a filing that a
  parsed 4/A amends is replaced by the amendment's transactions.
- A stored cluster that detection no longer produces is left alone, never deleted, because its signal may carry scores.
- `lib/scoring/baseline.ts` is the deterministic score (weights in `settings` as `baseline_weights`, breakdown stored in
  `signals.baseline_breakdown`). Components without data (e.g. market cap, still empty) are re-weighted, not zeroed.
  Bump `BASELINE_VERSION` when the formula changes; `score-baseline` re-scores older versions. v2 adds the price-context
  component in milestone 5. Sales counted against a signal are limited to filings accepted by the signal time.

## Prices and outcomes (milestone 5)

- Alpaca client `lib/alpaca/client.ts` (3 req/s, backoff). Feed is SIP by default (`ALPACA_DATA_FEED=iex` for the free
  feed, which omits days with no IEX trades). The free plan refuses SIP for the latest day, so the end date steps back
  automatically and prices lag by about one session. Calendar comes from Alpaca and is cached in `market_days`.
- `price_bars` holds raw OHLCV plus `adj_close`. Adjusted history is restated by later splits/dividends, so
  `refresh-prices` compares the overlap with what is stored and refetches a ticker's whole history on any drift.
  Adjusted open = open x adj_close/close.
- Entry = first session whose open is after `accepted_at` (`lib/market/calendar.ts`). Horizons 5/10/30/60/90 count the entry
  day as day 1; exit is that day's close. Excess = stock return minus SPY or IWM return over the same dates. Max drawdown is
  close-based, the peak starting at the entry price. A ticker whose data ends keeps its signal as `data_ended`.
- `compute-outcomes` recomputes everything and writes only changed rows. Net returns subtract a round-trip cost at display
  time (`lib/market/costs.ts`: 0.30%, or 1.0% below $1M average daily dollar volume or with unknown volume).
- Ticker fallbacks from a filing's own symbol are filtered (`usableSymbol`): filers write NONE, N/A and CIKs there.
- After ingest and backfill the worker chains: detect-clusters, refresh-prices, score-baseline, compute-outcomes. Each is its
  own `job_runs` row and one failing does not skip the rest.

## Agent scoring (milestone 6)

- One model, `gemini-2.5-flash` (`lib/agent/models.ts`, which also holds its training cutoff). `lib/agent/provider.ts` is the
  interface, `gemini.ts` the implementation (key in an `x-goog-api-key` header, JSON-constrained output, thinking budget capped,
  timeout and backoff). Changing the model means changing that file, and adding its cutoff.
- The input bundle (`bundle.ts`) is built in code as of the signal time: purchases with roles and footnotes, the insiders' prior
  history in that issuer (3 years), other insiders' 90-day sales, price context from bars strictly before the signal's Eastern
  day, and 8-K titles from EDGAR submissions (only filings accepted by then). It never contains the baseline score, so the two
  scorers stay independent. Filing text in it is untrusted; the prompt says so, and the model has no tools.
- Output is Zod-validated (`schema.ts`). Invalid JSON is retried once with the error fed back, then stored as `agent_failed`.
  An evaluation never throws into the pipeline. Prompts are versioned files in `lib/agent/prompts/`: add v2, never edit v1.
- Evaluations are only ever inserted, never updated. `signals.latest_agent_eval_id` points at the latest successful one.
  "Re-score with current prompt" (signal page) adds a new row. Pending signals are picked post-cutoff first (only those count
  toward the gates), newest first; a signal that failed 3 times, or in the last 6 hours, is skipped.
- Limits live in `settings` (`agent_limits`: daily cap 50, monthly token budget, per-token prices for the estimate). The daily
  cap governs the scheduled job; the monthly budget also blocks manual re-scores. Spend shows on `/system`.
- Feature flags (`lib/flags.ts`) are read from `settings` (`feature_flags`); `agent_scoring` is on by default.

## Analytics and pages (milestone 7)

- `lib/analytics/` is pure and tested: `stats.ts` (mean/median/hit rate/t-stat; **buckets under 20 observations are
  "insufficient data"**, never numbers), `facts.ts` (a `SignalFact` per signal; `excessAt` counts only *complete* outcomes and
  subtracts the cost tier when net), `gates.ts` (spec §11), `dashboard.ts`. `load.ts` reads everything in a few queries.
- Only complete outcomes count anywhere; pending and data_ended are excluded. Score "deciles" are 10-point bands (LLM scores
  clump on round numbers, so rank deciles would split ties arbitrarily). Top tiers: agent >= 70, baseline top third (ties at
  the boundary are included). Correlation is Spearman.
- Evaluation gates always use post-cutoff signals, net of costs, at 30 days, whatever the page toggles say. Gate 2 uses the
  union tier (agent >= 70 or baseline top third). Gate 3 passes either way once both tiers have 20+ signals ("agent wins" or
  "drop the agent"). Gate 4 is "insufficient" until the pipeline has 30 days of history, then needs parse errors < 1% and
  successful-ingest weekdays > 95%.
- Prices are stored only for tickers that have a signal. So company charts and insider track records have no returns for
  other tickers; the UI says so rather than showing made-up numbers.
- Charts are hand-written SVG (`components/charts/`, `price-chart.tsx`, `company-chart.tsx`): hover/keyboard tooltip, a table
  view, series colours from `--viz-*` tokens (validated with the dataviz palette check), and shape or sign never colour alone.
- `signals.avg_dollar_volume` (set by compute-outcomes) picks the round-trip cost tier for net returns.
- Market cap is still empty (no data source wired), so the market-cap rule filter and the size-vs-market-cap score component
  are inactive; the score redistributes their weight.

## Settings, search, export and alerts (milestone 8)

- **Settings** (`/settings`) edits `cluster_rule`, `baseline_weights`, `trading_costs`, `display` (default benchmark), `agent_limits`,
  `feature_flags` and `notifications` in `settings`. Save through `saveSetting` (`lib/settings.ts`): it validates with the
  key's Zod schema, and every real change appends a numbered row to `setting_versions` (a save that changes nothing is a
  no-op). `clusters.rule_revision` and `signals.baseline_revision` record which revision produced them. Saving never rewrites
  history: the cluster rule applies to new detections (run detect-clusters to apply it to history) and new weights apply to
  new signals until "Re-score all signals" (`score-baseline --force`) is pressed.
- "Preview impact" (`previewClusterRule`) runs detection in memory and reports signals and companies gained/lost versus the
  saved rule. It compares per company, because a looser rule fires earlier on the same buying, so per-signal add/drop counts are misleading.
- **Signals list** filters live in `lib/signals/filters.ts` (pure, tested); the same query string drives the page, the CSV
  (`/signals/export`) and saved presets (`saved_filters`). Filtering is in memory over `loadSignalRows`. No market-cap or
  sector filter: no data source. CSV cells starting `= + - @` are prefixed with `'` (filings text is untrusted).
- **Search** (⌘K / Ctrl+K, or `/`): `lib/search.ts` behind `/api/search` (401 JSON when unauthenticated, same check as
  `requireUser`). Matches ticker/company, insider name and accession number.
- **Notifications** are Telegram, send-only (`lib/notify/`), like the Tasks/Life OS bots but its own bot: `TELEGRAM_BOT_TOKEN`
  and `TELEGRAM_CHAT_ID` in `.env.local`, plus the `notifications` flag. Job failures notify from `runJob`'s `onFailure`;
  `alert-signals` (chained after ingest and after a standalone `score-agent`) alerts once per signal
  (`signals.alerted_at`) when the baseline or agent score reaches the threshold, only for signals under 3 days old so enabling
  it never replays history. Messages are HTML-escaped; errors never include the bot token.
- The dashboard still compares against SPY; the default-benchmark setting drives Performance and the signals list.

## MCP server (Phase 2 groundwork)

- `/api/mcp` (`app/api/mcp/route.ts`) is a read-only MCP server over HTTP, built like the Life OS one: stateless (fresh
  `McpServer` + transport per request), open CORS for claude.ai's connector, bearer token `MCP_READ_TOKEN` (>= 32 chars,
  constant-time compare, closed if unset). `proxy.ts` lets `/api/mcp` through, so the route's own `checkMcpAuth` is the access
  check: the one deliberate exception to "requireUser everywhere". Every request is logged to `mcp_request_logs` (no arguments).
- Tools (`lib/mcp/tools.ts`): `list_signals`, `get_signal`, `get_performance`, `search`, `pipeline_status`. Thin adapters over
  `lib/signals`, `lib/analytics`, `lib/search` and `lib/mcp/queries.ts`, so numbers match the UI. Filing and agent text is
  untrusted and the tool descriptions say so.
- Phase 2 trading tools must not go on this token: add a separate `MCP_READWRITE_TOKEN` with its own scope check, as Life OS does.
- Connect: claude.ai custom connector at `https://insider.jpfarnsworth.com/api/mcp` with the token; or Claude Code:
  `claude mcp add --transport http insider-signals http://localhost:3040/api/mcp --header "Authorization: Bearer $(grep ^MCP_READ_TOKEN= .env.local | cut -d= -f2-)"`.

## Research integrity: holdout, tags, portfolio (post-milestone-8)

- **Holdout** (`lib/research/holdout.ts`, setting `holdout`, default from 2026-10-01): signals from that Chicago day on carry **no
  outcomes** from `loadSignalFacts` (so no aggregate, tier, gate, list, CSV or MCP number can see them), and the signal page,
  company page, insider track record and MCP `get_signal` show "held out". Reveal it in Settings once the design is frozen; that
  save is a versioned setting change, so revealing leaves a record. Price charts on company pages still show raw prices. Any rule
  or score tweak made after looking at post-cutoff results makes that data less out-of-sample: judge changes on the holdout.
- **Tags** (`lib/clusters/tags.ts`, `signals.tags`): `single_day_single_price` marks clusters whose purchases were all one day at
  one price (offering / IPO / conversion allotments). Set by `detect-clusters`; it does not change whether a signal exists. The
  signals list, CSV, MCP and Performance can exclude them; the gates always use every signal. The rule came from looking at
  post-cutoff results (they average far worse), so treat a better number after excluding them as a hypothesis until the holdout confirms it.
- **Calendar-time portfolio** (`lib/analytics/portfolio.ts`, `portfolio-load.ts`): every signal held equal-weight for N sessions from
  its entry open; daily excess vs benchmark; t-stat with Newey-West errors. This is the honest test, because per-signal statistics
  treat overlapping, same-week signals as independent. Note it weights each *day* equally, so sparse early periods count more than
  per-signal averages do; the two can differ. Its per-signal return math reproduces `signal_outcomes` exactly.
- **Dollar volume**: `signals.avg_dollar_volume` picks the cost tier and unknown counts as thin (1.0%). It was found empty for 96%
  of signals (stale until `compute-outcomes` re-ran), overstating costs. `/system` now shows how many signals lack it; run compute-outcomes if it is high.
- Gemini: the request has no `tools` (no Search grounding); the model's documented cutoff is January 2025 (`lib/agent/models.ts`).

## Rules that are easy to get wrong

- **Timing:** all return math keys off the filing's **acceptance datetime** (`filings.accepted_at`), not the
  transaction date. Entry is the next regular-session open after acceptance, even for filings accepted intraday.
- **SEC compliance:** every EDGAR request needs the `SEC_USER_AGENT` header and must go through the shared rate
  limiter (≤ 8 req/s, backoff on 429/503).
- **Jobs** write to `job_runs`, are idempotent and resumable, and must not abort a batch on one bad item.
- **Amendments (4/A):** keep history, never silently overwrite.
- **Agent look-ahead:** the agent may only see the supplied data as of the signal date; evaluation gates use
  post-model-cutoff signals only.

## Deployment

Dev runs on this Raspberry Pi under PM2 (`ecosystem.config.js`, app `insider-signals-dev`) behind nginx
(`insider-dev.nginx`, port 3040) and is served at `insider.jpfarnsworth.com` for now (`AUTH_URL` matches). PM2 runs `next start`
on the production build, so after changing code run `npm run build` and then `pm2 restart insider-signals-dev`; a restart alone
serves the old build. Server components can't pass functions to client components (charts take format specs from
`components/charts/formats.ts`); typecheck doesn't catch this, only loading the page does. Prod will be Amazon Lightsail; move the prod hostname there when it exists. Ports 3000–3005, 3010, 3020, 3021, 3033 belong to other projects.
