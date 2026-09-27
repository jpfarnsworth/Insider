import { isHeldOut, loadHoldoutFrom } from '@/lib/research/holdout';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agentEvaluations, clusters, filings, insiders, issuers, priceBars, signalOutcomes, signals, transactions } from '@/db/schema';
import { requireUser } from '@/lib/auth/require-user';
import { nowMs } from '@/lib/clock';
import { roleOf } from '@/lib/scoring/baseline';
import { formatDateTime, formatDay, formatNumber, formatPct, formatPrice, formatUsd } from '@/lib/format';
import { toAlpacaSymbol } from '@/lib/market/store';
import { CompanyChart } from '@/components/company-chart';
import { PageHeader } from '@/components/page-header';
import { ScoreBadge } from '@/components/score-badge';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { WatchlistButton } from '@/components/watchlist-button';
import { cn } from '@/lib/utils';

const CIK = /^\d{1,10}$/;
const ROLE_LABEL = { ceo: 'CEO', cfo: 'CFO', officer: 'Officer', director: 'Director', other: 'Other' } as const;
const CODES: Array<[string, string]> = [
  ['', 'All'],
  ['P', 'Purchases'],
  ['S', 'Sales'],
  ['A', 'Awards'],
  ['M', 'Exercises'],
  ['F', 'Tax withholding'],
  ['G', 'Gifts'],
];
const CODE_NAME: Record<string, string> = { P: 'Purchase', S: 'Sale', A: 'Award', M: 'Exercise', F: 'Tax withholding', G: 'Gift', D: 'Disposition', C: 'Conversion', X: 'Option exercise', J: 'Other' };

