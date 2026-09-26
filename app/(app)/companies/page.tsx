import Link from 'next/link';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth/require-user';
import { formatDay, formatNumber, formatUsd } from '@/lib/format';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireUser();
  const q = ((await searchParams).q ?? '').trim().slice(0, 60);
  const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;

  // Companies with insider activity in the last 12 months, most recent open-market purchase first.
  const rows = (
    await db.execute<{
      cik: string;
      ticker: string | null;
      name: string;
      industry: string | null;
      last_buy: string | null;
      buys: string;
      sells: string;
      signals: number;
    }>(sql`
      select i.cik, i.ticker, i.name, i.industry,
             max(t.transaction_date) filter (where t.code = 'P') as last_buy,
             coalesce(sum(t.value) filter (where t.code = 'P'), 0) as buys,
             coalesce(sum(t.value) filter (where t.code = 'S'), 0) as sells,
             (select count(*)::int from signals s where s.issuer_cik = i.cik) as signals
      from issuers i
      join transactions t on t.issuer_cik = i.cik and not t.is_derivative and t.transaction_date >= current_date - 365
      ${q ? sql`where i.name ilike ${like} or i.ticker ilike ${like}` : sql``}
      group by i.cik
      order by (select count(*) from signals s where s.issuer_cik = i.cik) desc, max(t.transaction_date) filter (where t.code = 'P') desc nulls last
      limit 100`)
  ).rows;

  return (
    <>
      <PageHeader title="Companies" description="Issuers with insider activity in the last 12 months. Companies with signals come first." />

      <form className="mb-4 flex items-center gap-2" role="search">
        <label htmlFor="q" className="sr-only">
          Search by ticker or name
        </label>
        <Input id="q" name="q" defaultValue={q} placeholder="Search ticker or company" className="max-w-sm" />
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState>No companies match.</EmptyState>
      ) : (
        <Card>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-xs tracking-wide uppercase">
                    <th className="px-4 py-2 font-medium">Company</th>
                    <th className="px-4 py-2 font-medium">Sector</th>
                    <th className="px-4 py-2 text-right font-medium">Signals</th>
                    <th className="px-4 py-2 font-medium">Last buy</th>
                    <th className="px-4 py-2 text-right font-medium">Bought, 12m</th>
                    <th className="px-4 py-2 text-right font-medium">Sold, 12m</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.cik} className="hover:bg-muted/50 border-b last:border-b-0">
                      <td className="px-4 py-2.5">
                        <Link href={`/companies/${r.cik}`} className="hover:text-primary flex items-center gap-2">
                          {r.ticker ? <span className="font-mono font-medium">{r.ticker}</span> : null}
                          <span className="text-muted-foreground max-w-64 truncate">{r.name}</span>
                        </Link>
                      </td>
                      <td className="text-muted-foreground max-w-48 truncate px-4 py-2.5">{r.industry?.replace(/^[A-Z]+-/, '') ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatNumber(r.signals)}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{r.last_buy ? formatDay(r.last_buy) : '—'}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatUsd(r.buys)}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatUsd(r.sells)}</td>
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
