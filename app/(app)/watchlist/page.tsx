import Link from 'next/link';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { clusters, insiders, issuers, transactions, watchlist } from '@/db/schema';
import { requireUser } from '@/lib/auth/require-user';
import { formatDateTime, formatDay, formatNumber, formatUsd } from '@/lib/format';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { addToWatchlist, removeFromWatchlist, updateWatchNote } from './actions';

const CODE_LABEL: Record<string, string> = { P: 'bought', S: 'sold', A: 'award', M: 'exercise', F: 'tax withholding', G: 'gift', D: 'disposed' };

export default async function WatchlistPage() {
  await requireUser();

  const rows = await db
    .select({
      cik: issuers.cik,
      ticker: issuers.ticker,
      name: issuers.name,
      note: watchlist.note,
      addedAt: watchlist.addedAt,
      // The most recent transaction by any insider, and the buying in the last 12 months.
      lastDate: sql<string | null>`(select max(t.transaction_date) from ${transactions} t where t.issuer_cik = ${issuers.cik} and not t.is_derivative)`,
      buys12: sql<string>`coalesce((select sum(t.value) from ${transactions} t where t.issuer_cik = ${issuers.cik} and t.code = 'P' and not t.is_derivative and t.transaction_date >= current_date - 365), 0)`,
      buyers12: sql<number>`(select count(distinct t.insider_cik)::int from ${transactions} t where t.issuer_cik = ${issuers.cik} and t.code = 'P' and not t.is_derivative and t.transaction_date >= current_date - 365)`,
      clusterStatus: sql<string | null>`(select c.status from ${clusters} c where c.issuer_cik = ${issuers.cik} order by c.created_at desc limit 1)`,
      clusterInsiders: sql<number | null>`(select c.insider_count from ${clusters} c where c.issuer_cik = ${issuers.cik} order by c.created_at desc limit 1)`,
      signalId: sql<string | null>`(select s.id from signals s where s.issuer_cik = ${issuers.cik} order by s.signal_at desc limit 1)`,
    })
    .from(watchlist)
    .innerJoin(issuers, eq(issuers.cik, watchlist.issuerCik))
    .orderBy(desc(watchlist.addedAt));

  // Latest transaction detail per issuer, for a readable "latest insider activity".
  const latest = new Map<string, { insider: string; code: string; date: string; value: string | null }>();
  for (const r of rows) {
    if (!r.lastDate) continue;
    const [t] = await db
      .select({ insider: insiders.name, code: transactions.code, date: transactions.transactionDate, value: transactions.value })
      .from(transactions)
      .innerJoin(insiders, eq(insiders.cik, transactions.insiderCik))
      .where(eq(transactions.issuerCik, r.cik))
      .orderBy(desc(transactions.transactionDate), desc(transactions.value))
      .limit(1);
    if (t) latest.set(r.cik, t);
  }

  return (
    <>
      <PageHeader title="Watchlist" description="Companies you are following, with their latest insider activity and any cluster in progress." />

      <Card className="mb-6">
        <CardContent>
          <form action={addToWatchlist} className="flex flex-wrap items-center gap-2">
            <label htmlFor="issuer" className="sr-only">
              Ticker or CIK
            </label>
            <Input id="issuer" name="issuer" required placeholder="Ticker or CIK" className="w-40" />
            <label htmlFor="note" className="sr-only">
              Note
            </label>
            <Input id="note" name="note" placeholder="Note (optional)" className="min-w-48 flex-1" />
            <Button type="submit">Add</Button>
          </form>
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <EmptyState>Nothing here yet. Add a company above, or use “Add to watchlist” on a signal or company page.</EmptyState>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const l = latest.get(r.cik);
            return (
              <Card key={r.cik}>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <Link href={`/companies/${r.cik}`} className="hover:text-primary flex items-center gap-2 text-base font-medium">
                        {r.ticker ? <span className="font-mono">{r.ticker}</span> : null}
                        <span className="text-muted-foreground font-normal">{r.name}</span>
                      </Link>
                      <div className="text-muted-foreground mt-1 text-xs">Added {formatDateTime(r.addedAt)} CT</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {r.signalId ? (
                        <Link href={`/signals/${r.signalId}`} className="text-muted-foreground hover:text-primary text-xs underline">
                          Latest signal
                        </Link>
                      ) : null}
                      <form action={removeFromWatchlist}>
                        <input type="hidden" name="issuer" value={r.cik} />
                        <Button type="submit" size="sm" variant="outline">
                          Remove
                        </Button>
                      </form>
                    </div>
                  </div>

                  <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-muted-foreground text-xs">Latest insider activity</dt>
                      <dd>{l ? `${l.insider} ${CODE_LABEL[l.code] ?? `code ${l.code}`} on ${formatDay(l.date)}${l.value ? `, ${formatUsd(l.value)}` : ''}` : 'None recorded'}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs">Bought in the last 12 months</dt>
                      <dd className="font-mono tabular-nums">
                        {formatUsd(r.buys12)} <span className="text-muted-foreground font-sans text-xs">by {formatNumber(r.buyers12)} insider{r.buyers12 === 1 ? '' : 's'}</span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs">Cluster</dt>
                      <dd>
                        {r.clusterStatus ? (
                          <span className="flex items-center gap-2">
                            <Badge variant={r.clusterStatus === 'active' ? 'secondary' : 'outline'}>{r.clusterStatus === 'active' ? 'Active' : 'Closed'}</Badge>
                            <span className="text-muted-foreground text-xs">{r.clusterInsiders} insiders</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">None yet</span>
                        )}
                      </dd>
                    </div>
                  </dl>

                  <form action={updateWatchNote} className="flex items-center gap-2">
                    <input type="hidden" name="issuer" value={r.cik} />
                    <label htmlFor={`note-${r.cik}`} className="sr-only">
                      Note for {r.name}
                    </label>
                    <Input id={`note-${r.cik}`} name="note" defaultValue={r.note ?? ''} placeholder="Add a note" className="flex-1" />
                    <Button type="submit" size="sm" variant="outline">
                      Save note
                    </Button>
                  </form>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
