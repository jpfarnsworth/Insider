import { and, asc, desc, eq, gte, inArray, lt, lte, notInArray, sql } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import {
  agentEvaluations,
  clusters,
  clusterTransactions,
  filingOwners,
  filings,
  insiders,
  issuers,
  priceBars,
  signals,
  transactions,
} from '@/db/schema';
import type { EdgarClient } from '@/lib/edgar/client';
import { barsBefore, etDate } from '@/lib/market/asof';
import { toAlpacaSymbol } from '@/lib/market/store';
import { getSetting } from '@/lib/settings';
import { buildBundle, type AgentBundle, type HistoryRow } from './bundle';
import { recentEightKs, submissionsUrl, type EightKList } from './eightk';
import { evaluateBundle, type EvaluationResult } from './evaluate';
import { stopReason, type StopReason, type Usage } from './limits';
import { AGENT_LIMITS_KEY, AGENT_MODEL, agentLimitsSchema, type AgentLimits } from './models';
import { PROMPT_VERSION } from './prompts/v1';
import type { LlmProvider } from './provider';
import { log } from '@/lib/log';

const DAY_MS = 86_400_000;
const BARS_NEEDED = 300; // a year of sessions plus slack
const HISTORY_YEARS = 3;
const MAX_FAILURES = 3;
const RETRY_AFTER_FAILURE_HOURS = 6;

const CHICAGO_DAY = sql`(date_trunc('day', now() at time zone 'America/Chicago') at time zone 'America/Chicago')`;
const CHICAGO_MONTH = sql`(date_trunc('month', now() at time zone 'America/Chicago') at time zone 'America/Chicago')`;

export const loadAgentLimits = (db: Db): Promise<AgentLimits> => getSetting(db, AGENT_LIMITS_KEY, agentLimitsSchema);

