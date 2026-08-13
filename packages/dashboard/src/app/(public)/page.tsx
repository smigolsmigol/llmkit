import type { Metadata } from 'next';
import Link from 'next/link';
import { BrandSignal } from '@/components/public/brand-signal';
import { DeveloperQuickstart } from '@/components/public/developer-quickstart';
import { PublicShell } from '@/components/public/public-shell';
import { TrackClick } from '@/components/track-event';
import { RECOVERY_PUBLIC_CTA, RECOVERY_STATUS_HREF } from '@/lib/public-recovery';

export const metadata: Metadata = {
  title: 'LLMKit - Cost control for AI systems',
  description:
    'Open-source cost attribution and pre-dispatch budget enforcement across SDK, CLI, MCP, and gateway workflows.',
  openGraph: {
    title: 'LLMKit - Cost control for AI systems',
    description: 'Give every AI request an identity, a budget decision, and an inspectable receipt.',
  },
};

const lifecycle = [
  ['01', 'Identify', 'Bind provider, model, key, session, and price to one request.'],
  ['02', 'Reserve', 'Hold the estimated cost against the budget before dispatch.'],
  ['03', 'Decide', 'Allow or reject at the boundary, before provider spend occurs.'],
  ['04', 'Settle', 'Reconcile actual usage and preserve the decision trail.'],
] as const;

const surfaces = [
  {
    label: 'MCP',
    title: 'Inspect coding-agent sessions',
    body: 'Read supported Claude Code sessions and Cline task data without an LLMKit account.',
    href: '/mcp',
  },
  {
    label: 'CLI',
    title: 'Wrap an existing process',
    body: 'Add a cost summary to an agent command without changing its application code.',
    href: '/docs#local-setup',
  },
  {
    label: 'SDK',
    title: 'Instrument the request in process',
    body: 'Use typed Python and TypeScript clients when attribution belongs in your code.',
    href: '/docs#local-setup',
  },
  {
    label: 'API',
    title: 'Move enforcement to the gateway',
    body: 'Apply the same identity and budget policy across provider-compatible traffic.',
    href: '/docs#local-setup',
  },
];

export default function Home() {
  return (
    <PublicShell>
      <section className="mx-auto grid max-w-6xl gap-10 px-6 pb-14 pt-12 lg:grid-cols-[minmax(0,1fr)_minmax(390px,.9fr)] lg:items-center lg:pt-16">
        <div>
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <span className="public-kicker">LLMKit / request control</span>
            <span className="h-px w-8 bg-zinc-800" />
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-400">Open source / MIT</span>
          </div>

          <h1 className="public-display max-w-[13ch] text-white">
            Cost control for agents that actually run.
          </h1>

          <p className="mt-6 max-w-xl text-base leading-7 text-zinc-400 sm:text-lg">
            Give every request an identity, a budget decision, and a receipt. Start locally, then move
            enforcement to the gateway when the system needs it.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href={RECOVERY_PUBLIC_CTA.href}
              className="inline-flex h-10 items-center rounded-md bg-zinc-100 px-5 text-sm font-semibold text-zinc-950 transition hover:bg-white"
            >
              Start locally
            </Link>
            <TrackClick
              event="cta_click"
              properties={{ label: 'view_source', location: 'signal_hero' }}
              href="https://github.com/smigolsmigol/llmkit"
              className="inline-flex h-10 items-center rounded-md border border-zinc-800 bg-zinc-950/50 px-5 text-sm font-medium text-zinc-300 transition hover:border-violet-300/30 hover:text-white"
              target="_blank"
              rel="noopener noreferrer"
            >
              Read the source
            </TrackClick>
          </div>

          <Link
            href={RECOVERY_STATUS_HREF}
            className="mt-6 inline-flex max-w-xl items-start gap-2 font-mono text-[11px] leading-5 text-zinc-400 transition hover:text-zinc-300"
          >
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300 shadow-[0_0_9px_rgba(252,211,77,.45)]" />
            Hosted accounts are temporarily unavailable. Local tools remain available.
          </Link>
        </div>

        <BrandSignal />
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-16">
        <DeveloperQuickstart />
      </section>

      <section className="border-y border-white/[0.06] bg-white/[0.012]">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="grid gap-9 lg:grid-cols-[250px_1fr]">
            <div>
              <p className="public-kicker">The request lifecycle</p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">A small boundary with hard edges.</h2>
              <p className="mt-4 text-sm leading-6 text-zinc-400">
                In gateway mode, pricing describes the request. Enforcement decides whether it is allowed to become spend.
              </p>
            </div>
            <ol className="grid gap-px overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.07] sm:grid-cols-2 xl:grid-cols-4">
              {lifecycle.map(([index, title, body]) => (
                <li key={index} className="bg-[#0b0c11] p-5">
                  <p className="font-mono text-[10px] text-violet-300">{index}</p>
                  <h3 className="mt-7 text-sm font-semibold text-zinc-100">{title}</h3>
                  <p className="mt-2 text-xs leading-5 text-zinc-400">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="flex flex-col justify-between gap-4 border-b border-white/[0.07] pb-5 sm:flex-row sm:items-end">
          <div>
            <p className="public-kicker">Four ways in</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">Meet the code where it already runs.</h2>
          </div>
          <Link href="/docs" className="font-mono text-xs text-zinc-400 transition hover:text-violet-200">
            Integration docs -&gt;
          </Link>
        </div>

        <div className="divide-y divide-white/[0.06]">
          {surfaces.map((surface) => (
            <Link
              key={surface.label}
              href={surface.href}
              className="public-row-link grid gap-2 border-l border-transparent px-1 py-5 sm:grid-cols-[82px_1fr_1.3fr_24px] sm:items-center"
            >
              <span className="font-mono text-[11px] text-violet-300">{surface.label}</span>
              <span className="text-sm font-semibold text-zinc-200">{surface.title}</span>
              <span className="text-sm leading-6 text-zinc-400">{surface.body}</span>
              <span aria-hidden="true" className="hidden text-right text-zinc-500 sm:block">-&gt;</span>
            </Link>
          ))}
        </div>
      </section>
    </PublicShell>
  );
}
