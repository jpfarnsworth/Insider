'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  BarChart3,
  Building2,
  Eye,
  LayoutDashboard,
  Settings,
  Users,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Phase 2 adds "Paper Trading" behind the paper_trading flag (spec §9.1).
const NAV = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/signals', label: 'Signals', icon: Zap },
  { href: '/companies', label: 'Companies', icon: Building2 },
  { href: '/insiders', label: 'Insiders', icon: Users },
  { href: '/performance', label: 'Performance', icon: BarChart3 },
  { href: '/watchlist', label: 'Watchlist', icon: Eye },
  { href: '/system', label: 'System', icon: Activity },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex gap-1 overflow-x-auto p-2 md:flex-col md:overflow-visible">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
              active
                ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-xs ring-1 ring-sidebar-border font-medium before:bg-primary before:absolute before:inset-y-1.5 before:right-0 before:w-0.5 before:rounded-full md:before:content-[\'\']'
                : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
            )}
          >
            <Icon className={cn('size-4', active && 'text-primary')} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
