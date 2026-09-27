import Link from 'next/link';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { clusters, filings, filingOwners, insiders, issuers, jobRuns, signals, transactions } from '@/db/schema';
import { agentUsage } from '@/lib/agent/store';
import { computeKpis, cumulativeByTier, HORIZON_LIST, meansByHorizon } from '@/lib/analytics/dashboard';
import { inScope, type ViewOptions } from '@/lib/analytics/facts';
import { loadSignalFacts } from '@/lib/analytics/load';
import { MIN_N } from '@/lib/analytics/stats';
import { requireUser } from '@/lib/auth/require-user';
import { findBuildingClusters } from '@/lib/clusters/store';
import { nowMs } from '@/lib/clock';
import { chicagoToday } from '@/lib/edgar/dates';
import { getFlags } from '@/lib/flags';
import { formatDateTime, formatDay, formatNumber, formatPct, formatPrice, formatRate, formatUsd } from '@/lib/format';
import { COSTS_KEY, costsSchema } from '@/lib/market/costs';
import { loadReturnsToDate } from '@/lib/market/performance';
import { getSetting } from '@/lib/settings';
import { JOB_NAMES } from '@/worker/job-names';
import { BarChart } from '@/components/charts/bar-chart';
import { LineChart } from '@/components/charts/line-chart';
import { EmptyState, PageHeader } from '@/components/page-header';
import { ScoreBadge } from '@/components/score-badge';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const DAY = 86_400_000;
const LINE_COLOR = { agent: 'var(--viz-2)', baseline: 'var(--viz-1)', all: 'var(--viz-3)' } as const;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription className="text-xs tracking-wide uppercase">{label}</CardDescription>
        <CardTitle className="font-mono text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {hint ? <CardContent className="text-muted-foreground text-xs">{hint}</CardContent> : null}
    </Card>
  );
}

const Return = ({ v }: { v: number | null | undefined }) => (
  <span className={cn('font-mono tabular-nums', v != null && (v > 0 ? 'text-positive' : v < 0 ? 'text-negative' : ''))}>{formatPct(v)}</span>
);

function roleLabel(o: { isOfficer: boolean | null; officerTitle: string | null; isDirector: boolean | null; isTenPctOwner: boolean | null }) {
  if (o.isOfficer) return o.officerTitle || 'Officer';
  if (o.isDirector) return 'Director';
  if (o.isTenPctOwner) return '10% owner';
  return 'Other';
}

