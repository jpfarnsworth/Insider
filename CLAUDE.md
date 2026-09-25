# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Insider Signals: a single-user research platform that ingests SEC Form 4 filings, detects clusters of insider
open-market purchases, scores them (deterministic baseline + Claude agent), and tracks forward returns vs. SPY.
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
npm run fixtures:fetch -- YYYYMMDD ...   # re-download real Form 4 fixtures (see tests/fixtures)
```

## Architecture

- **Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4 + shadcn/ui (dark by default), Drizzle ORM on
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
- `requireUser()` (`lib/auth/require-user.ts`) is the real check. Call it in **every** page, route handler, server
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
  and its adviser both reported the same 1,000,000 shares at $15). Cluster detection (milestone 4) must dedupe
  identical transactions across filings and not count related entities as distinct insiders.
- Filers abbreviate security titles ("Comm Stock - $.16-2/3 value"); see `lib/form4/normalize.ts`.
- `ticker` comes from `refresh-tickers` (SEC's company_tickers_exchange.json). A filing's own trading symbol is only
  a fallback for issuers not in that file and never overwrites it.

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
(`insider-dev.nginx`, `insider-dev.jpfarnsworth.com`, port 3040). Prod is Amazon Lightsail
(`insider.jpfarnsworth.com`). Ports 3000–3005, 3010, 3020, 3021, 3033 belong to other projects.
