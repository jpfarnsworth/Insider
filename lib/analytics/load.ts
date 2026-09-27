import { eq, ne, sql } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { agentEvaluations, clusters, issuers, signalOutcomes, signals } from '@/db/schema';
import { isPostCutoff } from '@/lib/agent/models';
import { HOLDOUT_KEY, heldOutFrom, holdoutSchema, isHeldOut } from '@/lib/research/holdout';
import { getSetting } from '@/lib/settings';
import type { Bench, OutcomeFact, RoleMix, SignalFact } from './facts';
import type { PipelineHealth } from './gates';

const num = (v: string | null): number | null => (v === null ? null : Number(v));

/**
 * Every signal with its scores, cluster, roles and outcomes at every horizon. Read once per request.
 * Signals in the holdout window (lib/research/holdout.ts) come back with no outcomes, UNLESS
 * `opts.forTests` is set: the three pre-registered tests (lib/analytics/prereg.ts) need real holdout
 * outcomes to compute and display their own result as soon as each reaches its registered sample
 * size, without waiting for -- or exposing -- a manual reveal. Nothing else may use `forTests: true`:
 * it must never reach a signal page, a list, a CSV or an MCP tool, which all stay masked until reveal.
 */
export async function loadSignalFacts(db: Db, opts: { forTests?: boolean } = {}): Promise<SignalFact[]> {
  const [holdoutSettings, base, outcomes, roles] = await Promise.all([
    getSetting(db, HOLDOUT_KEY, holdoutSchema),
    db
      .select({
        id: signals.id,
        ticker: issuers.ticker,
        issuer: issuers.name,
        signalAt: signals.signalAt,
        baselineScore: signals.baselineScore,
        agentScore: agentEvaluations.score,
        conviction: agentEvaluations.conviction,
        insiderCount: clusters.insiderCount,
        totalValue: clusters.totalValue,
        marketCap: issuers.marketCap,
        industry: issuers.industry,
        avgDollarVolume: signals.avgDollarVolume,
        status: signals.status,
        clusterId: signals.clusterId,
        tags: signals.tags,
      })
      .from(signals)
      .innerJoin(clusters, eq(clusters.id, signals.clusterId))
      .innerJoin(issuers, eq(issuers.cik, signals.issuerCik))
      .leftJoin(agentEvaluations, eq(agentEvaluations.id, signals.latestAgentEvalId))
      // Duplicates of an earlier signal (lib/clusters/dedupe.ts) never count.
      .where(ne(signals.status, 'superseded')),
    db.select().from(signalOutcomes),
    // Same title rules as roleOf(): CEO/CFO first, then any officer, then a director.
    db.execute<{ cluster_id: string; ceo_cfo: boolean; officer: boolean; director: boolean }>(sql`
      select ct.cluster_id,
             coalesce(bool_or(fo.officer_title ~* '\\m(ceo|chief executive|cfo|chief financial)'), false) as ceo_cfo,
             coalesce(bool_or(fo.is_officer), false) as officer,
             coalesce(bool_or(fo.is_director), false) as director
      from cluster_transactions ct
      join transactions t on t.id = ct.transaction_id
      left join filing_owners fo on fo.filing_id = t.filing_id and fo.insider_cik = t.insider_cik
      group by ct.cluster_id`),
  ]);

  const heldFrom = opts.forTests ? null : heldOutFrom(holdoutSettings);
  const roleMix = new Map<string, RoleMix>();
  for (const r of roles.rows) roleMix.set(r.cluster_id, r.ceo_cfo ? 'ceo_cfo' : r.officer ? 'other_officer' : r.director ? 'director' : 'other');

  const bySignal = new Map<string, SignalFact['outcomes']>();
  for (const o of outcomes) {
    const fact: OutcomeFact = {
      status: o.status,
      returnPct: num(o.returnPct),
      excessPct: num(o.excessReturnPct),
      benchmarkReturnPct: num(o.benchmarkReturnPct),
      maxDrawdownPct: num(o.maxDrawdownPct),
      exitDate: o.exitDate,
    };
    const perHorizon = bySignal.get(o.signalId) ?? {};
    perHorizon[o.horizonDays] = { ...perHorizon[o.horizonDays], [o.benchmarkTicker as Bench]: fact };
    bySignal.set(o.signalId, perHorizon);
  }

  return base.map((b) => ({
    id: b.id,
    ticker: b.ticker,
    issuer: b.issuer,
    signalAt: b.signalAt.getTime(),
    baselineScore: num(b.baselineScore),
    agentScore: b.agentScore,
    conviction: b.conviction,
    insiderCount: b.insiderCount,
    totalValue: Number(b.totalValue),
    marketCap: num(b.marketCap),
    industry: b.industry,
    roleMix: roleMix.get(b.clusterId) ?? 'other',
    postCutoff: isPostCutoff(b.signalAt),
    avgDollarVolume: num(b.avgDollarVolume),
    status: b.status,
    tags: b.tags,
    // `holdout` reflects the real (unforced) freeze state, so display code that reads it (e.g. the
    // dashboard's calendar-time portfolio, which excludes `holdout` signals) is unaffected by `forTests`.
    holdout: isHeldOut(b.signalAt.getTime(), opts.forTests ? heldOutFrom(holdoutSettings) : heldFrom),
    holdoutWindow: isHeldOut(b.signalAt.getTime(), holdoutSettings.from),
    // Held-out signals carry no returns outside a `forTests` call, so no display, list, gate or export can see them.
    outcomes: isHeldOut(b.signalAt.getTime(), heldFrom) ? {} : (bySignal.get(b.id) ?? {}),
  }));
}

/** Inputs for gate 4 over the prior 30 days (Chicago calendar). */
export async function loadPipelineHealth(db: Db): Promise<PipelineHealth> {
  const [filingRow, uptimeRow] = await Promise.all([
    db.execute<{ filings: number; failures: number }>(sql`
      select count(*)::int as filings, count(*) filter (where parse_status = 'failed')::int as failures
      from filings where accepted_at >= now() - interval '30 days'`),
    db.execute<{ observed: number; weekdays: number; ok: number }>(sql`
      with today as (select (now() at time zone 'America/Chicago')::date as d),
      first_run as (
        select coalesce((min(started_at) at time zone 'America/Chicago')::date, (select d from today)) as d
        from job_runs where job_name in ('ingest-daily-index', 'backfill')
      ),
      days as (
        select g::date as day
        from today, first_run, generate_series(greatest(today.d - 30, first_run.d), today.d - 1, interval '1 day') g
        where extract(dow from g) between 1 and 5
      )
      select (select least(30, (today.d - first_run.d)) from today, first_run)::int as observed,
             count(*)::int as weekdays,
             count(*) filter (where exists (
               select 1 from job_runs j
               where j.job_name in ('ingest-daily-index', 'backfill') and j.status = 'success'
                 and (j.started_at at time zone 'America/Chicago')::date = days.day
             ))::int as ok
      from days`),
  ]);
  const f = filingRow.rows[0];
  const u = uptimeRow.rows[0];
  return {
    filings: f?.filings ?? 0,
    parseFailures: f?.failures ?? 0,
    weekdays: u?.weekdays ?? 0,
    weekdaysWithSuccessfulIngest: u?.ok ?? 0,
    daysObserved: u?.observed ?? 0,
  };
}
