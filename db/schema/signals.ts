import {
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, timestamps } from './_helpers';
import { filings, issuers, transactions } from './filings';

export const clusters = pgTable(
  'clusters',
  {
    id: id(),
    issuerCik: text('issuer_cik')
      .notNull()
      .references(() => issuers.cik),
    status: text('status', { enum: ['active', 'closed'] }).notNull().default('active'),
    windowStart: date('window_start').notNull(),
    windowEnd: date('window_end').notNull(),
    insiderCount: integer('insider_count').notNull(),
    totalValue: numeric('total_value', { precision: 24, scale: 4 }).notNull(),
    firstQualifiedAt: timestamp('first_qualified_at', { withTimezone: true }),
    triggerFilingId: uuid('trigger_filing_id').references(() => filings.id),
    ruleVersion: integer('rule_version').notNull(),
    ...timestamps,
  },
  (t) => [index('clusters_issuer_cik_idx').on(t.issuerCik)],
);

export const clusterTransactions = pgTable(
  'cluster_transactions',
  {
    id: id(),
    clusterId: uuid('cluster_id')
      .notNull()
      .references(() => clusters.id, { onDelete: 'cascade' }),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (t) => [uniqueIndex('cluster_transactions_unique').on(t.clusterId, t.transactionId)],
);

export const clusterEvents = pgTable(
  'cluster_events',
  {
    id: id(),
    clusterId: uuid('cluster_id')
      .notNull()
      .references(() => clusters.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [index('cluster_events_cluster_id_idx').on(t.clusterId)],
);

export const signals = pgTable(
  'signals',
  {
    id: id(),
    clusterId: uuid('cluster_id')
      .notNull()
      .unique()
      .references(() => clusters.id),
    issuerCik: text('issuer_cik')
      .notNull()
      .references(() => issuers.cik),
    signalAt: timestamp('signal_at', { withTimezone: true }).notNull(),
    entryDate: date('entry_date'),
    entryPrice: numeric('entry_price', { precision: 20, scale: 4 }),
    baselineScore: numeric('baseline_score', { precision: 5, scale: 2 }),
    baselineVersion: integer('baseline_version'),
    // Per-component points and notes, so the score can be explained (spec §5.1).
    baselineBreakdown: jsonb('baseline_breakdown'),
    // Points at agent_evaluations.id; intentionally not an FK to avoid a
    // circular dependency between the two tables.
    latestAgentEvalId: uuid('latest_agent_eval_id'),
    status: text('status', { enum: ['active', 'amended', 'data_ended'] })
      .notNull()
      .default('active'),
    tags: text('tags').array().notNull().default([]),
    ...timestamps,
  },
  (t) => [index('signals_signal_at_idx').on(t.signalAt)],
);

export const agentEvaluations = pgTable(
  'agent_evaluations',
  {
    id: id(),
    signalId: uuid('signal_id')
      .notNull()
      .references(() => signals.id, { onDelete: 'cascade' }),
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    inputBundle: jsonb('input_bundle').notNull(),
    output: jsonb('output'),
    score: integer('score'),
    conviction: text('conviction', { enum: ['low', 'medium', 'high'] }),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    latencyMs: integer('latency_ms'),
    status: text('status', { enum: ['ok', 'agent_failed'] }).notNull(),
    error: text('error'),
    ...timestamps,
  },
  (t) => [index('agent_evaluations_signal_id_idx').on(t.signalId)],
);

export const signalOutcomes = pgTable(
  'signal_outcomes',
  {
    id: id(),
    signalId: uuid('signal_id')
      .notNull()
      .references(() => signals.id, { onDelete: 'cascade' }),
    horizonDays: integer('horizon_days').notNull(),
    exitDate: date('exit_date'),
    exitPrice: numeric('exit_price', { precision: 20, scale: 4 }),
    returnPct: numeric('return_pct', { precision: 12, scale: 6 }),
    benchmarkTicker: text('benchmark_ticker').notNull().default('SPY'),
    benchmarkReturnPct: numeric('benchmark_return_pct', { precision: 12, scale: 6 }),
    excessReturnPct: numeric('excess_return_pct', { precision: 12, scale: 6 }),
    maxDrawdownPct: numeric('max_drawdown_pct', { precision: 12, scale: 6 }),
    status: text('status', { enum: ['pending', 'complete', 'data_ended'] })
      .notNull()
      .default('pending'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('signal_outcomes_signal_horizon_bench_unique').on(
      t.signalId,
      t.horizonDays,
      t.benchmarkTicker,
    ),
  ],
);
