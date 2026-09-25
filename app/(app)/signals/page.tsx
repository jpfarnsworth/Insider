import { requireUser } from '@/lib/auth/require-user';
import { EmptyState, PageHeader } from '@/components/page-header';

export default async function SignalsPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="Signals" />
      <EmptyState>Detected insider-buying clusters arrive with milestone 4.</EmptyState>
    </>
  );
}
