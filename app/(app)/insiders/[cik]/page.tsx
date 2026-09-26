import Link from 'next/link';
import { notFound } from 'next/navigation';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { filings, issuers, transactions } from '@/db/schema';
import { summarize } from '@/lib/analytics/stats';
import { requireUser } from '@/lib/auth/require-user';
import { formatDay, formatNumber, formatPct, formatPrice, formatUsd } from '@/lib/format';
import { insiderName, loadInsiderTrackRecord, type PurchaseOutcome } from '@/lib/market/track-record';
import { roleOf } from '@/lib/scoring/baseline';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const CIK = /^\d{1,10}$/;
const ROLE_LABEL = { ceo: 'CEO', cfo: 'CFO', officer: 'Officer', director: 'Director', other: 'Other' } as const;
const CODE_NAME: Record<string, string> = { P: 'Purchase', S: 'Sale', A: 'Award', M: 'Exercise', F: 'Tax withholding', G: 'Gift', D: 'Disposition', C: 'Conversion', X: 'Option exercise', J: 'Other' };

function Excess({ status, v }: { status: PurchaseOutcome['status30']; v: number | null }) {
  if (status === 'no_prices') return <span className="text-muted-foreground text-xs">no prices</span>;
  if (status === 'pending') return <span className="text-muted-foreground text-xs">pending</span>;
  if (v === null) return <span className="text-muted-foreground">—</span>;
  return <span className={cn('font-mono tabular-nums', v > 0 ? 'text-positive' : v < 0 ? 'text-negative' : '')}>{formatPct(v)}</span>;
}

