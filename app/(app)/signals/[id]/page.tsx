import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asc, desc, eq, and } from 'drizzle-orm';
import { db } from '@/lib/db';
import { clusterEvents, clusters, clusterTransactions, filingOwners, filings, insiders, issuers, signals, transactions } from '@/db/schema';
import { requireUser } from '@/lib/auth/require-user';
import { roleOf, type BaselineResult } from '@/lib/scoring/baseline';
import { formatDateTime, formatDay, formatFullDay, formatNumber, formatPrice, formatUsd } from '@/lib/format';
import { ScoreBadge } from '@/components/score-badge';
import { AgentPanel } from './agent-panel';
import { Context } from './context';
import { Performance } from './performance';
import { WatchlistButton } from '@/components/watchlist-button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ROLE_LABEL = { ceo: 'CEO', cfo: 'CFO', officer: 'Officer', director: 'Director', other: 'Other' } as const;

const EVENT_LABEL: Record<string, string> = {
  signal_created: 'Signal created',
  insider_joined: 'Another insider joined',
  purchase_added: 'More purchases added',
  closed: 'Cluster closed',
};

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription className="text-xs tracking-wide uppercase">{label}</CardDescription>
        <CardTitle className="font-mono text-2xl tabular-nums">{children}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function eventText(type: string, detail: Record<string, unknown>): string {
  const n = detail.insiderCount as number | undefined;
  const v = detail.totalValue as number | undefined;
  if (type === 'closed') return `No purchases for a full window after ${formatFullDay(detail.lastPurchase as string)}.`;
  if (n === undefined || v === undefined) return '';
  return `${n} insider${n === 1 ? '' : 's'}, ${formatUsd(v)} total.`;
}

