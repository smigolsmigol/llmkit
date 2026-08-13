import Link from 'next/link';
import { PublicPageHero } from '@/components/public/public-page-hero';
import { PublicShell } from '@/components/public/public-shell';

export const metadata = {
  title: 'Dashboard restoration in progress | LLMKit',
  robots: { index: false, follow: false },
};

const services = [
  ['Product site and docs', 'LIVE', 'text-emerald-300'],
  ['Public API and pricing', 'LIVE', 'text-emerald-300'],
  ['Dashboard and auth', 'CLOSED', 'text-amber-300'],
] as const;

export default function ServiceRestoringPage() {
  return (
    <PublicShell>
      <PublicPageHero
        eyebrow="Controlled restoration"
        title="The public surface is live. Auth stays closed until it is proved."
        description="Authenticated account and data access remain unavailable while tenant-isolation checks are completed. Public docs, pricing references, and local tools remain available."
        aside={(
          <div className="public-panel-soft rounded-xl p-4 font-mono text-[10px] leading-5 text-zinc-500">
            <p className="flex items-center gap-2 text-amber-300"><span className="h-1.5 w-1.5 rounded-full bg-amber-300" />restoration active</p>
            <p className="mt-2">fail closed / no data exposure</p>
          </div>
        )}
      />

      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="public-panel overflow-hidden rounded-xl">
          <div className="grid gap-px bg-white/[0.07] sm:grid-cols-3">
            {services.map(([name, state, color]) => (
              <div key={name} className="bg-[#0c0d12] p-5">
                <p className={`font-mono text-[10px] ${color}`}>{state}</p>
                <p className="mt-2 text-sm text-zinc-300">{name}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/[0.07] px-5 py-4">
            <p className="max-w-2xl text-xs leading-5 text-zinc-500">Local MCP, CLI, and Python paths remain usable without a hosted account.</p>
            <div className="flex gap-3">
              <Link href="/" className="text-sm text-zinc-400 transition hover:text-white">Home</Link>
              <Link href="/docs#local-setup" className="text-sm text-violet-300 transition hover:text-violet-200">Local setup -&gt;</Link>
            </div>
          </div>
        </div>
      </section>
    </PublicShell>
  );
}
