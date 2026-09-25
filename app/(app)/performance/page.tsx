import { requireUser } from '@/lib/auth/require-user';
import { EmptyState, PageHeader } from '@/components/page-header';

export default async function PerformancePage() {
  await requireUser();
  return (
    <>
      <PageHeader title="Performance" />
      <EmptyState>Forward returns and evaluation gates arrive with milestone 7.</EmptyState>
    </>
  );
}
