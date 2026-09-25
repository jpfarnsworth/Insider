import { requireUser } from '@/lib/auth/require-user';
import { EmptyState, PageHeader } from '@/components/page-header';

export default async function WatchlistPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="Watchlist" />
      <EmptyState>Pinned issuers arrive with milestone 7.</EmptyState>
    </>
  );
}
