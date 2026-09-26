import Link from 'next/link';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth/require-user';
import { formatDay, formatNumber, formatUsd } from '@/lib/format';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export default async function InsidersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireUser();
  const q = ((await searchParams).q ?? '').trim().slice(0, 60);
  const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;

  const rows = (
    await db.execute<{ cik: string; name: string; companies: number; buys: number; bought: string; last_buy: string | null }>(sql`
      select ins.cik, ins.name,
             count(distinct t.issuer_cik)::int as companies,
             (count(*) filter (where t.code = 'P' and not t.is_derivative))::int as buys,
             coalesce(sum(t.value) filter (where t.code = 'P' and not t.is_derivative), 0) as bought,
             max(t.transaction_date) filter (where t.code = 'P' and not t.is_derivative) as last_buy
      from insiders ins
      join transactions t on t.insider_cik = ins.cik
      ${q ? sql`where ins.name ilike ${like}` : sql``}
      group by ins.cik, ins.name
      having count(*) filter (where t.code = 'P' and not t.is_derivative) > 0
      order by max(t.transaction_date) filter (where t.code = 'P' and not t.is_derivative) desc, coalesce(sum(t.value) filter (where t.code = 'P' and not t.is_derivative), 0) desc
      limit 100`)
  ).rows;

  return (
    <>
      <PageHeader title="Insiders" description="Reporting owners who have made open-market purchases, most recent buyers first." />

      <form className="mb-4 flex items-center gap-2" role="search">
        <label htmlFor="q" className="sr-only">
          Search by name
        </label>
        <Input id="q" name="q" defaultValue={q} placeholder="Search insider name" className="max-w-sm" />
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState>No insiders match.</EmptyState>
      ) : (
        <Card>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-xs tracking-wide uppercase">
                    <th className="px-4 py-2 font-medium">Insider</th>
                    <th className="px-4 py-2 text-right font-medium">Companies</th>
                    <th className="px-4 py-2 text-right font-medium">Purchases</th>
                    <th className="px-4 py-2 text-right font-medium">Total bought</th>
                    <th className="px-4 py-2 font-medium">Last purchase</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.cik} className="hover:bg-muted/50 border-b last:border-b-0">
                      <td className="px-4 py-2.5"><Link href={`/insiders/${r.cik}`} className="hover:text-primary hover:underline">{r.name}</Link></td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatNumber(r.companies)}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatNumber(r.buys)}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatUsd(r.bought)}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{r.last_buy ? formatDay(r.last_buy) : '—'}</td>
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
