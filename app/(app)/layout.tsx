import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { filings, priceBars } from '@/db/schema';
import { requireUser } from '@/lib/auth/require-user';
import { formatDateTime, formatFullDay } from '@/lib/format';
import { signOut } from '@/auth';
import { CommandPalette } from '@/components/command-palette';
import { SidebarNav } from '@/components/sidebar-nav';
import { Button } from '@/components/ui/button';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [[{ latest }], [{ pricesThrough }]] = await Promise.all([
    db.select({ latest: sql<string | null>`max(${filings.acceptedAt})` }).from(filings),
    db.select({ pricesThrough: sql<string | null>`max(${priceBars.date})` }).from(priceBars),
  ]);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="bg-sidebar text-sidebar-foreground border-b md:sticky md:top-0 md:h-screen md:w-58 md:shrink-0 md:self-start md:overflow-y-auto md:border-r md:border-b-0">
        <div className="px-5 pt-5 pb-3 text-base font-semibold tracking-tight">
          Insider <span className="text-primary">Signals</span>
        </div>
        <SidebarNav />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-card flex items-center justify-between gap-4 border-b px-4 py-2.5 text-sm md:px-6">
          <span className="text-muted-foreground font-mono text-xs tabular-nums">
            Filings through {latest ? `${formatDateTime(new Date(latest))} CT` : '—'} · Prices through {formatFullDay(pricesThrough)}
          </span>
          <div className="flex items-center gap-3">
            <CommandPalette />
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