export default async function CompanyPage({ params, searchParams }: { params: Promise<{ cik: string }>; searchParams: Promise<{ code?: string }> }) {
  await requireUser();
  const { cik: rawCik } = await params;
  if (!CIK.test(rawCik)) notFound();
  const cik = rawCik.padStart(10, '0');
  const code = ((await searchParams).code ?? '').toUpperCase();
  const codeFilter = /^[A-Z]$/.test(code) ? code : '';

  const [issuer] = await db.select().from(issuers).where(eq(issuers.cik, cik)).limit(1);
  if (!issuer) notFound();

  const heldFrom = await loadHoldoutFrom(db);
  const yearAgo = new Date(nowMs() - 365 * 86_400_000).toISOString().slice(0, 10);

  const [bars, trades, txns, roster, sigs] = await Promise.all([
    issuer.ticker
      ? db
          .select({ date: priceBars.date, close: priceBars.adjClose })
          .from(priceBars)
          .where(and(eq(priceBars.ticker, toAlpacaSymbol(issuer.ticker)), gte(priceBars.date, yearAgo)))
          .orderBy(asc(priceBars.date))
      : Promise.resolve([]),
    db
      .select({ date: transactions.transactionDate, code: transactions.code, insider: insiders.name, shares: transactions.shares, value: transactions.value })
      .from(transactions)
      .innerJoin(insiders, eq(insiders.cik, transactions.insiderCik))
      .where(and(eq(transactions.issuerCik, cik), eq(transactions.isDerivative, false), gte(transactions.transactionDate, yearAgo), sql`${transactions.code} in ('P','S')`)),
    db
      .select({
        id: transactions.id,
        date: transactions.transactionDate,
        insiderCik: transactions.insiderCik,
        insider: insiders.name,
        code: transactions.code,
        side: transactions.acquiredDisposed,
        derivative: transactions.isDerivative,
        shares: transactions.shares,
        price: transactions.price,
        value: transactions.value,
        after: transactions.sharesOwnedAfter,
        tenb: transactions.is10b5_1,
        url: filings.url,
      })
      .from(transactions)
      .innerJoin(insiders, eq(insiders.cik, transactions.insiderCik))
      .innerJoin(filings, eq(filings.id, transactions.filingId))
      .where(and(eq(transactions.issuerCik, cik), codeFilter ? eq(transactions.code, codeFilter) : undefined))
      .orderBy(desc(transactions.transactionDate), desc(transactions.value))
      .limit(100),
    db.execute<{ cik: string; name: string; officer_title: string | null; is_officer: boolean; is_director: boolean; buys: string; sells: string; nbuys: number; last: string }>(sql`
      select t.insider_cik as cik, ins.name,
             (array_agg(fo.officer_title order by f.accepted_at desc) filter (where fo.officer_title is not null))[1] as officer_title,
             coalesce(bool_or(fo.is_officer), false) as is_officer, coalesce(bool_or(fo.is_director), false) as is_director,
             coalesce(sum(t.value) filter (where t.code = 'P' and not t.is_derivative), 0) as buys,
             coalesce(sum(t.value) filter (where t.code = 'S' and not t.is_derivative), 0) as sells,
             (count(*) filter (where t.code = 'P' and not t.is_derivative))::int as nbuys,
             max(t.transaction_date) as last
      from transactions t
      join insiders ins on ins.cik = t.insider_cik
      join filings f on f.id = t.filing_id
      left join filing_owners fo on fo.filing_id = t.filing_id and fo.insider_cik = t.insider_cik
      where t.issuer_cik = ${cik} and t.transaction_date >= ${yearAgo}
      group by t.insider_cik, ins.name
      order by (coalesce(sum(t.value) filter (where t.code = 'P' and not t.is_derivative), 0) - coalesce(sum(t.value) filter (where t.code = 'S' and not t.is_derivative), 0)) desc
      limit 40`),
    db
      .select({
        id: signals.id,
        signalAt: signals.signalAt,
        baseline: signals.baselineScore,
        agent: agentEvaluations.score,
        insiderCount: clusters.insiderCount,
        totalValue: clusters.totalValue,
        status: clusters.status,
        excess30: sql<string | null>`(select o.excess_return_pct from ${signalOutcomes} o where o.signal_id = ${signals.id} and o.horizon_days = 30 and o.benchmark_ticker = 'SPY' and o.status = 'complete')`,
      })
      .from(signals)
      .innerJoin(clusters, eq(clusters.id, signals.clusterId))
      .leftJoin(agentEvaluations, eq(agentEvaluations.id, signals.latestAgentEvalId))
      .where(eq(signals.issuerCik, cik))
      .orderBy(desc(signals.signalAt)),
  ]);

  const href = (c: string) => `/companies/${cik}${c ? `?code=${c}` : ''}`;

  return (
    <>
      <Link href="/companies" className="text-muted-foreground hover:text-primary mb-3 inline-block text-sm">
        ← Companies
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title={issuer.ticker ? `${issuer.ticker} · ${issuer.name}` : issuer.name}
          description={[issuer.industry?.replace(/^[A-Z]+-/, ''), issuer.exchange, issuer.marketCap ? `Market cap ${formatUsd(issuer.marketCap)}` : null].filter(Boolean).join(' · ') || undefined}
        />
        <WatchlistButton issuerCik={cik} />
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Price and insider trades, last 12 months</CardTitle>
          <CardDescription>Open-market purchases (▲) and sales (▼) by insiders.</CardDescription>
        </CardHeader>
        <CardContent>
          {bars.length ? (
            <CompanyChart
              bars={bars.map((b) => ({ date: b.date, close: Number(b.close) }))}
              markers={trades.flatMap((t) => (t.shares === null || t.value === null ? [] : [{ date: t.date, side: t.code === 'P' ? ('buy' as const) : ('sell' as const), insider: t.insider, shares: Number(t.shares), value: Number(t.value) }]))}
              label={issuer.ticker ?? issuer.name}
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              No price history loaded. Prices are stored for tickers that have a signal{issuer.ticker ? '' : ', and this company has no ticker on file'}.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Signals</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {sigs.length === 0 ? (
            <p className="text-muted-foreground px-4 text-sm">No cluster has formed at this company.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-y text-left text-xs tracking-wide uppercase">
                    <th className="px-4 py-2 font-medium">Signal (CT)</th>
                    <th className="px-4 py-2 text-right font-medium">Insiders</th>
                    <th className="px-4 py-2 text-right font-medium">Total</th>
                    <th className="px-4 py-2 text-right font-medium">Baseline</th>
                    <th className="px-4 py-2 text-right font-medium">Agent</th>
                    <th className="px-4 py-2 text-right font-medium">30d vs SPY</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sigs.map((s) => (
                    <tr key={s.id} className="hover:bg-muted/50 border-b last:border-b-0">
                      <td className="px-4 py-2.5"><Link href={`/signals/${s.id}`} className="hover:text-primary hover:underline">{formatDateTime(s.signalAt)}</Link></td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{s.insiderCount}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatUsd(s.totalValue)}</td>
                      <td className="px-4 py-2.5 text-right"><ScoreBadge score={s.baseline} /></td>
                      <td className="px-4 py-2.5 text-right"><ScoreBadge score={s.agent} /></td>
                      <td className={cn('px-4 py-2.5 text-right font-mono tabular-nums', s.excess30 !== null && (Number(s.excess30) > 0 ? 'text-positive' : Number(s.excess30) < 0 ? 'text-negative' : ''))}>{isHeldOut(s.signalAt.getTime(), heldFrom) ? 'held out' : s.excess30 === null ? '—' : formatPct(Number(s.excess30))}</td>
                      <td className="px-4 py-2.5"><Badge variant={s.status === 'active' ? 'secondary' : 'outline'}>{s.status === 'active' ? 'Active' : 'Closed'}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Insiders</CardTitle>
          <CardDescription>Activity in the last 12 months, largest net buyers first.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-y text-left text-xs tracking-wide uppercase">
                  <th className="px-4 py-2 font-medium">Insider</th>
                  <th className="px-4 py-2 font-medium">Role</th>
                  <th className="px-4 py-2 text-right font-medium">Bought</th>
                  <th className="px-4 py-2 text-right font-medium">Sold</th>
                  <th className="px-4 py-2 text-right font-medium">Net</th>
                  <th className="px-4 py-2 font-medium">Last trade</th>
                </tr>
              </thead>
              <tbody>
                {roster.rows.map((r) => {
                  const net = Number(r.buys) - Number(r.sells);
                  const role = roleOf({ isOfficer: r.is_officer, officerTitle: r.officer_title, isDirector: r.is_director });
                  return (
                    <tr key={r.cik} className="hover:bg-muted/50 border-b last:border-b-0">
                      <td className="px-4 py-2.5"><Link href={`/insiders/${r.cik}`} className="hover:text-primary hover:underline">{r.name}</Link></td>
                      <td className="px-4 py-2.5"><Badge variant="secondary" title={r.officer_title ?? undefined}>{ROLE_LABEL[role]}</Badge></td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatUsd(r.buys)}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatUsd(r.sells)}</td>
                      <td className={cn('px-4 py-2.5 text-right font-mono tabular-nums', net > 0 ? 'text-positive' : net < 0 ? 'text-negative' : '')}>{net > 0 ? '+' : net < 0 ? '−' : ''}{formatUsd(Math.abs(net))}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{formatDay(r.last)}</td>
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
          <CardTitle>Transactions</CardTitle>
          <div className="flex flex-wrap gap-2 pt-1">
            {CODES.map(([c, label]) => (
              <Link
                key={c}
                href={href(c)}
                aria-current={c === codeFilter ? 'true' : undefined}
                className={cn('rounded-full border px-3 py-1 text-xs transition-colors', c === codeFilter ? 'border-primary/40 bg-accent text-accent-foreground font-medium' : 'text-muted-foreground hover:bg-muted')}
              >
                {label}
              </Link>
            ))}
          </div>
        </CardHeader>
        <CardContent className="px-0">
          {txns.length === 0 ? (
            <p className="text-muted-foreground px-4 text-sm">No transactions match.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-y text-left text-xs tracking-wide uppercase">
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 font-medium">Insider</th>
                    <th className="px-4 py-2 font-medium">Type</th>
                    <th className="px-4 py-2 text-right font-medium">Shares</th>
                    <th className="px-4 py-2 text-right font-medium">Price</th>
                    <th className="px-4 py-2 text-right font-medium">Value</th>
                    <th className="px-4 py-2 text-right font-medium">Holds after</th>
                  </tr>
                </thead>
                <tbody>
                  {txns.map((t) => (
                    <tr key={t.id} className="hover:bg-muted/50 border-b last:border-b-0">
                      <td className="px-4 py-2.5 whitespace-nowrap"><a href={t.url} target="_blank" rel="noreferrer" className="hover:text-primary hover:underline">{formatDay(t.date)}</a></td>
                      <td className="px-4 py-2.5"><Link href={`/insiders/${t.insiderCik}`} className="hover:text-primary hover:underline">{t.insider}</Link></td>
                      <td className="px-4 py-2.5">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span>{CODE_NAME[t.code] ?? `Code ${t.code}`}{t.side === 'A' ? ' (acquired)' : t.side === 'D' ? ' (disposed)' : ''}</span>
                          {t.derivative ? <Badge variant="outline">derivative</Badge> : null}
                          {t.tenb ? <Badge variant="outline">10b5-1</Badge> : null}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatNumber(t.shares)}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{t.price === null ? '—' : formatPrice(t.price)}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{t.value === null ? '—' : formatUsd(t.value)}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatNumber(t.after)}</td>
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
