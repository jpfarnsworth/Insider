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
