'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, List, Key, Plug, Settings, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/requests', label: 'Requests', icon: List },
  { href: '/dashboard/keys', label: 'API Keys', icon: Key },
  { href: '/dashboard/providers', label: 'Providers', icon: Plug },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
];

const adminItem = { href: '/dashboard/admin', label: 'Admin', icon: Shield };

export function Sidebar({ isAdmin }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const items = isAdmin ? [...navItems, adminItem] : navItems;

  return (
    <aside className="fixed left-0 top-0 flex h-full w-56 flex-col border-r border-border bg-background px-3 py-6">
      <Link href="/dashboard" className="mb-8 px-3 font-mono text-lg font-semibold tracking-tight text-primary">
        LLMKit
      </Link>

      <nav className="flex flex-1 flex-col gap-1">
        {items.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                active
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