export default async function InsiderPage({ params }: { params: Promise<{ cik: string }> }) {
  await requireUser();
  const { cik: rawCik } = await params;
  if (!CIK.test(rawCik)) notFound();
  const cik = rawCik.padStart(10, '0');
  const name = await insiderName(db, cik);
  if (!name) notFound();

  const [record, companies, history] = await Promise.all([
    loadInsiderTrackRecord(db, cik),
    db.execute<{ cik: string; ticker: string | null; name: string; officer_title: string | null; is_officer: boolean; is_director: boolean; is_ten: boolean; last: string }>(sql`
      select i.cik, i.ticker, i.name,
             (array_agg(fo.officer_title order by f.accepted_at desc) filter (where fo.officer_title is not null))[1] as officer_title,
             coalesce(bool_or(fo.is_officer), false) as is_officer, coalesce(bool_or(fo.is_director), false) as is_director,
             coalesce(bool_or(fo.is_ten_pct_owner), false) as is_ten, max(t.transaction_date) as last
      from transactions t
      join issuers i on i.cik = t.issuer_cik
      join filings f on f.id = t.filing_id
      left join filing_owners fo on fo.filing_id = t.filing_id and fo.insider_cik = t.insider_cik
      where t.insider_cik = ${cik}
      group by i.cik, i.ticker, i.name
      order by max(t.transaction_date) desc`),
    db
      .select({
        id: transactions.id,
        date: transactions.transactionDate,
        issuerCik: transactions.issuerCik,
        ticker: issuers.ticker,
        code: transactions.code,
        side: transactions.acquiredDisposed,
        derivative: transactions.isDerivative,
        shares: transactions.shares,
        price: transactions.price,
        value: transactions.value,
        url: filings.url,
      })
      .from(transactions)
      .innerJoin(issuers, eq(issuers.cik, transactions.issuerCik))
      .innerJoin(filings, eq(filings.id, transactions.filingId))
      .where(eq(transactions.insiderCik, cik))
      .orderBy(desc(transactions.transactionDate), desc(transactions.value))
      .limit(200),
  ]);

  const done = (h: 30 | 90) => record.flatMap((r) => (r[h === 30 ? 'status30' : 'status90'] === 'complete' && r[h === 30 ? 'excess30' : 'excess90'] !== null ? [r[h === 30 ? 'excess30' : 'excess90'] as number] : []));
  const s30 = summarize(done(30));
  const s90 = summarize(done(90));

  return (
    <>
      <Link href="/insiders" className="text-muted-foreground hover:text-primary mb-3 inline-block text-sm">
        ← Insiders
      </Link>
      <PageHeader title={name} description={`Reports at ${companies.rows.length} compan${companies.rows.length === 1 ? 'y' : 'ies'}.`} />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Companies and roles</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 sm:grid-cols-2">
            {companies.rows.map((c) => {
              const role = roleOf({ isOfficer: c.is_officer, officerTitle: c.officer_title, isDirector: c.is_director });
              return (
                <li key={c.cik} className="flex items-center justify-between gap-3 text-sm">
                  <Link href={`/companies/${c.cik}`} className="hover:text-primary flex min-w-0 items-center gap-2">
                    {c.ticker ? <span className="font-mono font-medium">{c.ticker}</span> : null}
                    <span className="text-muted-foreground truncate">{c.name}</span>
                  </Link>
                  <Badge variant="secondary" title={c.officer_title ?? undefined}>{c.is_ten && role === 'other' ? '10% owner' : ROLE_LABEL[role]}</Badge>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Track record</CardTitle>
          <CardDescription>
            Every open-market purchase, with the return against SPY 30 and 90 trading days after the next open following the filing. Averages of a few
            purchases are anecdotes, not evidence. Prices exist only for companies that have a signal.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 px-0">
          <dl className="grid gap-4 px-4 sm:grid-cols-2">
            {([['30-day', s30], ['90-day', s90]] as const).map(([label, s]) => (
              <div key={label} className="bg-card rounded-lg border p-3">
                <dt className="text-muted-foreground text-xs">Average {label} excess vs SPY</dt>
                <dd className="mt-1 font-mono text-lg tabular-nums">
                  {s.n ? formatPct(s.mean, 2) : '—'} <span className="text-muted-foreground font-sans text-xs">over {s.n} completed purchase{s.n === 1 ? '' : 's'}</span>
                </dd>
              </div>
            ))}
          </dl>
          {record.length === 0 ? (
            <p className="text-muted-foreground px-4 text-sm">No open-market purchases on record.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-y text-left text-xs tracking-wide uppercase">
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 font-medium">Company</th>
                    <th className="px-4 py-2 text-right font-medium">Shares</th>
                    <th className="px-4 py-2 text-right font-medium">Price</th>
                    <th className="px-4 py-2 text-right font-medium">Value</th>
                    <th className="px-4 py-2 text-right font-medium">30d vs SPY</th>
                    <th className="px-4 py-2 text-right font-medium">90d vs SPY</th>
                  </tr>
                </thead>
                <tbody>
                  {record.map((r) => (
                    <tr key={r.transactionId} className="hover:bg-muted/50 border-b last:border-b-0">
                      <td className="px-4 py-2.5 whitespace-nowrap"><a href={r.filingUrl} target="_blank" rel="noreferrer" className="hover:text-primary hover:underline">{formatDay(r.date)}</a></td>
                      <td className="px-4 py-2.5">
                        <Link href={`/companies/${r.issuerCik}`} className="hover:text-primary flex items-center gap-2">
                          {r.ticker ? <span className="font-mono font-medium">{r.ticker}</span> : null}
                          <span className="text-muted-foreground max-w-56 truncate">{r.issuer}</span>
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatNumber(r.shares)}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatPrice(r.price)}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatUsd(r.value)}</td>
                      <td className="px-4 py-2.5 text-right"><Excess status={r.status30} v={r.excess30} /></td>
                      <td className="px-4 py-2.5 text-right"><Excess status={r.status90} v={r.excess90} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All transactions</CardTitle>
          <CardDescription>Most recent 200.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-y text-left text-xs tracking-wide uppercase">
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Company</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 text-right font-medium">Shares</th>
                  <th className="px-4 py-2 text-right font-medium">Price</th>
                  <th className="px-4 py-2 text-right font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {history.map((t) => (
                  <tr key={t.id} className="hover:bg-muted/50 border-b last:border-b-0">
                    <td className="px-4 py-2.5 whitespace-nowrap"><a href={t.url} target="_blank" rel="noreferrer" className="hover:text-primary hover:underline">{formatDay(t.date)}</a></td>
                    <td className="px-4 py-2.5"><Link href={`/companies/${t.issuerCik}`} className="hover:text-primary font-mono hover:underline">{t.ticker ?? t.issuerCik}</Link></td>
                    <td className="px-4 py-2.5">{CODE_NAME[t.code] ?? `Code ${t.code}`}{t.side === 'A' ? ' (acquired)' : t.side === 'D' ? ' (disposed)' : ''}{t.derivative ? ' · derivative' : ''}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatNumber(t.shares)}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">{t.price === null ? '—' : formatPrice(t.price)}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">{t.value === null ? '—' : formatUsd(t.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
