import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { filingOwners, filings, insiders, issuers, signals, transactions } from '@/db/schema';
import { requireUser } from '@/lib/auth/require-user';
import { formatDay, formatNumber, formatPrice, formatUsd } from '@/lib/format';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

// Open-market purchase, non-derivative (spec §4). Clusters and scores arrive with milestone 4+.
const openMarketBuy = and(eq(transactions.code, 'P'), eq(transactions.isDerivative, false));

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

function roleLabel(o: {
  isOfficer: boolean | null;
  officerTitle: string | null;
  isDirector: boolean | null;
  isTenPctOwner: boolean | null;
}) {
  if (o.isOfficer) return o.officerTitle || 'Officer';
  if (o.isDirector) return 'Director';
  if (o.isTenPctOwner) return '10% owner';
  return 'Other';
}

export default async function DashboardPage() {
  await requireUser();

  const [[totals], [sig], buys] = await Promise.all([
    db
      .select({
        filings: sql<number>`(select count(*)::int from ${filings})`,
        buys30: sql<number>`count(*) filter (where ${transactions.transactionDate} >= current_date - 30)::int`,
        buyers30: sql<number>`count(distinct ${transactions.issuerCik}) filter (where ${transactions.transactionDate} >= current_date - 30)::int`,
        value30: sql<string>`coalesce(sum(${transactions.value}) filter (where ${transactions.transactionDate} >= current_date - 30), 0)`,
      })
      .from(transactions)
      .where(openMarketBuy),
    db
      .select({
        total: sql<number>`count(*)::int`,
        dataEnded: sql<number>`count(*) filter (where ${signals.status} = 'data_ended')::int`,
      })
      .from(signals),
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
      .leftJoin(
        filingOwners,
        and(eq(filingOwners.filingId, transactions.filingId), eq(filingOwners.insiderCik, transactions.insiderCik)),
      )
      .where(openMarketBuy)
      .orderBy(desc(transactions.transactionDate), desc(transactions.value))
      .limit(50),
  ]);

  return (
    <>
      <PageHeader title="Dashboard" description="Recent insider open-market purchases from ingested Form 4 filings." />

      <section aria-label="Summary" className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Signals" value={formatNumber(sig.total)} hint={`${formatNumber(sig.dataEnded)} with price data ended`} />
        <Stat label="Filings ingested" value={formatNumber(totals.filings)} />
        <Stat label="Purchases, 30d" value={formatNumber(totals.buys30)} />
        <Stat label="Companies buying, 30d" value={formatNumber(totals.buyers30)} />
        <Stat label="Purchase value, 30d" value={formatUsd(totals.value30)} />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Latest open-market purchases</CardTitle>
          <CardDescription>Newest 50 by transaction date. Cluster detection and scoring are not built yet.</CardDescription>
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
                      <td className="text-positive px-4 py-2.5 text-right font-mono font-medium tabular-nums">
                        {formatUsd(b.value)}
                      </td>
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
