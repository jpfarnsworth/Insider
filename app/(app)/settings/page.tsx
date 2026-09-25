import { requireUser } from '@/lib/auth/require-user';
import { EmptyState, PageHeader } from '@/components/page-header';

export default async function SettingsPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="Settings" />
      <EmptyState>Cluster rules, weights and budgets arrive with milestone 8.</EmptyState>
    </>
  );
}