export default async function DashboardPage() {
  await requireUser();
  const now = nowMs();
  const today = chicagoToday();

  const [all, costs, flags, [activeRow], latestSignals, latest, buys, usage, [failedToday]] = await Promise.all([
    loadSignalFacts(db),
    getSetting(db, COSTS_KEY, costsSchema),
    getFlags(db),
    db.select({ n: sql<number>`count(*)::int` }).from(clusters).where(eq(clusters.status, 'active')),
    db
      .select({ id: signals.id, entryDate: signals.entryDate, ticker: issuers.ticker })
      .from(signals)
      .innerJoin(issuers, eq(issuers.cik, signals.issuerCik))
      .where(ne(signals.status, 'superseded'))
      .orderBy(desc(signals.signalAt))
      .limit(10),
    db.selectDistinctOn([jobRuns.jobName], { jobName: jobRuns.jobName, status: jobRuns.status, startedAt: jobRuns.startedAt }).from(jobRuns).orderBy(jobRuns.jobName, desc(jobRuns.startedAt)),
    db
      .select({
        id: transactions.id,
        date: transactions.transactionDate,
        ticker: issuers.ticker,
        issuer: issuers.name,
        insider: insiders.name,
        shares: transactions.shares,
        price: transactions.price,
        value: transactions.value,
        is10b5_1: transactions.is10b5_1,
        isDirector: filingOwners.isDirector,
        isOfficer: filingOwners.isOfficer,
        officerTitle: filingOwners.officerTitle,
        isTenPctOwner: filingOwners.isTenPctOwner,
        url: filings.url,
      })
      .from(transactions)
      .innerJoin(filings, eq(filings.id, transactions.filingId))
      .innerJoin(issuers, eq(issuers.cik, transactions.issuerCik))
      .innerJoin(insiders, eq(insiders.cik, transactions.insiderCik))
      .leftJoin(filingOwners, and(eq(filingOwners.filingId, transactions.filingId), eq(filingOwners.insiderCik, transactions.insiderCik)))
      .where(and(eq(transactions.code, 'P'), eq(transactions.isDerivative, false)))
      .orderBy(desc(transactions.transactionDate), desc(transactions.value))
      .limit(15),
    agentUsage(db),
    db
      .select({ parse: sql<number>`count(*) filter (where ${filings.parseStatus} = 'failed' and ${filings.createdAt} >= (date_trunc('day', now() at time zone 'America/Chicago') at time zone 'America/Chicago'))::int` })
      .from(filings),
  ]);

  const view: ViewOptions = { bench: 'SPY', net: true, scope: 'post', costs };
  const facts = all.filter((f) => inScope(f, view));
  const kpi = computeKpis(facts, view, now, activeRow.n);
  const lines = cumulativeByTier(facts, view);
  const horizons = meansByHorizon(facts, view);
  const dataEnded = all.filter((f) => f.status === 'data_ended').length;

  const factById = new Map(all.map((f) => [f.id, f]));
  const [toDate, building] = await Promise.all([
    loadReturnsToDate(db, latestSignals),
    flags.early_watch_clusters ? findBuildingClusters(db, today) : Promise.resolve([]),
  ]);
  const runByJob = new Map(latest.map((r) => [r.jobName, r]));

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Insider-buying clusters, how they score, and how they have performed. Returns are net of costs, against SPY, on signals after the agent model's training cutoff."
      />

      <section aria-label="Summary" className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="New signals" value={`${kpi.newSignals7d} · ${kpi.newSignals30d}`} hint="last 7 days · last 30 days" />
        <Stat label="Active clusters" value={formatNumber(kpi.activeClusters)} hint="still inside their window" />
        <Stat label="Complete 30-day outcomes" value={formatNumber(kpi.complete30d)} hint={`${MIN_N}+ needed before averages show`} />
        <Stat label="Mean 30-day excess" value={kpi.meanExcess30d === null ? '—' : formatPct(kpi.meanExcess30d, 2)} hint="net of costs, vs SPY" />
        <Stat label="Hit rate" value={kpi.hitRate30d === null ? '—' : formatRate(kpi.hitRate30d)} hint="share beating SPY at 30 days" />
        <Stat
          label="Agent vs baseline"
          value={kpi.agentBaselineCorrelation ? kpi.agentBaselineCorrelation.r.toFixed(2) : '—'}
          hint={kpi.agentBaselineCorrelation ? `rank correlation, n=${kpi.agentBaselineCorrelation.n}` : `needs ${MIN_N} signals scored by both`}
        />
        <Stat label="Price data ended" value={formatNumber(dataEnded)} hint="signals kept; last price used" />
        <Stat label="All signals" value={formatNumber(all.length)} hint={`${formatNumber(facts.length)} after the model cutoff`} />
      </section>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Cumulative excess return</CardTitle>
            <CardDescription>
              Each signal is an equal-size position whose 30-day net excess lands on its exit date; lines are the running total.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {lines.length ? (
              <LineChart
                measure="Cumulative excess"
                zeroLine
                format={{ kind: 'pct', digits: 0 }}
                formatX="day"
                series={lines.map((l) => ({ key: l.key, label: l.label, color: LINE_COLOR[l.key], points: l.points }))}
              />
            ) : (
              <p className="text-muted-foreground text-sm">No signal has a completed 30-day outcome yet. The first appear about six weeks after the first signals fire.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Average excess by horizon</CardTitle>
            <CardDescription>Net of costs, vs SPY. Blank where fewer than {MIN_N} outcomes have completed.</CardDescription>
          </CardHeader>
          <CardContent>
            {horizons.some((h) => h.means.some((m) => m !== null)) ? (
              <BarChart
                categories={HORIZON_LIST.map((h) => `${h}d`)}
                measure="Mean net excess vs SPY"
                format={{ kind: 'pct', digits: 1 }}
                series={horizons.map((h) => ({ key: h.key, label: h.label, color: LINE_COLOR[h.key], values: h.means, counts: h.counts }))}
              />
            ) : (
              <p className="text-muted-foreground text-sm">Not enough completed outcomes yet ({MIN_N} needed per horizon).</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Latest signals</CardTitle>
          <CardDescription>
            <Link href="/signals" className="hover:text-primary underline">
              See all signals
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {latestSignals.length === 0 ? (
            <div className="px-4">
              <EmptyState>No signals yet.</EmptyState>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-xs tracking-wide uppercase">
                    <th className="px-4 py-2 font-medium">Company</th>
                    <th className="px-4 py-2 text-right font-medium">Insiders</th>
                    <th className="px-4 py-2 text-right font-medium">Total</th>
                    <th className="px-4 py-2 text-right font-medium">Baseline</th>
                    <th className="px-4 py-2 text-right font-medium">Agent</th>
                    <th className="px-4 py-2 font-medium">Conviction</th>
                    <th className="px-4 py-2 text-right font-medium">Days</th>
                    <th className="px-4 py-2 text-right font-medium">vs SPY to date</th>
                  </tr>
                </thead>
                <tbody>
                  {latestSignals.map((s) => {
                    const f = factById.get(s.id)!;
                    const td = toDate.get(s.id);
                    return (
                      <tr key={s.id} className="hover:bg-muted/50 border-b last:border-b-0">
                        <td className="px-4 py-2.5">
                          <Link href={`/signals/${s.id}`} className="hover:text-primary flex items-center gap-2">
                            {f.ticker ? <span className="font-mono font-medium">{f.ticker}</span> : null}
                            <span className="text-muted-foreground max-w-56 truncate">{f.issuer}</span>
                          </Link>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums">{f.insiderCount}</td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatUsd(f.totalValue)}</td>
                        <td className="px-4 py-2.5 text-right"><ScoreBadge score={f.baselineScore} /></td>
                        <td className="px-4 py-2.5 text-right"><ScoreBadge score={f.agentScore} /></td>
                        <td className="px-4 py-2.5">{f.conviction ? <Badge variant="secondary">{f.conviction}</Badge> : <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums">{Math.max(0, Math.floor((now - f.signalAt) / DAY))}</td>
                        <td className="px-4 py-2.5 text-right"><Return v={td?.excessPct} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        {flags.early_watch_clusters ? (
          <Card>
            <CardHeader>
              <CardTitle>Clusters building</CardTitle>
              <CardDescription>Meet the rule except for one more buyer: one more insider would make a signal.</CardDescription>
            </CardHeader>
            <CardContent>
              {building.length === 0 ? (
                <p className="text-muted-foreground text-sm">None right now.</p>
              ) : (
                <ul className="space-y-3">
                  {building.map((b) => (
                    <li key={b.issuerCik} className="text-sm">
                      <Link href={`/companies/${b.issuerCik}`} className="hover:text-primary flex items-center gap-2 font-medium">
                        {b.ticker ? <span className="font-mono">{b.ticker}</span> : null}
                        <span className="text-muted-foreground font-normal">{b.name}</span>
                      </Link>
                      <div className="text-muted-foreground text-xs">
                        {b.insiderCount} insiders ({b.insiders.join(', ')}) · {formatUsd(b.totalValue)} · last bought {formatDay(b.lastPurchase)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Pipeline health</CardTitle>
            <CardDescription>
              <Link href="/system" className="hover:text-primary underline">
                Open System
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm">
              {JOB_NAMES.map((name) => {
                const r = runByJob.get(name);
                return (
                  <li key={name} className="flex items-center justify-between gap-3">
                    <span className="font-mono text-xs">{name}</span>
                    {r ? (
                      <span className="flex items-center gap-2">
                        <span className="text-muted-foreground text-xs">{formatDateTime(r.startedAt)}</span>
                        <Badge variant={r.status === 'failed' ? 'destructive' : r.status === 'success' ? 'secondary' : 'outline'}>
                          {r.status === 'success' ? '✓ Success' : r.status === 'failed' ? '✕ Failed' : '… Running'}
                        </Badge>
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">Never run</span>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="text-muted-foreground mt-3 text-xs">
              Today: {formatNumber(failedToday.parse)} parse failure{failedToday.parse === 1 ? '' : 's'}, {formatNumber(usage.failedToday)} agent failure{usage.failedToday === 1 ? '' : 's'}.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Latest open-market purchases</CardTitle>
          <CardDescription>Newest 15 by transaction date, before any clustering.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {buys.length === 0 ? (
            <div className="px-4">
              <EmptyState>No open-market purchases ingested yet.</EmptyState>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-y text-left text-xs tracking-wide uppercase">
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 font-medium">Company</th>
                    <th className="px-4 py-2 font-medium">Insider</th>
                    <th className="px-4 py-2 text-right font-medium">Shares</th>
                    <th className="px-4 py-2 text-right font-medium">Price</th>
                    <th className="px-4 py-2 text-right font-medium">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {buys.map((b) => (
                    <tr key={b.id} className="hover:bg-muted/50 border-b last:border-b-0">
                      <td className="px-4 py-2.5 whitespace-nowrap">{formatDay(b.date)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          {b.ticker ? <span className="font-mono font-medium">{b.ticker}</span> : null}
                          <span className="text-muted-foreground max-w-56 truncate">{b.issuer}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <a href={b.url} target="_blank" rel="noreferrer" className="hover:text-primary hover:underline">
                            {b.insider}
                          </a>
                          <Badge variant="secondary">{roleLabel(b)}</Badge>
                          {b.is10b5_1 ? <Badge variant="outline">10b5-1</Badge> : null}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatNumber(b.shares)}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatPrice(b.price)}</td>
                      <td className="text-positive px-4 py-2.5 text-right font-mono font-medium tabular-nums">{formatUsd(b.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
