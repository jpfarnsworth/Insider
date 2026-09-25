import { requireUser } from '@/lib/auth/require-user';
import { EmptyState, PageHeader } from '@/components/page-header';

export default async function DashboardPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="Dashboard" />
      <EmptyState>KPIs, charts and latest signals arrive with milestone 7.</EmptyState>
    </>
  );
}
