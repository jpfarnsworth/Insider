import Link from 'next/link';
import { asc } from 'drizzle-orm';
import { Download, X } from 'lucide-react';
import { db } from '@/lib/db';
import { savedFilters } from '@/db/schema';
import { requireUser } from '@/lib/auth/require-user';
import { excessAt, type ViewOptions } from '@/lib/analytics/facts';
import { DISPLAY_KEY, displaySchema } from '@/lib/display';
import { COSTS_KEY, costsSchema } from '@/lib/market/costs';
import { getSetting } from '@/lib/settings';
import { formatDateTime, formatNumber, formatPct, formatUsd } from '@/lib/format';
import {
  ROLE_LABELS,
  SORT_LABELS,
  activeCount,
  applyFilters,
  parseFilters,
  toQuery,
  type SignalFilters,
  type SortKey,
} from '@/lib/signals/filters';
import { OFFERING_LIKE } from '@/lib/clusters/tags';
import { loadSignalRows } from '@/lib/signals/load';
import { EmptyState, PageHeader } from '@/components/page-header';
import { ScoreBadge } from '@/components/score-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { deletePreset, savePreset } from './presets';

const MAX_ROWS = 200;
const RETURN_HORIZONS = [5, 30, 90];

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

const selectClass =
  'border-input bg-background h-8 w-full rounded-lg border px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const Excess = ({ v }: { v: number | null }) =>
  v === null ? (
    <span className="text-muted-foreground">—</span>
  ) : (
    <span className={cn('font-mono tabular-nums', v > 0 ? 'text-positive' : v < 0 ? 'text-negative' : '')}>{formatPct(v)}</span>
  );

