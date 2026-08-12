import Link from 'next/link';
import { AnimatedLogo } from './animated-logo';

const links = [
  ['Docs', '/docs'],
  ['MCP', '/mcp'],
  ['Pricing', '/pricing'],
  ['Calculator', '/compare'],
] as const;

export function PublicFooter() {
  return (
    <footer className="relative mx-auto grid max-w-6xl gap-8 border-t border-white/[0.06] px-6 pb-12 pt-8 text-xs text-zinc-500 sm:grid-cols-[1fr_auto] sm:items-end">
      <div>
        <AnimatedLogo className="h-9 w-auto opacity-70" />
        <p className="mt-3 max-w-lg leading-5">
          Open-source cost attribution and budget enforcement for AI systems. MIT licensed.{' '}
        <a href="https://github.com/smigolsmigol/llmkit" className="text-zinc-400 underline hover:text-white transition" target="_blank" rel="noopener noreferrer">
            Source on GitHub
        </a>
        .
      </p>
      </div>
      <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2 font-mono text-[10px] uppercase tracking-[0.14em]">
        {links.map(([label, href]) => (
          <Link key={href} href={href} className="transition hover:text-violet-200">
            {label}
          </Link>
        ))}
      </nav>
    </footer>
  );
}
