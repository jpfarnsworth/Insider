import { requireUser } from '@/lib/auth/require-user';
import { EmptyState, PageHeader } from '@/components/page-header';

export default async function SystemPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="System" />
      <EmptyState>Job runs and the parse-failure queue arrive with the ingest jobs.</EmptyState>
    </>
  );
}