export default async function SignalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const filters = parseFilters(await searchParams);
  const [rows, presets, display, costs] = await Promise.all([
    loadSignalRows(db),
    db.select().from(savedFilters).orderBy(asc(savedFilters.name)),
    getSetting(db, DISPLAY_KEY, displaySchema),
    getSetting(db, COSTS_KEY, costsSchema),
  ]);
  const view: ViewOptions = { bench: display.defaultBenchmark, net: true, scope: 'all', costs };

  const matched = applyFilters(rows, filters);
  const shown = matched.slice(0, MAX_ROWS);
  const query = toQuery(filters);
  const href = (over: Partial<SignalFilters>) => {
    const q = toQuery({ ...filters, ...over });
    return q ? `/signals?${q}` : '/signals';
  };
  const filterCount = activeCount(filters);

  return (
    <>
      <PageHeader
        title="Signals"
        description="Clusters of insider open-market purchases. The signal time is when the filing that completed the cluster was accepted."
      />

      <form method="get" action="/signals" className="bg-card mb-4 rounded-xl border p-4">
        <details open={filterCount > 0}>
          <summary className="cursor-pointer text-sm font-medium select-none">
            Filters{filterCount > 0 ? <Badge variant="secondary" className="ml-2">{filterCount}</Badge> : null}
          </summary>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label="Company or ticker">
              <Input name="q" defaultValue={filters.q} maxLength={80} />
            </Field>
            <Field label="Signal from">
              <Input type="date" name="from" defaultValue={filters.from ?? ''} />
            </Field>
            <Field label="Signal to">
              <Input type="date" name="to" defaultValue={filters.to ?? ''} />
            </Field>
            <Field label="Outcome (30d)">
              <select name="outcome" defaultValue={filters.outcome ?? ''} className={selectClass}>
                <option value="">Any</option>
                <option value="complete">Complete</option>
                <option value="pending">Not yet available</option>
              </select>
            </Field>
            <Field label="Baseline min">
              <Input type="number" name="bmin" min={0} max={100} defaultValue={filters.baselineMin ?? ''} />
            </Field>
            <Field label="Baseline max">
              <Input type="number" name="bmax" min={0} max={100} defaultValue={filters.baselineMax ?? ''} />
            </Field>
            <Field label="Agent min">
              <Input type="number" name="amin" min={0} max={100} defaultValue={filters.agentMin ?? ''} />
            </Field>
            <Field label="Agent max">
              <Input type="number" name="amax" min={0} max={100} defaultValue={filters.agentMax ?? ''} />
            </Field>
            <Field label="Conviction">
              <select name="conviction" defaultValue={filters.conviction ?? ''} className={selectClass}>
                <option value="">Any</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </Field>
            <Field label="Insider role">
              <select name="role" defaultValue={filters.role ?? ''} className={selectClass}>
                <option value="">Any</option>
                {(Object.keys(ROLE_LABELS) as (keyof typeof ROLE_LABELS)[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Offering-like buys">
              <select name="offering" defaultValue={filters.offering ?? ''} className={selectClass}>
                <option value="">Include</option>
                <option value="exclude">Exclude</option>
                <option value="only">Only these</option>
              </select>
            </Field>
            <Field label="Cluster status">
              <select name="status" defaultValue={filters.status ?? ''} className={selectClass}>
                <option value="">Any</option>
                <option value="active">Active</option>
                <option value="closed">Closed</option>
              </select>
            </Field>
            <input type="hidden" name="sort" value={filters.sort} />
            <div className="flex items-end gap-2">
              <Button type="submit" size="sm">
                Apply
              </Button>
              {filterCount > 0 ? (
                <Link href={href({ ...parseFilters({}), sort: filters.sort })} className="text-muted-foreground hover:text-foreground text-xs underline">
                  Clear
                </Link>
              ) : null}
            </div>
          </div>
          <p className="text-muted-foreground mt-3 text-xs">Market-cap and sector filters are not offered yet: there is no market-cap or sector data source.</p>
        </details>
      </form>

      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Sort</span>
          {(Object.keys(SORT_LABELS) as SortKey[]).map((s) => (
            <Chip key={s} href={href({ sort: s })} active={s === filters.sort}>
              {SORT_LABELS[s]}
            </Chip>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Status</span>
          <Chip href={href({ status: null })} active={filters.status === null}>
            All
          </Chip>
          <Chip href={href({ status: 'active' })} active={filters.status === 'active'}>
            Active
          </Chip>
          <Chip href={href({ status: 'closed' })} active={filters.status === 'closed'}>
            Closed
          </Chip>
        </div>
        <a
          href={`/signals/export${query ? `?${query}` : ''}`}
          className="text-muted-foreground hover:text-foreground ml-auto inline-flex items-center gap-1.5 hover:underline"
        >
          <Download className="size-3.5" aria-hidden /> Export CSV
        </a>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Saved</span>
        {presets.length === 0 ? <span className="text-muted-foreground">none yet</span> : null}
        {presets.map((p) => (
          <span key={p.id} className="bg-card inline-flex items-center rounded-full border">
            <Link
              href={p.params ? `/signals?${p.params}` : '/signals'}
              aria-current={p.params === query ? 'true' : undefined}
              className={cn('rounded-l-full py-1 pr-2 pl-3', p.params === query ? 'text-accent-foreground font-medium' : 'text-muted-foreground hover:text-foreground')}
            >
              {p.name}
            </Link>
            <form action={deletePreset}>
              <input type="hidden" name="id" value={p.id} />
              <button type="submit" aria-label={`Delete saved filter ${p.name}`} className="text-muted-foreground hover:text-negative rounded-r-full py-1 pr-2 pl-1">
                <X className="size-3" aria-hidden />
              </button>
            </form>
          </span>
        ))}
        <form action={savePreset} className="ml-auto flex items-center gap-2">
          <input type="hidden" name="params" value={query} />
          <Input name="name" placeholder="Save current view as…" maxLength={40} required className="h-7 w-44 text-xs" aria-label="Name for saved filter" />
          <Button type="submit" size="sm" variant="outline">
            Save
          </Button>
        </form>
      </div>

      {rows.length === 0 ? (
        <EmptyState>No signals yet. They appear once clusters are detected in ingested filings.</EmptyState>
      ) : matched.length === 0 ? (
        <EmptyState>No signals match these filters.</EmptyState>
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
                    {RETURN_HORIZONS.map((h) => (
                      <th key={h} className="px-4 py-2 text-right font-medium" title={`Net excess return vs ${view.bench}, ${h} trading days`}>
                        {h}d
                      </th>
                    ))}
                    <th className="px-4 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/50 border-b last:border-b-0">
                      <td className="px-4 py-2.5">
                        <Link href={`/signals/${r.id}`} className="hover:text-primary flex items-center gap-2">
                          {r.ticker ? <span className="font-mono font-medium">{r.ticker}</span> : null}
                          <span className="text-muted-foreground max-w-64 truncate">{r.issuer}</span>
                          {r.tags.includes(OFFERING_LIKE) ? (
                            <Badge variant="outline" title="Every purchase on one day at one price, like an offering or conversion allotment">
                              offering-like
                            </Badge>
                          ) : null}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{formatDateTime(new Date(r.signalAt))}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatNumber(r.insiderCount)}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatUsd(r.totalValue)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <ScoreBadge score={r.baselineScore} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <ScoreBadge score={r.agentScore} />
                      </td>
                      {RETURN_HORIZONS.map((h) => (
                        <td key={h} className="px-4 py-2.5 text-right">
                          <Excess v={excessAt(r, h, view)} />
                        </td>
                      ))}
                      <td className="px-4 py-2.5">
                        <Badge variant={r.clusterStatus === 'active' ? 'secondary' : 'outline'}>
                          {r.clusterStatus === 'active' ? 'Active' : 'Closed'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-muted-foreground px-4 pt-3 text-xs">
              {matched.length > MAX_ROWS ? `Showing the first ${MAX_ROWS} of ${matched.length} signals; the CSV has all of them. ` : `${matched.length} signals. `}
              Returns are net of costs vs {view.bench}, complete outcomes only.
            </p>
          </CardContent>
        </Card>
      )}
    </>
  );
}
