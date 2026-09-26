import Link from 'next/link';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agentEvaluations, clusters, issuers, signals } from '@/db/schema';
import { requireUser } from '@/lib/auth/require-user';
import { formatDateTime, formatNumber, formatUsd } from '@/lib/format';
import { EmptyState, PageHeader } from '@/components/page-header';
import { ScoreBadge } from '@/components/score-badge';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const SORTS = {
  newest: { label: 'Newest', order: [desc(signals.signalAt)] },
  agent: { label: 'Agent', order: [sql`${agentEvaluations.score} desc nulls last`, desc(signals.signalAt)] },
  score: { label: 'Baseline', order: [sql`${signals.baselineScore} desc nulls last`, desc(signals.signalAt)] },
  value: { label: 'Value', order: [desc(clusters.totalValue), desc(signals.signalAt)] },
  insiders: { label: 'Insiders', order: [desc(clusters.insiderCount), desc(signals.signalAt)] },
} as const;
type SortKey = keyof typeof SORTS;

const STATUSES = { all: 'All', active: 'Active', closed: 'Closed' } as const;
type StatusKey = keyof typeof STATUSES;

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'rounded-full border px-3 py-1 text-xs transition-colors',
        active ? 'border-primary/40 bg-accent text-accent-foreground font-medium' : 'text-muted-foreground hover:bg-muted',
      )}
    >
      {children}
    </Link>
  );
}

export default async function SignalsPage({ searchParams }: { searchParams: Promise<{ sort?: string; status?: string }> }) {
  await requireUser();
  const q = await searchParams;
  const sort: SortKey = q.sort && q.sort in SORTS ? (q.sort as SortKey) : 'newest';
  const status: StatusKey = q.status === 'active' || q.status === 'closed' ? q.status : 'all';
  const href = (s: SortKey, st: StatusKey) => `/signals?sort=${s}&status=${st}`;

  const rows = await db
    .select({
      id: signals.id,
      signalAt: signals.signalAt,
      score: signals.baselineScore,
      agentScore: agentEvaluations.score,
      ticker: issuers.ticker,
      issuer: issuers.name,
      insiderCount: clusters.insiderCount,
      totalValue: clusters.totalValue,
      status: clusters.status,
    })
    .from(signals)
    .innerJoin(clusters, eq(clusters.id, signals.clusterId))
    .innerJoin(issuers, eq(issuers.cik, signals.issuerCik))
    .leftJoin(agentEvaluations, eq(agentEvaluations.id, signals.latestAgentEvalId))
    .where(status === 'all' ? undefined : eq(clusters.status, status))
    .orderBy(...SORTS[sort].order, asc(signals.id))
    .limit(200);

  return (
    <>
      <PageHeader
        title="Signals"
        description="Clusters of insider open-market purchases. The signal time is when the filing that completed the cluster was accepted."
      />

      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Sort</span>
          {(Object.keys(SORTS) as SortKey[]).map((s) => (
            <Chip key={s} href={href(s, status)} active={s === sort}>
              {SORTS[s].label}
            </Chip>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Status</span>
          {(Object.keys(STATUSES) as StatusKey[]).map((s) => (
            <Chip key={s} href={href(sort, s)} active={s === status}>
              {STATUSES[s]}
            </Chip>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState>No signals yet. They appear once clusters are detected in ingested filings.</EmptyState>
      ) : (
        <Card>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-xs tracking-wide uppercase">
                    <th className="px-4 py-2 font-medium">Company</th>
                    <th className="px-4 py-2 font-medium">Signal (CT)</th>
                    <th className="px-4 py-2 text-right font-medium">Insiders</th>
                    <th className="px-4 py-2 text-right font-medium">Value</th>
                    <th className="px-4 py-2 text-right font-medium">Baseline</th>
                    <th className="px-4 py-2 text-right font-medium">Agent</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/50 border-b last:border-b-0">
                      <td className="px-4 py-2.5">
                        <Link href={`/signals/${r.id}`} className="hover:text-primary flex items-center gap-2">
                          {r.ticker ? <span className="font-mono font-medium">{r.ticker}</span> : null}
                          <span className="text-muted-foreground max-w-64 truncate">{r.issuer}</span>
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{formatDateTime(r.signalAt)}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatNumber(r.insiderCount)}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatUsd(r.totalValue)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <ScoreBadge score={r.score} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <ScoreBadge score={r.agentScore} />
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant={r.status === 'active' ? 'secondary' : 'outline'}>
                          {r.status === 'active' ? 'Active' : 'Closed'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
