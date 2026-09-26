import Link from 'next/link';
import { db } from '@/lib/db';
import { AGENT_MODEL } from '@/lib/agent/models';
import {
  bandOf,
  bucketSummaries,
  calibration,
  capBucket,
  CAP_BUCKETS,
  CLUSTER_SIZES,
  clusterSizeBucket,
  excessValues,
  inScope,
  ROLE_MIX_LABEL,
  type Bench,
  type ViewOptions,
} from '@/lib/analytics/facts';
import { allGatesPass, evaluateGates, GATE_HORIZON } from '@/lib/analytics/gates';
import { loadPipelineHealth, loadSignalFacts } from '@/lib/analytics/load';
import { histogram, MIN_N, rollingHitRate, SCORE_BANDS, summarize } from '@/lib/analytics/stats';
import { requireUser } from '@/lib/auth/require-user';
import { COSTS_KEY, costsSchema } from '@/lib/market/costs';
import { formatPct, formatRate } from '@/lib/format';
import { getSetting } from '@/lib/settings';
import { BarChart } from '@/components/charts/bar-chart';
import { LineChart } from '@/components/charts/line-chart';
import { PageHeader } from '@/components/page-header';
import { SummaryTable } from '@/components/summary-table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const HORIZONS = [5, 10, 30, 60, 90] as const;

function Toggle({ label, options, current, href }: { label: string; options: Array<[string, string]>; current: string; href: (v: string) => string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">{label}</span>
      {options.map(([value, text]) => (
        <Link
          key={value}
          href={href(value)}
          aria-current={value === current ? 'true' : undefined}
          className={cn('rounded-full border px-3 py-1 text-xs transition-colors', value === current ? 'border-primary/40 bg-accent text-accent-foreground font-medium' : 'text-muted-foreground hover:bg-muted')}
        >
          {text}
        </Link>
      ))}
    </div>
  );
}

const GATE_LABEL = { pass: '✓ Pass', fail: '✕ Fail', insufficient: '… Not enough data yet' } as const;

