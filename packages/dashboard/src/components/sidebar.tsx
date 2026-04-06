'use client';

import { useState } from 'react';
import { ArrowLeft, Key, LayoutDashboard, List, Menu, Plug, Settings, Shield, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { AnimatedLogo } from './animated-logo';

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
  const [open, setOpen] = useState(false);
  const items = isAdmin ? [...navItems, adminItem] : navItems;

  return (
    <>
      {/* mobile hamburger */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed left-3 top-3 z-40 flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-[#0a0a0a] md:hidden"
      >
        <Menu className="h-5 w-5 text-zinc-400" />
      </button>

      {/* backdrop */}
      {open && (
        <div className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={() => setOpen(false)} />
      )}

      <aside className={cn(
        'fixed left-0 top-0 z-50 flex h-full w-56 flex-col border-r border-border bg-[#0a0a0a]/95 backdrop-blur-xl px-3 py-6 transition-transform md:translate-x-0',
        open ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      )}>
        <div className="flex items-center justify-between px-3 mb-8">
          <Link href="/" onClick={() => setOpen(false)}>
            <AnimatedLogo className="h-[42px] w-auto" />
          </Link>
          <button type="button" onClick={() => setOpen(false)} className="md:hidden text-zinc-500 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-2">
          <Link
            href="/"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-xs text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300 transition-colors mb-1"
          >
            <ArrowLeft className="h-4 w-4 shrink-0" />
            Back to site
          </Link>
          {items.map((item) => {
            const active = item.href === '/dashboard/admin'
              ? pathname.startsWith('/dashboard/admin')
              : pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
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
    </>
  );
}
