import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** Score 0-100 as a pill. Text carries the meaning; colour is a hint (spec §13). */
export function ScoreBadge({ score, className }: { score: string | number | null; className?: string }) {
  if (score === null) return <span className="text-muted-foreground">—</span>;
  const n = Number(score);
  const tone = n >= 70 ? 'bg-positive-bg text-positive' : n >= 50 ? 'bg-info-bg text-info' : 'bg-muted text-muted-foreground';
  return (
    <Badge variant="outline" className={cn('border-transparent font-mono tabular-nums', tone, className)}>
      {n.toFixed(0)}
    </Badge>
  );
}