/** Everything the model sees for one signal, as of the signal time. Null if the signal doesn't exist. */
export async function loadBundle(db: Db, edgar: EdgarClient | null, signalId: string): Promise<AgentBundle | null> {
  const [s] = await db
    .select({
      clusterId: signals.clusterId,
      issuerCik: signals.issuerCik,
      signalAt: signals.signalAt,
      name: issuers.name,
      ticker: issuers.ticker,
      industry: issuers.industry,
      marketCap: issuers.marketCap,
      windowStart: clusters.windowStart,
      windowEnd: clusters.windowEnd,
      insiderCount: clusters.insiderCount,
      totalValue: clusters.totalValue,
    })
    .from(signals)
    .innerJoin(clusters, eq(clusters.id, signals.clusterId))
    .innerJoin(issuers, eq(issuers.cik, signals.issuerCik))
    .where(eq(signals.id, signalId))
    .limit(1);
  if (!s) return null;

  const members = await db
    .select({
      id: transactions.id,
      insiderCik: transactions.insiderCik,
      insider: insiders.name,
      isOfficer: filingOwners.isOfficer,
      officerTitle: filingOwners.officerTitle,
      isDirector: filingOwners.isDirector,
      isTenPctOwner: filingOwners.isTenPctOwner,
      transactionDate: transactions.transactionDate,
      shares: transactions.shares,
      price: transactions.price,
      sharesOwnedAfter: transactions.sharesOwnedAfter,
      ownership: transactions.ownership,
      acceptedAt: filings.acceptedAt,
      footnotes: transactions.footnotes,
    })
    .from(clusterTransactions)
    .innerJoin(transactions, eq(transactions.id, clusterTransactions.transactionId))
    .innerJoin(insiders, eq(insiders.cik, transactions.insiderCik))
    .innerJoin(filings, eq(filings.id, transactions.filingId))
    .leftJoin(
      filingOwners,
      and(eq(filingOwners.filingId, transactions.filingId), eq(filingOwners.insiderCik, transactions.insiderCik)),
    )
    .where(eq(clusterTransactions.clusterId, s.clusterId))
    .orderBy(asc(transactions.transactionDate), desc(transactions.value));

  const memberIds = members.map((m) => m.id);
  const insiderCiks = [...new Set(members.map((m) => m.insiderCik))];
  const historyFrom = new Date(s.signalAt.getTime() - HISTORY_YEARS * 365 * DAY_MS).toISOString().slice(0, 10);
  const salesFrom = new Date(s.signalAt.getTime() - 90 * DAY_MS).toISOString().slice(0, 10);

  const [history, [sales], bars, eightKs] = await Promise.all([
    // The insiders' other activity here, known by the signal time. Not the cluster's own purchases.
    db
      .select({
        insiderCik: transactions.insiderCik,
        insider: insiders.name,
        transactionDate: transactions.transactionDate,
        code: transactions.code,
        acquiredDisposed: transactions.acquiredDisposed,
        shares: transactions.shares,
        price: transactions.price,
        isDerivative: transactions.isDerivative,
      })
      .from(transactions)
      .innerJoin(filings, eq(filings.id, transactions.filingId))
      .innerJoin(insiders, eq(insiders.cik, transactions.insiderCik))
      .where(
        and(
          eq(transactions.issuerCik, s.issuerCik),
          inArray(transactions.insiderCik, insiderCiks),
          notInArray(transactions.id, memberIds),
          gte(transactions.transactionDate, historyFrom),
          lte(filings.acceptedAt, s.signalAt),
          eq(filings.parseStatus, 'parsed'),
        ),
      )
      .orderBy(desc(transactions.transactionDate))
      .limit(2000),
    db
      .select({
        count: sql<number>`count(*)::int`,
        total: sql<string>`coalesce(sum(${transactions.shares} * ${transactions.price}), 0)`,
      })
      .from(transactions)
      .innerJoin(filings, eq(filings.id, transactions.filingId))
      .where(
        and(
          eq(transactions.issuerCik, s.issuerCik),
          eq(transactions.code, 'S'),
          eq(transactions.acquiredDisposed, 'D'),
          eq(transactions.isDerivative, false),
          gte(transactions.transactionDate, salesFrom),
          lte(filings.acceptedAt, s.signalAt),
          eq(filings.parseStatus, 'parsed'),
          notInArray(transactions.insiderCik, insiderCiks),
        ),
      ),
    s.ticker
      ? db
          .select({ date: priceBars.date, close: priceBars.close, adjClose: priceBars.adjClose, volume: priceBars.volume })
          .from(priceBars)
          .where(and(eq(priceBars.ticker, toAlpacaSymbol(s.ticker)), lt(priceBars.date, etDate(s.signalAt))))
          .orderBy(desc(priceBars.date))
          .limit(BARS_NEEDED)
      : Promise.resolve([]),
    fetchEightKs(edgar, s.issuerCik, s.signalAt),
  ]);

  const historyRows: HistoryRow[] = history.map((h) => ({
    ...h,
    shares: h.shares === null ? null : Number(h.shares),
    price: h.price === null ? null : Number(h.price),
  }));

  return buildBundle({
    signalAt: s.signalAt,
    issuer: { name: s.name, ticker: s.ticker, industry: s.industry, marketCap: s.marketCap === null ? null : Number(s.marketCap) },
    cluster: { windowStart: s.windowStart, windowEnd: s.windowEnd, insiderCount: s.insiderCount, totalValue: Number(s.totalValue) },
    purchases: members.map((m) => ({
      ...m,
      shares: Number(m.shares),
      price: Number(m.price),
      sharesOwnedAfter: m.sharesOwnedAfter === null ? null : Number(m.sharesOwnedAfter),
    })),
    history: historyRows,
    otherSales: { count: sales.count, totalValue: Number(sales.total) },
    bars: barsBefore(
      bars
        .map((b) => ({ date: b.date, close: Number(b.close), adjClose: Number(b.adjClose), volume: b.volume }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      s.signalAt,
    ),
    eightKs,
  });
}

async function fetchEightKs(edgar: EdgarClient | null, cik: string, signalAt: Date): Promise<EightKList | null> {
  if (!edgar) return null;
  try {
    return recentEightKs(await edgar.getJson(submissionsUrl(cik)), signalAt);
  } catch (err) {
    // A missing 8-K list is a data gap the model is told about, not a reason to skip the signal.
    log('8-K list unavailable', { cik, error: err instanceof Error ? err.message : String(err) }, 'warn');
    return null;
  }
}

/** Stores an evaluation as a NEW row (spec §5.2: never overwrite) and points the signal at it when it succeeded. */
export async function saveEvaluation(db: Db, signalId: string, model: string, bundle: AgentBundle, r: EvaluationResult): Promise<string> {
  const [row] = await db
    .insert(agentEvaluations)
    .values({
      signalId,
      model,
      promptVersion: PROMPT_VERSION,
      inputBundle: bundle,
      output: r.status === 'ok' ? r.output : { raw: r.raw },
      score: r.status === 'ok' ? r.output.score : null,
      conviction: r.status === 'ok' ? r.output.conviction : null,
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
      latencyMs: r.latencyMs,
      status: r.status,
      error: r.status === 'agent_failed' ? r.error.slice(0, 2000) : null,
    })
    .returning({ id: agentEvaluations.id });
  if (r.status === 'ok') await db.update(signals).set({ latestAgentEvalId: row.id }).where(eq(signals.id, signalId));
  return row.id;
}

/** Evaluates one signal end to end. Never throws for a model or data problem; a failure is recorded. */
export async function evaluateSignal(db: Db, provider: LlmProvider, edgar: EdgarClient | null, signalId: string) {
  const bundle = await loadBundle(db, edgar, signalId);
  if (!bundle) return null;
  const result = await evaluateBundle(provider, bundle);
  await saveEvaluation(db, signalId, provider.model, bundle, result);
  return result;
}

/** Usage against the caps, on the Chicago calendar day and month. */
export async function agentUsage(db: Db): Promise<Usage & { tokensInMonth: number; tokensOutMonth: number; failedToday: number; failedMonth: number; evaluationsMonth: number }> {
  const [row] = await db
    .select({
      evaluationsToday: sql<number>`count(*) filter (where ${agentEvaluations.createdAt} >= ${CHICAGO_DAY})::int`,
      failedToday: sql<number>`count(*) filter (where ${agentEvaluations.createdAt} >= ${CHICAGO_DAY} and ${agentEvaluations.status} = 'agent_failed')::int`,
      evaluationsMonth: sql<number>`count(*)::int`,
      failedMonth: sql<number>`count(*) filter (where ${agentEvaluations.status} = 'agent_failed')::int`,
      tokensInMonth: sql<number>`coalesce(sum(${agentEvaluations.tokensIn}), 0)::bigint`,
      tokensOutMonth: sql<number>`coalesce(sum(${agentEvaluations.tokensOut}), 0)::bigint`,
    })
    .from(agentEvaluations)
    .where(gte(agentEvaluations.createdAt, CHICAGO_MONTH));
  const tokensInMonth = Number(row.tokensInMonth);
  const tokensOutMonth = Number(row.tokensOutMonth);
  return { ...row, tokensInMonth, tokensOutMonth, tokensThisMonth: tokensInMonth + tokensOutMonth };
}

/**
 * Signals still without a successful evaluation, in the order they are worth spending on:
 * those after the model's training cutoff first (only they count toward the evaluation
 * gates), newest first. One that has failed repeatedly, or just failed, is skipped for now.
 */
export async function pickCandidates(db: Db, limit: number): Promise<string[]> {
  const rows = await db
    .select({ id: signals.id })
    .from(signals)
    .where(
      and(
        sql`${signals.latestAgentEvalId} is null`,
        sql`(select count(*) from ${agentEvaluations} e where e.signal_id = ${signals.id} and e.status = 'agent_failed') < ${MAX_FAILURES}`,
        sql`not exists (select 1 from ${agentEvaluations} e where e.signal_id = ${signals.id} and e.status = 'agent_failed' and e.created_at > now() - make_interval(hours => ${RETRY_AFTER_FAILURE_HOURS}))`,
      ),
    )
    .orderBy(sql`(${signals.signalAt}::date > ${AGENT_MODEL.trainingCutoff}::date) desc`, desc(signals.signalAt))
    .limit(limit);
  return rows.map((r) => r.id);
}

export interface AgentRunStats {
  evaluated: number;
  failed: number;
  stoppedBy: StopReason | 'nothing_left' | 'disabled' | null;
}

/** The score-agent job body: evaluate pending signals until the daily cap or the monthly budget is reached. */
export async function runAgentScoring(
  db: Db,
  provider: LlmProvider,
  edgar: EdgarClient | null,
  opts: { limit?: number } = {},
): Promise<AgentRunStats> {
  const limits = await loadAgentLimits(db);
  const usage = await agentUsage(db);
  const stats: AgentRunStats = { evaluated: 0, failed: 0, stoppedBy: null };

  // An explicit --limit is a deliberate override of the daily cap (e.g. the first backlog run);
  // the monthly token budget still applies.
  const dailyCap = opts.limit ?? limits.dailyCap;
  const remaining = Math.max(0, dailyCap - (opts.limit === undefined ? usage.evaluationsToday : 0));
  const candidates = await pickCandidates(db, remaining);

  let tokens = usage.tokensThisMonth;
  for (const id of candidates) {
    const reason = stopReason({ evaluationsToday: 0, tokensThisMonth: tokens }, limits, { ignoreDailyCap: true });
    if (reason) {
      stats.stoppedBy = reason;
      break;
    }
    const r = await evaluateSignal(db, provider, edgar, id);
    if (!r) continue;
    stats.evaluated++;
    if (r.status === 'agent_failed') stats.failed++;
    tokens += r.tokensIn + r.tokensOut;
  }
  if (!stats.stoppedBy) {
    // Ran out of candidates before the cap, or used the whole cap.
    stats.stoppedBy = remaining === 0 || candidates.length >= remaining ? 'daily_cap' : 'nothing_left';
  }
  return stats;
}
