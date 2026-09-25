import { requireUser } from '@/lib/auth/require-user';
import { EmptyState, PageHeader } from '@/components/page-header';

export default async function CompaniesPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="Companies" />
      <EmptyState>Issuer pages arrive with milestone 7.</EmptyState>
    </>
  );
}
