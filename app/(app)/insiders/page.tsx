import { requireUser } from '@/lib/auth/require-user';
import { EmptyState, PageHeader } from '@/components/page-header';

export default async function InsidersPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="Insiders" />
      <EmptyState>Insider track records arrive with milestone 7.</EmptyState>
    </>
  );
}
