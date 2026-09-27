import {
  bigint,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { id, timestamps } from './_helpers';
import { issuers } from './filings';

export const priceBars = pgTable(
  'price_bars',
  {
    ticker: text('ticker').notNull(),
    date: date('date').notNull(),
    open: numeric('open', { precision: 20, scale: 4 }).notNull(),
    high: numeric('high', { precision: 20, scale: 4 }).notNull(),
    low: numeric('low', { precision: 20, scale: 4 }).notNull(),
    close: numeric('close', { precision: 20, scale: 4 }).notNull(),
    adjClose: numeric('adj_close', { precision: 20, scale: 4 }).notNull(),
    volume: bigint('volume', { mode: 'number' }).notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.ticker, t.date] })],
);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  ...timestamps,
});

export const jobRuns = pgTable(
  'job_runs',
  {
    id: id(),
    jobName: text('job_name').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    status: text('status', { enum: ['running', 'success', 'failed'] })
      .notNull()
      .default('running'),
    itemsProcessed: integer('items_processed').notNull().default(0),
    error: text('error'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [index('job_runs_job_started_idx').on(t.jobName, t.startedAt)],
);

export const watchlist = pgTable('watchlist', {
  id: id(),
  issuerCik: text('issuer_cik')
    .notNull()
    .unique()
    .references(() => issuers.cik),
  note: text('note'),
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  ...timestamps,
});

// Trading calendar cached from Alpaca (spec §13): holidays and early closes.
export const marketDays = pgTable('market_days', {
  date: date('date').primaryKey(),
  // Eastern wall-clock HH:MM.
  open: text('open').notNull(),
  close: text('close').notNull(),
  ...timestamps,
});

// Every saved change to a settings row, oldest first. `version` counts per key from 1; the
// current value is still read from `settings`, so history can never break a job.
export const settingVersions = pgTable(
  'setting_versions',
  {
    id: id(),
    key: text('key').notNull(),
    version: integer('version').notNull(),
    value: jsonb('value').notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('setting_versions_key_version_idx').on(t.key, t.version)],
);

// Signals-list filter presets: `params` is the list's query string (see lib/signals/filters.ts).
export const savedFilters = pgTable('saved_filters', {
  id: id(),
  name: text('name').notNull().unique(),
  params: text('params').notNull(),
  ...timestamps,
});

// One row per request to /api/mcp (spec Phase 2 groundwork). No arguments or results are stored.
export const mcpRequestLogs = pgTable(
  'mcp_request_logs',
  {
    id: id(),
    method: text('method').notNull(),
    tool: text('tool'),
    authOutcome: text('auth_outcome', { enum: ['ok', 'missing_token', 'invalid_token', 'insufficient_scope'] }).notNull(),
    statusCode: integer('status_code').notNull(),
    ...timestamps,
  },
  (t) => [index('mcp_request_logs_created_at_idx').on(t.createdAt)],
);

// A pre-registered test's result, frozen exactly once (docs/preregistration.md). `createdAt` IS the
// freeze timestamp. Never updated afterward: a test that resolves stays resolved on the same signals,
// whatever data arrives later (a late-filed Form 4, a restated price). Prevents optional stopping
// (recomputing on a growing sample until it looks the way you want) and late-correction drift alike.
export const preregResults = pgTable('prereg_results', {
  id: id(),
  testId: text('test_id').notNull().unique(),
  n: integer('n').notNull(),
  signalIds: jsonb('signal_ids').$type<string[]>().notNull(),
  estimate: numeric('estimate', { precision: 14, scale: 6 }).notNull(),
  lo: numeric('lo', { precision: 14, scale: 6 }).notNull(),
  hi: numeric('hi', { precision: 14, scale: 6 }).notNull(),
  status: text('status', { enum: ['supported', 'not_supported'] }).notNull(),
  bootstraps: integer('bootstraps').notNull(),
  seed: integer('seed').notNull(),
  ...timestamps,
});