export default async function PerformancePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const q = await searchParams;
  const bench: Bench = q.bench === 'IWM' ? 'IWM' : 'SPY';
  const net = q.net !== '0';
  const scope = q.scope === 'all' ? 'all' : 'post';
  const horizon = HORIZONS.find((h) => String(h) === q.h) ?? GATE_HORIZON;

  const [all, health, costs] = await Promise.all([loadSignalFacts(db), loadPipelineHealth(db), getSetting(db, COSTS_KEY, costsSchema)]);
  const view: ViewOptions = { bench, net, scope, costs };
  const facts = all.filter((f) => inScope(f, view));

  // The gates always use the spec's basis (post-cutoff, net of costs) whatever the toggles say.
  const gateView: ViewOptions = { bench, net: true, scope: 'post', costs };
  const gates = evaluateGates(all.filter((f) => inScope(f, gateView)), gateView, health);

  const href = (over: Record<string, string>) => {
    const p = new URLSearchParams({ bench, net: net ? '1' : '0', scope, h: String(horizon), ...over });
    return `/performance?${p}`;
  };

  const values = excessValues(facts, horizon, view);
  const overall = summarize(values);
  const unit = `${net ? 'net' : 'gross'} excess vs ${bench}`;

  // Score bands, agent and baseline side by side.
  const agentBands = new Map(bucketSummaries(facts, (f) => bandOf(f.agentScore), SCORE_BANDS, horizon, view).map((r) => [r.key, r.summary]));
  const baseBands = new Map(bucketSummaries(facts, (f) => bandOf(f.baselineScore), SCORE_BANDS, horizon, view).map((r) => [r.key, r.summary]));
  const bands = SCORE_BANDS.filter((b) => (agentBands.get(b)?.n ?? 0) > 0 || (baseBands.get(b)?.n ?? 0) > 0);
  const bandValue = (m: typeof agentBands, b: string) => (m.get(b)?.sufficient ? m.get(b)!.mean : null);

  const calib = calibration(facts, view, horizon);
  const bins = histogram(values, -30, 30, 2.5);
  const rolling = rollingHitRate(
    facts.flatMap((f) => {
      const v = excessValues([f], horizon, view)[0];
      return v === undefined ? [] : [{ at: f.signalAt, value: v }];
    }),
    { windowDays: 90, stepDays: 7, minN: 10 },
  );

  return (
    <>
      <PageHeader title="Performance" description="Does the agent add value over the baseline, and do the signals beat the market?" />

      <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
        <Toggle label="Returns" options={[['1', 'Net of costs'], ['0', 'Gross']]} current={net ? '1' : '0'} href={(v) => href({ net: v })} />
        <Toggle label="Benchmark" options={[['SPY', 'SPY'], ['IWM', 'IWM']]} current={bench} href={(v) => href({ bench: v })} />
        <Toggle label="Signals" options={[['post', 'After model cutoff'], ['all', 'All']]} current={scope} href={(v) => href({ scope: v })} />
        <Toggle label="Horizon" options={HORIZONS.map((h) => [String(h), `${h}d`] as [string, string])} current={String(horizon)} href={(v) => href({ h: v })} />
      </div>

      {scope === 'all' ? (
        <p role="note" className="bg-warning-bg text-warning mb-6 rounded-lg px-3 py-2 text-sm">
          Signals before {AGENT_MODEL.trainingCutoff} predate the agent model&apos;s training cutoff, so it may have &quot;remembered&quot; how they turned out.
          Their agent scores are not evidence. Use post-cutoff signals to judge the agent.
        </p>
      ) : null}

      <section aria-labelledby="gates" className="mb-8">
        <Card>
          <CardHeader>
            <CardTitle id="gates">Evaluation gates</CardTitle>
            <CardDescription>
              Paper trading is built only when all four pass. Always measured on signals after {AGENT_MODEL.trainingCutoff}, net of costs, at {GATE_HORIZON} days.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {gates.map((g) => (
                <li key={g.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-b pb-3 last:border-b-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">
                      {g.id}. {g.title}
                    </div>
                    <div className="text-muted-foreground mt-0.5 text-xs">{g.detail}</div>
                  </div>
                  <Badge variant={g.status === 'pass' ? 'secondary' : g.status === 'fail' ? 'destructive' : 'outline'}>{GATE_LABEL[g.status]}</Badge>
                </li>
              ))}
            </ol>
            <p className="mt-4 text-sm font-medium">
              {allGatesPass(gates) ? 'All gates pass: Phase 2 is unlocked.' : 'Phase 2 stays locked until every gate passes.'}
            </p>
          </CardContent>
        </Card>
      </section>

      <section aria-label="Summary" className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Signals in view', String(facts.length)],
          [`Complete ${horizon}d outcomes`, String(overall.n)],
          [`Mean ${unit}`, overall.sufficient ? formatPct(overall.mean, 2) : `n < ${MIN_N}`],
          ['Hit rate', overall.sufficient ? formatRate(overall.hitRate) : `n < ${MIN_N}`],
        ].map(([label, value]) => (
          <Card key={label} size="sm">
            <CardHeader>
              <CardDescription className="text-xs tracking-wide uppercase">{label}</CardDescription>
              <CardTitle className="font-mono text-2xl tabular-nums">{value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </section>

      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Does the agent add value?</CardTitle>
            <CardDescription>
              Mean {horizon}-day {unit} by score band. Bands with fewer than {MIN_N} signals are left blank.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {bands.some((b) => bandValue(baseBands, b) !== null || bandValue(agentBands, b) !== null) ? (
              <BarChart
                categories={[...bands]}
                measure={`Mean ${unit}`}
                format={{ kind: 'pct', digits: 1 }}
                series={[
                  { key: 'baseline', label: 'Baseline', color: 'var(--viz-1)', values: bands.map((b) => bandValue(baseBands, b)), counts: bands.map((b) => baseBands.get(b)?.n ?? 0) },
                  { key: 'agent', label: 'Agent', color: 'var(--viz-2)', values: bands.map((b) => bandValue(agentBands, b)), counts: bands.map((b) => agentBands.get(b)?.n ?? 0) },
                ]}
              />
            ) : (
              <p className="text-muted-foreground text-sm">No score band has {MIN_N} completed {horizon}-day outcomes in this view yet ({overall.n} completed so far).</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Calibration</CardTitle>
            <CardDescription>Realised hit rate at each conviction level the agent stated. Higher conviction should hit more often.</CardDescription>
          </CardHeader>
          <CardContent>
            {calib.some((c) => c.summary.sufficient) ? (
              <BarChart
                categories={calib.map((c) => c.key)}
                measure="Hit rate"
                format={{ kind: 'ratio' }}
                emptyText="Insufficient data"
                series={[{ key: 'hit', label: 'Hit rate', color: 'var(--viz-1)', values: calib.map((c) => (c.summary.sufficient ? c.summary.hitRate : null)), counts: calib.map((c) => c.summary.n) }]}
              />
            ) : (
              <p className="text-muted-foreground text-sm">Needs at least {MIN_N} evaluated signals with completed outcomes at a conviction level ({calib.map((c) => `${c.key}: ${c.summary.n}`).join(', ') || 'none yet'}).</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Distribution</CardTitle>
            <CardDescription>
              Signals by {horizon}-day {unit}, in 2.5-point bins (outliers fold into the end bins).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {values.length ? (
              <BarChart
                categories={bins.map((b) => `${b.from}`)}
                measure="Signals"
                format={{ kind: 'int' }}
                labelEvery={4}
                series={[{ key: 'count', label: 'Signals', color: 'var(--viz-1)', values: bins.map((b) => b.count) }]}
              />
            ) : (
              <p className="text-muted-foreground text-sm">Nothing to plot yet.</p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Rolling 90-day hit rate</CardTitle>
            <CardDescription>Share of signals from the trailing 90 days that beat {bench} at {horizon} days. Drawn only where the window holds at least 10.</CardDescription>
          </CardHeader>
          <CardContent>
            <LineChart
              measure="Hit rate"
              domain={[0, 1]}
              format={{ kind: 'ratio' }}
              formatX="day"
              series={[{ key: 'hit', label: 'Hit rate', color: 'var(--viz-1)', points: rolling.map((r) => ({ x: r.at, y: r.hitRate, n: r.n })) }]}
            />
          </CardContent>
        </Card>
      </div>

      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        {(
          [
            ['Insider role mix', bucketSummaries(facts, (f) => ROLE_MIX_LABEL[f.roleMix], Object.values(ROLE_MIX_LABEL), horizon, view)],
            ['Market cap', bucketSummaries(facts, (f) => capBucket(f.marketCap), CAP_BUCKETS, horizon, view)],
            ['Cluster size', bucketSummaries(facts, (f) => clusterSizeBucket(f.insiderCount), CLUSTER_SIZES, horizon, view)],
            ['Sector', bucketSummaries(facts, (f) => f.industry?.replace(/^[A-Z]+-/, '') ?? 'Unknown', null, horizon, view).sort((a, b) => b.summary.n - a.summary.n).slice(0, 10)],
          ] as const
        ).map(([title, rows]) => (
          <Card key={title}>
            <CardHeader>
              <CardTitle>{title}</CardTitle>
              <CardDescription>
                {horizon}-day {unit}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SummaryTable title={title} rows={rows} />
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-muted-foreground text-xs">
        Only completed outcomes count; pending and data-ended ones are excluded. Net subtracts an estimated round-trip cost of {costs.roundTripPct}% ({costs.illiquidRoundTripPct}% below ${(costs.illiquidDollarVolume / 1e6).toFixed(0)}M a day). Hit rate is the share beating the benchmark.
        Nothing here is investment advice; past results do not predict future returns.
      </p>
    </>
  );
}
