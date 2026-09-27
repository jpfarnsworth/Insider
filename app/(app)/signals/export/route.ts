import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth/require-user';
import { excessAt, type ViewOptions } from '@/lib/analytics/facts';
import { DISPLAY_KEY, displaySchema } from '@/lib/display';
import { costsSchema, COSTS_KEY } from '@/lib/market/costs';
import { getSetting } from '@/lib/settings';
import { toCsv } from '@/lib/signals/csv';
import { applyFilters, parseFilters } from '@/lib/signals/filters';
import { loadSignalRows } from '@/lib/signals/load';

const HORIZONS = [5, 10, 30, 60, 90];

// The list as CSV, honouring the same filters and sort as the page.
export async function GET(req: Request) {
  await requireUser();
  const filters = parseFilters(Object.fromEntries(new URL(req.url).searchParams));
  const [rows, display, costs] = await Promise.all([
    loadSignalRows(db),
    getSetting(db, DISPLAY_KEY, displaySchema),
    getSetting(db, COSTS_KEY, costsSchema),
  ]);
  const view: ViewOptions = { bench: display.defaultBenchmark, net: true, scope: 'all', costs };
  const list = applyFilters(rows, filters);

  const csv = toCsv(
    [
      'signal_at_utc',
      'ticker',
      'company',
      'insiders',
      'total_value_usd',
      'baseline_score',
      'agent_score',
      'conviction',
      'roles',
      'cluster_status',
      'signal_status',
      'after_model_cutoff',
      'tags',
      'held_out',
      ...HORIZONS.map((h) => `excess_${h}d_net_vs_${view.bench}_pct`),
    ],
    list.map((r) => [
      new Date(r.signalAt).toISOString(),
      r.ticker,
      r.issuer,
      r.insiderCount,
      r.totalValue,
      r.baselineScore,
      r.agentScore,
      r.conviction,
      r.roleMix,
      r.clusterStatus,
      r.status,
      r.postCutoff ? 'yes' : 'no',
      r.tags.join(' '),
      r.holdout ? 'yes' : 'no',
      ...HORIZONS.map((h) => {
        const v = excessAt(r, h, view);
        return v === null ? null : Number(v.toFixed(2));
      }),
    ]),
  );

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="signals-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
