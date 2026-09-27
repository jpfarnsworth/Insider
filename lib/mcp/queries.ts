import { asc, eq, sql } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { isHeldOut, loadHoldoutFrom } from '@/lib/research/holdout';
import { agentEvaluations, clusterTransactions, clusters, filings, insiders, issuers, signalOutcomes, signals, transactions } from '@/db/schema';

const num = (v: string | null) => (v === null ? null : Number(v));

/** One signal with its cluster, both scores, the purchases behind it and every outcome. Null if the id is unknown. */
export async function getSignalDetail(db: Db, id: string) {
  const [s] = await db
    .select({
      id: signals.id,
      signalAt: signals.signalAt,
      status: signals.status,
      entryDate: signals.entryDate,
      entryPrice: signals.entryPrice,
      tags: signals.tags,
      baselineScore: signals.baselineScore,
      baselineVersion: signals.baselineVersion,
      baselineBreakdown: signals.baselineBreakdown,
      issuerCik: issuers.cik,
      ticker: issuers.ticker,
      issuer: issuers.name,
      clusterStatus: clusters.status,
      windowStart: clusters.windowStart,
      windowEnd: clusters.windowEnd,
      insiderCount: clusters.insiderCount,
      totalValue: clusters.totalValue,
      clusterId: clusters.id,
      evalId: agentEvaluations.id,
      agentScore: agentEvaluations.score,
      conviction: agentEvaluations.conviction,
      agentModel: agentEvaluations.model,
      promptVersion: agentEvaluations.promptVersion,
      agentOutput: agentEvaluations.output,
      agentAt: agentEvaluations.createdAt,
    })
    .from(signals)
    .innerJoin(clusters, eq(clusters.id, signals.clusterId))
    .innerJoin(issuers, eq(issuers.cik, signals.issuerCik))
    .leftJoin(agentEvaluations, eq(agentEvaluations.id, signals.latestAgentEvalId))
    .where(eq(signals.id, id))
    .limit(1);
  if (!s) return null;

  const heldFrom = await loadHoldoutFrom(db);
  const held = isHeldOut(s.signalAt.getTime(), heldFrom);
  const [purchases, outcomes] = await Promise.all([
    db
      .select({
        insider: insiders.name,
        transactionDate: transactions.transactionDate,
        acceptedAt: filings.acceptedAt,
        accessionNo: filings.accessionNo,
        shares: transactions.shares,
        price: transactions.price,
        value: transactions.value,
        sharesOwnedAfter: transactions.sharesOwnedAfter,
        is10b5_1: transactions.is10b5_1,
      })
      .from(clusterTransactions)
      .innerJoin(transactions, eq(transactions.id, clusterTransactions.transactionId))
      .innerJoin(insiders, eq(insiders.cik, transactions.insiderCik))
      .innerJoin(filings, eq(filings.id, transactions.filingId))
      .where(eq(clusterTransactions.clusterId, s.clusterId))
      .orderBy(asc(filings.acceptedAt), asc(transactions.transactionDate)),
    held ? Promise.resolve([]) : db.select().from(signalOutcomes).where(eq(signalOutcomes.signalId, s.id)).orderBy(asc(signalOutcomes.horizonDays), asc(signalOutcomes.benchmarkTicker)),
  ]);

  return {
    id: s.id,
    company: { cik: s.issuerCik, ticker: s.ticker, name: s.issuer },
    signalAt: s.signalAt.toISOString(),
    signalStatus: s.status,
    tags: s.tags,
    entry: { date: s.entryDate, price: num(s.entryPrice) },
    cluster: {
      status: s.clusterStatus,
      window: [s.windowStart, s.windowEnd],
      insiders: s.insiderCount,
      totalValueUsd: Number(s.totalValue),
    },
    baseline: { score: num(s.baselineScore), formulaVersion: s.baselineVersion, breakdown: s.baselineBreakdown },
    agent: s.evalId
      ? { score: s.agentScore, conviction: s.conviction, model: s.agentModel, promptVersion: s.promptVersion, evaluatedAt: s.agentAt?.toISOString(), output: s.agentOutput }
      : null,
    purchases: purchases.map((p) => ({
      insider: p.insider,
      transactionDate: p.transactionDate,
      acceptedAt: p.acceptedAt.toISOString(),
      accessionNo: p.accessionNo,
      shares: num(p.shares),
      price: num(p.price),
      valueUsd: num(p.value),
      sharesOwnedAfter: num(p.sharesOwnedAfter),
      is10b5_1: p.is10b5_1,
    })),
    holdout: held ? `Held out from ${heldFrom}: outcomes are withheld until the holdout is lifted in Settings.` : null,
    outcomes: outcomes.map((o) => ({
      horizonDays: o.horizonDays,
      benchmark: o.benchmarkTicker,
      status: o.status,
      exitDate: o.exitDate,
      returnPct: num(o.returnPct),
      benchmarkReturnPct: num(o.benchmarkReturnPct),
      excessReturnPct: num(o.excessReturnPct),
      maxDrawdownPct: num(o.maxDrawdownPct),
    })),
  };
}

/** Latest run per job, plus filing parse health. */
export async function getPipelineStatus(db: Db) {
  const [jobs, filingStats, activeClusters] = await Promise.all([
    db.execute<{ job_name: string; status: string; started_at: Date; finished_at: Date | null; items: number; error: string | null }>(sql`
      select distinct on (job_name) job_name, status, started_at, finished_at, items_processed as items, error
      from job_runs order by job_name, started_at desc`),
    db.execute<{ filings: number; failed: number; latest: Date | null }>(sql`
      select count(*)::int as filings, count(*) filter (where parse_status = 'failed')::int as failed, max(accepted_at) as latest from filings`),
    db.select({ n: sql<number>`count(*)::int` }).from(clusters).where(eq(clusters.status, 'active')),
  ]);
  const f = filingStats.rows[0];
  return {
    latestJobRuns: jobs.rows.map((j) => ({
      job: j.job_name,
      status: j.status,
      startedAt: new Date(j.started_at).toISOString(),
      finishedAt: j.finished_at ? new Date(j.finished_at).toISOString() : null,
      items: j.items,
      error: j.error,
    })),
    filings: { total: f?.filings ?? 0, parseFailures: f?.failed ?? 0, latestAcceptedAt: f?.latest ? new Date(f.latest).toISOString() : null },
    activeClusters: activeClusters[0]?.n ?? 0,
  };
}

