'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, List, Key, Plug, Settings, Shield, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/requests', label: 'Requests', icon: List },
  { href: '/dashboard/keys', label: 'API Keys', icon: Key },
  { href: '/dashboard/providers', label: 'Providers', icon: Plug },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
];

const adminItem = { href: '/dashboard/admin', label: 'Admin', icon: Shield };

const adminSubItems = [
  { href: '/dashboard/admin/analytics', label: 'Analytics', icon: BarChart3 },
];

export function Sidebar({ isAdmin }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const items = isAdmin ? [...navItems, adminItem] : navItems;
  const onAdminRoute = pathname.startsWith('/dashboard/admin');

  return (
    <aside className="fixed left-0 top-0 flex h-full w-56 flex-col border-r border-border bg-background px-3 py-6">
      <Link href="/dashboard" className="mb-8 flex items-center gap-2 px-3">
        <img src="/logo-animated.svg" alt="LLMKit" width={64} height={64} />
        <span className="font-mono text-xl font-semibold tracking-tight text-primary">LLMKit</span>
      </Link>

      <nav className="flex flex-1 flex-col gap-2">
        {items.map((item) => {
          const active = item.href === '/dashboard/admin'
            ? onAdminRoute
            : pathname === item.href;
          const Icon = item.icon;
          return (
            <div key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2.5 text-base transition-colors',
                  active
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                )}
              >
                <Icon className="h-5 w-5 shrink-0" />
                {item.label}
              </Link>
              {item.href === '/dashboard/admin' && isAdmin && onAdminRoute && (
                <div className="ml-5 mt-1 flex flex-col gap-0.5 border-l border-[#2a2a2a] pl-3">
                  {adminSubItems.map((sub) => {
                    const subActive = pathname === sub.href;
                    const SubIcon = sub.icon;
                    return (
                      <Link
                        key={sub.href}
                        href={sub.href}
                        className={cn(
                          'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                          subActive
                            ? 'text-primary'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        <SubIcon className="h-3.5 w-3.5 shrink-0" />
                        {sub.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
