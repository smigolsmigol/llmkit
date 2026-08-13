'use client';

import Link from 'next/link';
import { useState } from 'react';
import { RECOVERY_PUBLIC_CTA } from '@/lib/public-recovery';
import { AnimatedLogo } from './animated-logo';

const links = [
  { href: '/pricing', label: 'Pricing' },
  { href: '/compare', label: 'Calculator' },
  { href: '/mcp', label: 'MCP' },
  { href: '/docs', label: 'Docs' },
];

export function PublicNavStatic() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#08090c]/88 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" aria-label="LLMKit home" className="flex items-center gap-3">
          <AnimatedLogo className="h-[42px] w-auto" />
          <span className="hidden h-5 w-px bg-white/[0.08] md:block" />
          <span className="hidden font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-600 md:inline">agent cost control</span>
        </Link>
        <div className="flex items-center gap-3 sm:gap-5">
          <div className="hidden sm:flex items-center gap-5">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="text-sm text-zinc-400 hover:text-white transition">
                {l.label}
              </Link>
            ))}
          </div>
          <a
            href="https://github.com/smigolsmigol/llmkit"
            aria-label="View LLMKit on GitHub"
            className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition"
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
            <span className="hidden sm:inline">GitHub</span>
          </a>
          <Link
            href={RECOVERY_PUBLIC_CTA.href}
            className="rounded-md border border-violet-300/20 bg-violet-400/[0.10] px-4 py-1.5 text-sm font-semibold text-violet-100 transition hover:border-violet-300/35 hover:bg-violet-400/[0.16]"
          >
            {RECOVERY_PUBLIC_CTA.label}
          </Link>
          {/* mobile hamburger */}
          <button
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            className="sm:hidden p-1 text-zinc-400 hover:text-white"
            aria-label="Toggle menu"
          >
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              {menuOpen
                ? <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                : <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
              }
            </svg>
          </button>
        </div>
      </div>
      {/* mobile dropdown */}
      {menuOpen && (
        <div className="sm:hidden border-t border-white/[0.06] px-6 py-3 space-y-2">
          {links.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setMenuOpen(false)} className="block text-sm text-zinc-400 hover:text-white transition py-1">
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}