export default async function SignalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const [signal] = await db
    .select({
      id: signals.id,
      issuerCik: signals.issuerCik,
      clusterId: signals.clusterId,
      signalAt: signals.signalAt,
      score: signals.baselineScore,
      latestAgentEvalId: signals.latestAgentEvalId,
      entryDate: signals.entryDate,
      entryPrice: signals.entryPrice,
      signalStatus: signals.status,
      breakdown: signals.baselineBreakdown,
      ticker: issuers.ticker,
      issuer: issuers.name,
      industry: issuers.industry,
      marketCap: issuers.marketCap,
      status: clusters.status,
      insiderCount: clusters.insiderCount,
      totalValue: clusters.totalValue,
      windowStart: clusters.windowStart,
      windowEnd: clusters.windowEnd,
      triggerAccession: filings.accessionNo,
      triggerUrl: filings.url,
    })
    .from(signals)
    .innerJoin(clusters, eq(clusters.id, signals.clusterId))
    .innerJoin(issuers, eq(issuers.cik, signals.issuerCik))
    .leftJoin(filings, eq(filings.id, clusters.triggerFilingId))
    .where(eq(signals.id, id))
    .limit(1);
  if (!signal) notFound();

  const [purchases, events] = await Promise.all([
    db
      .select({
        id: transactions.id,
        insider: insiders.name,
        date: transactions.transactionDate,
        shares: transactions.shares,
        price: transactions.price,
        value: transactions.value,
        after: transactions.sharesOwnedAfter,
        acceptedAt: filings.acceptedAt,
        url: filings.url,
        isOfficer: filingOwners.isOfficer,
        officerTitle: filingOwners.officerTitle,
        isDirector: filingOwners.isDirector,
        isTenPctOwner: filingOwners.isTenPctOwner,
      })
      .from(clusterTransactions)
      .innerJoin(transactions, eq(transactions.id, clusterTransactions.transactionId))
      .innerJoin(insiders, eq(insiders.cik, transactions.insiderCik))
      .innerJoin(filings, eq(filings.id, transactions.filingId))
      .leftJoin(
        filingOwners,
        and(eq(filingOwners.filingId, transactions.filingId), eq(filingOwners.insiderCik, transactions.insiderCik)),
      )
      .where(eq(clusterTransactions.clusterId, signal.clusterId))
      .orderBy(asc(transactions.transactionDate), desc(transactions.value)),
    db.select().from(clusterEvents).where(eq(clusterEvents.clusterId, signal.clusterId)).orderBy(asc(clusterEvents.occurredAt)),
  ]);

  const breakdown = signal.breakdown as BaselineResult | null;

  return (
    <>
      <Link href="/signals" className="text-muted-foreground hover:text-primary mb-3 inline-block text-sm">
        ← Signals
      </Link>

      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          {signal.ticker ? <h1 className="font-mono text-2xl font-semibold tracking-tight">{signal.ticker}</h1> : null}
          <span className="text-muted-foreground text-lg">{signal.issuer}</span>
          <Badge variant={signal.status === 'active' ? 'secondary' : 'outline'}>{signal.status === 'active' ? 'Active' : 'Closed'}</Badge>
          <span className="ml-auto">
            <WatchlistButton issuerCik={signal.issuerCik} />
          </span>
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          The market could first know on <span className="text-foreground">{formatDateTime(signal.signalAt)} CT</span>, when{' '}
          {signal.triggerUrl ? (
            <a href={signal.triggerUrl} target="_blank" rel="noreferrer" className="hover:text-primary underline">
              the trigger filing
            </a>
          ) : (
            'the trigger filing'
          )}{' '}
          was accepted by the SEC.
          {signal.industry ? ` ${signal.industry}.` : ''}
        </p>
      </header>

      <section aria-label="Summary" className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Baseline score">
          <ScoreBadge score={signal.score} className="px-3 py-1 text-2xl" />
        </Stat>
        <Stat label="Insiders">{formatNumber(signal.insiderCount)}</Stat>
        <Stat label="Total purchased">{formatUsd(signal.totalValue)}</Stat>
        <Stat label="Purchase window">
          <span className="text-lg">
            {formatDay(signal.windowStart)} – {formatDay(signal.windowEnd)}
          </span>
        </Stat>
      </section>

      <div className="mb-6 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Who bought</CardTitle>
            <CardDescription>Qualifying open-market purchases in this cluster.</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-y text-left text-xs tracking-wide uppercase">
                    <th className="px-4 py-2 font-medium">Insider</th>
                    <th className="px-4 py-2 font-medium">Bought</th>
                    <th className="px-4 py-2 text-right font-medium">Shares</th>
                    <th className="px-4 py-2 text-right font-medium">Price</th>
                    <th className="px-4 py-2 text-right font-medium">Value</th>
                    <th className="px-4 py-2 text-right font-medium">Holds after</th>
                    <th className="px-4 py-2 font-medium">Filed (CT)</th>
                  </tr>
                </thead>
                <tbody>
                  {purchases.map((p) => {
                    const role = roleOf({ isOfficer: !!p.isOfficer, officerTitle: p.officerTitle, isDirector: !!p.isDirector });
                    return (
                      <tr key={p.id} className="hover:bg-muted/50 border-b last:border-b-0">
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <a href={p.url} target="_blank" rel="noreferrer" className="hover:text-primary hover:underline">
                              {p.insider}
                            </a>
                            <Badge variant="secondary" title={p.officerTitle ?? undefined}>
                              {p.isTenPctOwner && role === 'other' ? '10% owner' : ROLE_LABEL[role]}
                            </Badge>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">{formatDay(p.date)}</td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatNumber(p.shares)}</td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatPrice(p.price)}</td>
                        <td className="text-positive px-4 py-2.5 text-right font-mono font-medium tabular-nums">{formatUsd(p.value)}</td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatNumber(p.after)}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap">{formatDateTime(p.acceptedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Timeline</CardTitle>
            <CardDescription>How the cluster developed.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="border-border relative ml-2 space-y-4 border-l pl-5">
              {events.map((e) => (
                <li key={e.id} className="relative">
                  <span className="bg-primary absolute top-1.5 -left-[25px] size-2 rounded-full" aria-hidden />
                  <div className="text-sm font-medium">{EVENT_LABEL[e.eventType] ?? e.eventType}</div>
                  <div className="text-muted-foreground text-xs">{formatDateTime(e.occurredAt)} CT</div>
                  <div className="text-muted-foreground mt-0.5 text-xs">{eventText(e.eventType, e.detail)}</div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>

      <Performance
        signal={{ id: signal.id, ticker: signal.ticker, entryDate: signal.entryDate, entryPrice: signal.entryPrice, status: signal.signalStatus, signalAt: signal.signalAt }}
      />

      <Context signalId={signal.id} issuerCik={signal.issuerCik} signalAt={signal.signalAt} latestEvalId={signal.latestAgentEvalId} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Baseline score</CardTitle>
            <CardDescription>
              {breakdown ? `Deterministic formula v${breakdown.version}. Weights are configurable.` : 'Not scored yet.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {breakdown ? (
              <ul className="space-y-3 text-sm">
                {breakdown.components.map((c) => (
                  <li key={c.key}>
                    <div className="flex items-baseline justify-between">
                      <span>{c.label}</span>
                      <span className="font-mono tabular-nums">
                        {c.raw === null ? 'n/a' : `+${c.points.toFixed(1)}`}
                      </span>
                    </div>
                    <div className="bg-muted mt-1 h-1.5 overflow-hidden rounded-full" aria-hidden>
                      <div className="bg-primary h-full rounded-full" style={{ width: `${(c.raw ?? 0) * 100}%` }} />
                    </div>
                    <div className="text-muted-foreground mt-1 text-xs">{c.note}</div>
                  </li>
                ))}
                <li>
                  <div className="flex items-baseline justify-between">
                    <span>Recent insider selling</span>
                    <span className="text-negative font-mono tabular-nums">
                      {breakdown.penalty.points ? `−${breakdown.penalty.points.toFixed(1)}` : '0.0'}
                    </span>
                  </div>
                  <div className="text-muted-foreground mt-1 text-xs">{breakdown.penalty.note}</div>
                </li>
              </ul>
            ) : null}
          </CardContent>
        </Card>

        <AgentPanel signalId={signal.id} signalAt={signal.signalAt} latestEvalId={signal.latestAgentEvalId} />
      </div>
    </>
  );
}
