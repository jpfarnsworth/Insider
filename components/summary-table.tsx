import type { BucketRow } from '@/lib/analytics/facts';
import { MIN_N } from '@/lib/analytics/stats';
import { formatPct, formatRate } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Count, mean, median, hit rate and t-stat per bucket (spec §9.7). A bucket under MIN_N shows
 * "insufficient data" instead of numbers that would look more certain than they are.
 * The sign carries gain/loss; colour only reinforces it.
 */
export function SummaryTable({ title, rows }: { title: string; rows: BucketRow[] }) {
  if (!rows.length) return <p className="text-muted-foreground text-sm">No completed outcomes for {title.toLowerCase()} yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">{title}</caption>
        <thead>
          <tr className="text-muted-foreground border-b text-left text-xs tracking-wide uppercase">
            <th className="py-2 pr-4 font-medium">{title}</th>
            <th className="px-3 py-2 text-right font-medium">n</th>
            <th className="px-3 py-2 text-right font-medium">Mean</th>
            <th className="px-3 py-2 text-right font-medium">Median</th>
            <th className="px-3 py-2 text-right font-medium">Hit rate</th>
            <th className="py-2 pl-3 text-right font-medium">t-stat</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ key, summary: s }) => (
            <tr key={key} className="border-b last:border-b-0">
              <td className="py-2 pr-4">{key}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{s.n}</td>
              {s.sufficient ? (
                <>
                  <td className={cn('px-3 py-2 text-right font-mono tabular-nums', s.mean > 0 ? 'text-positive' : s.mean < 0 ? 'text-negative' : '')}>{formatPct(s.mean, 2)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{formatPct(s.median, 2)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{formatRate(s.hitRate)}</td>
                  <td className="py-2 pl-3 text-right font-mono tabular-nums">{Number.isNaN(s.tStat) ? '—' : s.tStat.toFixed(2)}</td>
                </>
              ) : (
                <td colSpan={4} className="text-muted-foreground px-3 py-2 text-right text-xs">
                  Insufficient data (needs {MIN_N})
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
