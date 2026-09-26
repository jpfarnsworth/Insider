import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { watchlist } from '@/db/schema';
import { addToWatchlist, removeFromWatchlist } from '@/app/(app)/watchlist/actions';
import { Button } from '@/components/ui/button';

/** Add or remove an issuer from the watchlist; shows the current state. */
export async function WatchlistButton({ issuerCik }: { issuerCik: string }) {
  const [row] = await db.select({ id: watchlist.id }).from(watchlist).where(eq(watchlist.issuerCik, issuerCik)).limit(1);
  return (
    <form action={row ? removeFromWatchlist : addToWatchlist}>
      <input type="hidden" name="issuer" value={issuerCik} />
      <Button type="submit" size="sm" variant="outline">
        {row ? '✓ On watchlist (remove)' : '+ Add to watchlist'}
      </Button>
    </form>
  );
}
