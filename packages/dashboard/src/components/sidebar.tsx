'use client';

import { Key, LayoutDashboard, List, Plug, Settings, Shield } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
    <aside className="fixed left-0 top-0 z-30 flex h-full w-56 flex-col border-r border-border bg-[#0a0a0a]/95 backdrop-blur-xl px-3 py-6">
      <Link href="/dashboard" className="mb-8 flex items-center gap-1.5 px-3">
        <img src="/logo-animated.svg" alt="LLMKit" width={32} height={32} />
        <span className="font-mono text-lg font-semibold tracking-tight text-primary">LLMKit</span>
        <svg className="ml-1 h-4 w-4 shrink-0" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.2" />
          <circle cx="12" cy="4" r="2" fill="currentColor" opacity="0.8">
            <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="2.5s" repeatCount="indefinite" />
          </circle>
        </svg>
      </Link>

      <nav className="flex flex-1 flex-col gap-2">
        {items.map((item) => {
          const active = item.href === '/dashboard/admin'
            ? pathname.startsWith('/dashboard/admin')
            : pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2.5 text-base transition-colors',
                active
                  ? 'bg-white/[0.06] text-violet-400'
                  : 'text-zinc-400 hover:bg-white/[0.04] hover:text-white'
              )}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
