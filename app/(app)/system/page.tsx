import { desc, eq, getTableColumns, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { filings, issuers, jobRuns } from '@/db/schema';
import { requireUser } from '@/lib/auth/require-user';
import { formatDateTime, formatDuration, formatNumber } from '@/lib/format';
import { estimateCostUsd } from '@/lib/agent/models';
import { agentUsage, loadAgentLimits } from '@/lib/agent/store';
import { JOB_NAMES } from '@/worker/job-names';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { retryParse, runJobNow } from './actions';

const MAX_XML_CHARS = 100_000;

// A run still marked "running" after an hour means the process died without recording an end.
const stale = sql<boolean>`${jobRuns.status} = 'running' and ${jobRuns.startedAt} < now() - interval '1 hour'`;
const runColumns = { ...getTableColumns(jobRuns), stale };

function StatusBadge({ status, stale }: { status: string; stale: boolean }) {
  // Text and symbol carry the meaning, not just colour.
  if (status === 'success') return <Badge variant="secondary">✓ Success</Badge>;
  if (status === 'failed') return <Badge variant="destructive">✕ Failed</Badge>;
  return <Badge variant="outline">{stale ? '? Stale (no finish recorded)' : '… Running'}</Badge>;
}

export default async function SystemPage() {
  await requireUser();

  const [latestPerJob, runs, [stats], failures, usage, limits] = await Promise.all([
    db.selectDistinctOn([jobRuns.jobName], runColumns).from(jobRuns).orderBy(jobRuns.jobName, desc(jobRuns.startedAt)),
    db.select(runColumns).from(jobRuns).orderBy(desc(jobRuns.startedAt)).limit(25),
    db
      .select({
        filings: sql<number>`count(*)::int`,
        failed: sql<number>`count(*) filter (where ${filings.parseStatus} = 'failed')::int`,
        latest: sql<Date | null>`max(${filings.acceptedAt})`,
        unmapped: sql<number>`(select count(*)::int from ${issuers} i where i.ticker is null and exists (select 1 from ${filings} f where f.issuer_cik = i.cik))`,
      })
      .from(filings),
    db
      .select({
        id: filings.id,
        accessionNo: filings.accessionNo,
        formType: filings.formType,
        acceptedAt: filings.acceptedAt,
        url: filings.url,
        parseError: filings.parseError,
        rawXml: filings.rawXml,
        issuerName: issuers.name,
      })
      .from(filings)
      .innerJoin(issuers, eq(issuers.cik, filings.issuerCik))
      .where(eq(filings.parseStatus, 'failed'))
      .orderBy(desc(filings.acceptedAt))
      .limit(25),
    agentUsage(db),
    loadAgentLimits(db),
  ]);

  const latestByName = new Map(latestPerJob.map((r) => [r.jobName, r]));
  const failureRate = stats.filings ? (stats.failed / stats.filings) * 100 : 0;

  return (
    <>
      <PageHeader title="System" description="Pipeline health, job history and data quality." />

      <section aria-labelledby="jobs" className="mb-8 grid gap-4 sm:grid-cols-2">
        <h2 id="jobs" className="sr-only">
          Jobs
        </h2>
        {JOB_NAMES.map((name) => {
          const last = latestByName.get(name);
          return (
            <Card key={name}>
              <CardHeader>
                <CardTitle className="font-mono text-sm">{name}</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-3 text-sm">
                <div className="flex flex-col gap-1">
                  {last ? (
                    <>
                      <StatusBadge status={last.status} stale={last.stale} />
                      <span className="text-muted-foreground text-xs">{formatDateTime(last.startedAt)} CT</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Never run</span>
                  )}
                </div>
                <form action={runJobNow}>
                  <input type="hidden" name="job" value={name} />
                  <Button type="submit" size="sm" variant="outline">
                    Run now
                  </Button>
                </form>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section aria-labelledby="quality" className="mb-8">
        <h2 id="quality" className="mb-3 text-lg font-semibold">
          Data quality
        </h2>
        <dl className="grid gap-4 sm:grid-cols-4">
          {[
            ['Filings stored', stats.filings.toLocaleString()],
            ['Parse failures', `${stats.failed.toLocaleString()} (${failureRate.toFixed(2)}%)`],
            ['Latest acceptance', stats.latest ? `${formatDateTime(new Date(stats.latest))} CT` : '—'],
            ['Issuers without ticker', stats.unmapped.toLocaleString()],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border p-3">
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd className="mt-1 font-mono text-lg tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="agent" className="mb-8">
        <h2 id="agent" className="mb-3 text-lg font-semibold">
          Agent spend
        </h2>
        <dl className="grid gap-4 sm:grid-cols-4">
          {[
            ['Evaluations today', `${formatNumber(usage.evaluationsToday)} of ${formatNumber(limits.dailyCap)} cap`],
            ['Tokens this month', `${formatNumber(usage.tokensThisMonth)} of ${formatNumber(limits.monthlyTokenBudget)}`],
            ['Estimated cost, month', `$${estimateCostUsd(usage.tokensInMonth, usage.tokensOutMonth, limits).toFixed(2)}`],
            ['Failed, month', `${formatNumber(usage.failedMonth)} of ${formatNumber(usage.evaluationsMonth)}`],
          ].map(([label, value]) => (
            <div key={label} className="bg-card rounded-lg border p-3">
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd className="mt-1 font-mono text-lg tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-muted-foreground mt-2 text-xs">Cost is an estimate from the configured per-token prices; reasoning tokens are billed as output.</p>
      </section>

      <section aria-labelledby="runs" className="mb-8">
        <h2 id="runs" className="mb-3 text-lg font-semibold">
          Job runs
        </h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground border-b text-left text-xs">
              <tr>
                <th className="p-2 font-medium">Job</th>
                <th className="p-2 font-medium">Started (CT)</th>
                <th className="p-2 text-right font-medium">Duration</th>
                <th className="p-2 font-medium">Status</th>
                <th className="p-2 text-right font-medium">Items</th>
                <th className="p-2 font-medium">Error</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-muted-foreground p-4 text-center">
                    No runs yet.
                  </td>
                </tr>
              ) : (
                runs.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="p-2 font-mono text-xs">{r.jobName}</td>
                    <td className="p-2">{formatDateTime(r.startedAt)}</td>
                    <td className="p-2 text-right tabular-nums">{formatDuration(r.startedAt, r.finishedAt)}</td>
                    <td className="p-2">
                      <StatusBadge status={r.status} stale={r.stale} />
                    </td>
                    <td className="p-2 text-right tabular-nums">{r.itemsProcessed.toLocaleString()}</td>
                    <td className="text-destructive max-w-xs truncate p-2 text-xs" title={r.error ?? undefined}>
                      {r.error}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="failures">
        <h2 id="failures" className="mb-3 text-lg font-semibold">
          Parse failures
        </h2>
        {failures.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
            No parse failures. 🎉
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {failures.map((f) => (
              <li key={f.id} className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <a href={f.url} target="_blank" rel="noreferrer" className="font-mono text-xs underline">
                      {f.accessionNo}
                    </a>{' '}
                    <span className="text-muted-foreground">
                      · Form {f.formType} · {f.issuerName} · {formatDateTime(f.acceptedAt)} CT
                    </span>
                  </div>
                  <form action={retryParse}>
                    <input type="hidden" name="id" value={f.id} />
                    <Button type="submit" size="sm" variant="outline">
                      Retry parse
                    </Button>
                  </form>
                </div>
                <p className="text-destructive mt-2 text-xs">{f.parseError}</p>
                {f.rawXml ? (
                  <details className="mt-2">
                    <summary className="text-muted-foreground cursor-pointer text-xs">View raw XML</summary>
                    <pre className="bg-muted mt-2 max-h-96 overflow-auto rounded p-2 text-xs">
                      {f.rawXml.slice(0, MAX_XML_CHARS)}
                    </pre>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
