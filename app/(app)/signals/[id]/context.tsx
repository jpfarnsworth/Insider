import { isHeldOut, loadHoldoutFrom } from '@/lib/research/holdout';
import Link from 'next/link';
import { and, desc, eq, gte, lte, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agentEvaluations, clusters, filings, signalOutcomes, signals, transactions } from '@/db/schema';
import type { AgentBundle } from '@/lib/agent/bundle';
import { formatDay, formatPct, formatUsd } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const YEAR_MS = 365 * 86_400_000;

/**
 * What surrounded the signal (spec §9.4): earlier signals at this company and how they did, insider
 * selling in the year before it (only what was public by the signal time), and recent 8-K titles.
 */
export async function Context({ signalId, issuerCik, signalAt, latestEvalId }: { signalId: string; issuerCik: string; signalAt: Date; latestEvalId: string | null }) {
  const since = new Date(signalAt.getTime() - YEAR_MS).toISOString().slice(0, 10);
  const heldFrom = await loadHoldoutFrom(db);

  const [prior, [selling], evaluation] = await Promise.all([
    db
      .select({
        id: signals.id,
        signalAt: signals.signalAt,
        insiders: clusters.insiderCount,
        total: clusters.totalValue,
        excess30: sql<string | null>`(select o.excess_return_pct from ${signalOutcomes} o where o.signal_id = ${signals.id} and o.horizon_days = 30 and o.benchmark_ticker = 'SPY' and o.status = 'complete')`,
      })
      .from(signals)
      .innerJoin(clusters, eq(clusters.id, signals.clusterId))
      .where(and(eq(signals.issuerCik, issuerCik), ne(signals.id, signalId), lte(signals.signalAt, signalAt)))
      .orderBy(desc(signals.signalAt))
      .limit(5),
    db
      .select({
        sales: sql<number>`count(*)::int`,
        sellers: sql<number>`count(distinct ${transactions.insiderCik})::int`,
        total: sql<string>`coalesce(sum(${transactions.value}), 0)`,
      })
      .from(transactions)
      .innerJoin(filings, eq(filings.id, transactions.filingId))
      .where(
        and(
          eq(transactions.issuerCik, issuerCik),
          eq(transactions.code, 'S'),
          eq(transactions.isDerivative, false),
          gte(transactions.transactionDate, since),
          lte(filings.acceptedAt, signalAt),
          eq(filings.parseStatus, 'parsed'),
        ),
      ),
    latestEvalId ? db.select({ bundle: agentEvaluations.inputBundle }).from(agentEvaluations).where(eq(agentEvaluations.id, latestEvalId)).limit(1) : Promise.resolve([]),
  ]);

  const eightKs = (evaluation[0]?.bundle as AgentBundle | undefined)?.recent8Ks ?? null;

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Context</CardTitle>
        <CardDescription>What was known around the signal time.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-3">
        <div>
          <h3 className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">Insider selling, prior 12 months</h3>
          {selling.sales ? (
            <p className="text-sm">
              <span className="font-mono">{selling.sales}</span> open-market sale{selling.sales === 1 ? '' : 's'} by <span className="font-mono">{selling.sellers}</span> insider
              {selling.sellers === 1 ? '' : 's'}, totalling <span className="font-mono">{formatUsd(selling.total)}</span>.
            </p>
          ) : (
            <p className="text-muted-foreground text-sm">No open-market insider sales in the year before.</p>
          )}
        </div>

        <div>
          <h3 className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">Earlier signals here</h3>
          {prior.length === 0 ? (
            <p className="text-muted-foreground text-sm">This is the first signal at this company.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {prior.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3">
                  <Link href={`/signals/${p.id}`} className="hover:text-primary hover:underline">
                    {formatDay(p.signalAt.toISOString().slice(0, 10))}
                  </Link>
                  <span className="text-muted-foreground text-xs">
                    {p.insiders} insiders · {formatUsd(p.total)}
                  </span>
                  <span
                    className={cn('font-mono text-xs tabular-nums', p.excess30 !== null && (Number(p.excess30) > 0 ? 'text-positive' : Number(p.excess30) < 0 ? 'text-negative' : ''))}
                    title="30-day excess return vs SPY"
                  >
                    {isHeldOut(p.signalAt.getTime(), heldFrom) ? 'held out' : p.excess30 === null ? 'pending' : formatPct(Number(p.excess30))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">8-Ks, prior 90 days</h3>
          {eightKs === null ? (
            <p className="text-muted-foreground text-sm">Listed once the agent has evaluated this signal.</p>
          ) : eightKs.length === 0 ? (
            <p className="text-muted-foreground text-sm">None filed.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {eightKs.slice(0, 8).map((k, i) => (
                <li key={i}>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs">{formatDay(k.date)}</span>
                    {k.form === '8-K/A' ? <Badge variant="outline">amendment</Badge> : null}
                  </div>
                  <div className="text-muted-foreground text-xs">{k.items.length ? k.items.join('; ') : 'No item codes listed'}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
