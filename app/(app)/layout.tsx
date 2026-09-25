import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { filings } from '@/db/schema';
import { requireUser } from '@/lib/auth/require-user';
import { formatDateTime } from '@/lib/format';
import { signOut } from '@/auth';
import { SidebarNav } from '@/components/sidebar-nav';
import { Button } from '@/components/ui/button';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [{ latest }] = await db.select({ latest: sql<string | null>`max(${filings.acceptedAt})` }).from(filings);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="bg-sidebar text-sidebar-foreground border-b md:w-56 md:shrink-0 md:border-r md:border-b-0">
        <div className="px-4 pt-4 pb-2 text-sm font-semibold tracking-tight">Insider Signals</div>
        <SidebarNav />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b px-4 py-2 text-sm">
          {/* Prices arrive with the price job in milestone 5 (spec §9.1). */}
          <span className="text-muted-foreground font-mono text-xs tabular-nums">
            Filings through {latest ? `${formatDateTime(new Date(latest))} CT` : '—'} · Prices through —
          </span>
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground hidden sm:inline">{user.email}</span>
            <form
              action={async () => {
                'use server';
                await signOut({ redirectTo: '/sign-in' });
              }}
            >
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
