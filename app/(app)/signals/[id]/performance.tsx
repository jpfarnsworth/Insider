import { db } from '@/lib/db';
import { loadSignalPerformance } from '@/lib/market/performance';
import { formatDay } from '@/lib/format';
import { PriceChart } from '@/components/price-chart';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const pct = (v: number | null, digits = 1) =>
  v === null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}%`;

/** Gain or loss: sign and colour together (the sign carries the meaning, colour is a hint). */
function Return({ v }: { v: number | null }) {
  return <span className={cn('font-mono tabular-nums', v !== null && (v > 0 ? 'text-positive' : v < 0 ? 'text-negative' : ''))}>{pct(v)}</span>;
}

export async function Performance({
  signal,
}: {
  signal: { id: string; ticker: string | null; entryDate: string | null; entryPrice: string | null; status: string };
}) {
  const perf = await loadSignalPerformance(db, signal);
  const anyMatured = perf.horizons.some((h) => h.status !== 'pending');

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Performance vs benchmarks</CardTitle>
        <CardDescription>
          {signal.entryDate ? (
            <>
              Entry at the next open after the filing was accepted: {formatDay(signal.entryDate)}
              {signal.entryPrice ? `, $${Number(signal.entryPrice).toFixed(2)}` : ''}.
            </>
          ) : (
            'Entry is set once prices are loaded for the next trading day.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {signal.status === 'data_ended' ? (
          <p role="note" className="bg-warning-bg text-warning rounded-lg px-3 py-2 text-sm">
            Price data for this ticker ended or is missing. Horizons that matured after it stopped use the last available
            price, or show no return when there was none at entry.
          </p>
        ) : null}

        {perf.chart ? (
          <PriceChart points={perf.chart.points} entryIndex={perf.chart.entryIndex} stockLabel={signal.ticker ?? 'Stock'} benchLabel="SPY" />
        ) : (
          <p className="text-muted-foreground text-sm">No price chart yet: prices for this ticker and the entry day are not loaded.</p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left text-xs tracking-wide uppercase">
                <th className="py-2 pr-4 font-medium">Horizon</th>
                <th className="px-4 py-2 text-right font-medium">Return</th>
                <th className="px-4 py-2 text-right font-medium">Net of costs</th>
                <th className="px-4 py-2 text-right font-medium">vs SPY</th>
                <th className="px-4 py-2 text-right font-medium">vs IWM</th>
                <th className="px-4 py-2 text-right font-medium">Max drawdown</th>
                <th className="py-2 pl-4 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {perf.horizons.map((h) => (
                <tr key={h.horizonDays} className="border-b last:border-b-0">
                  <td className="py-2.5 pr-4">
                    {h.horizonDays} trading days
                    {h.exitDate ? <span className="text-muted-foreground ml-2 text-xs">to {formatDay(h.exitDate)}</span> : null}
                  </td>
                  <td className="px-4 py-2.5 text-right"><Return v={h.returnPct} /></td>
                  <td className="px-4 py-2.5 text-right"><Return v={h.netReturnPct} /></td>
                  <td className="px-4 py-2.5 text-right"><Return v={h.excess.SPY ?? null} /></td>
                  <td className="px-4 py-2.5 text-right"><Return v={h.excess.IWM ?? null} /></td>
                  <td className="px-4 py-2.5 text-right"><Return v={h.maxDrawdownPct} /></td>
                  <td className="py-2.5 pl-4">
                    {h.status === 'complete' ? (
                      <Badge variant="secondary">Complete</Badge>
                    ) : h.status === 'data_ended' ? (
                      <Badge variant="outline">Data ended</Badge>
                    ) : (
                      <Badge variant="outline">Pending</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-muted-foreground text-xs">
          {anyMatured ? '' : 'No horizon has matured yet. '}
          Buy at the entry open, sell at the close on the horizon day (the entry day is day 1), using split- and
          dividend-adjusted prices. Excess = the stock&apos;s return minus the benchmark&apos;s over the same dates. Net
          subtracts an estimated {perf.costPct.toFixed(2)}% round-trip cost ({perf.costPct > 0.5 ? 'thinly traded' : 'liquid'} name).
        </p>
      </CardContent>
    </Card>
  );
}
