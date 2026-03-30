export const runtime = 'edge';

import Link from 'next/link';
import { PublicNavStatic } from '@/components/public-nav-static';
import { PublicFooter } from '@/components/public-footer';
import { ProviderIcon } from '@/components/provider-icons';
import { TrackClick } from '@/components/track-event';


const providers = [
  { id: 'anthropic', name: 'Anthropic', models: 29, bg: 'bg-orange-500/15 text-orange-400', accent: 'border-l-orange-400' },
  { id: 'openai', name: 'OpenAI', models: 145, bg: 'bg-emerald-500/15 text-emerald-400', accent: 'border-l-emerald-400' },
  { id: 'gemini', name: 'Google Gemini', models: 50, bg: 'bg-blue-500/15 text-blue-400', accent: 'border-l-blue-400' },
  { id: 'xai', name: 'xAI Grok', models: 39, bg: 'bg-zinc-500/15 text-zinc-300', accent: 'border-l-zinc-300' },
  { id: 'deepseek', name: 'DeepSeek', models: 6, bg: 'bg-sky-500/15 text-sky-400', accent: 'border-l-sky-400' },
  { id: 'groq', name: 'Groq', models: 37, bg: 'bg-orange-500/15 text-orange-300', accent: 'border-l-orange-300' },
  { id: 'mistral', name: 'Mistral', models: 63, bg: 'bg-amber-500/15 text-amber-400', accent: 'border-l-amber-400' },
  { id: 'together', name: 'Together', models: 105, bg: 'bg-violet-500/15 text-violet-400', accent: 'border-l-violet-400' },
  { id: 'fireworks', name: 'Fireworks', models: 257, bg: 'bg-red-500/15 text-red-400', accent: 'border-l-red-400' },
  { id: 'ollama', name: 'Ollama', models: 0, bg: 'bg-zinc-500/15 text-zinc-400', accent: 'border-l-zinc-500', tag: 'local' },
  { id: 'openrouter', name: 'OpenRouter', models: 0, bg: 'bg-purple-500/15 text-purple-400', accent: 'border-l-purple-400', tag: 'meta-gateway' },
];

export default function Home() {
  const ctaHref = '/sign-up';
  const ctaLabel = 'Get started free';
  return (
    <div className="relative min-h-screen bg-[#0a0a0a] text-white selection:bg-violet-500/30">
      <div
        className="pointer-events-none fixed inset-0 z-50 opacity-[0.02]"
        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")` }}
      />

      <PublicNavStatic />

      {/* hero - split layout */}
      <div className="relative overflow-hidden">
        <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 h-[600px] w-full max-w-[900px] bg-[radial-gradient(ellipse,_rgba(192,132,252,0.08),_transparent_70%)]" />

        <div className="relative mx-auto max-w-6xl px-6 pt-16 pb-12">
          <div className="grid items-center gap-12 md:grid-cols-2">
            {/* left: text */}
            <div>
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-4 py-1.5 text-xs text-zinc-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Open source, MIT licensed
              </div>

              <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
                Track what your<br />AI agents{' '}
                <span className="bg-gradient-to-r from-violet-400 to-indigo-400 bg-clip-text text-transparent">spend</span>.
              </h1>

              <p className="mt-6 max-w-md text-lg leading-relaxed text-zinc-400">
                Cost tracking and budget enforcement across 11 providers.
                Set a limit. Requests get rejected before they reach the provider.
              </p>

              <div className="mt-8 flex items-center gap-3">
                <Link
                  href={ctaHref}
                  className="rounded-lg bg-violet-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-violet-500 transition"
                >
                  {ctaLabel}
                </Link>
                <TrackClick
                  event="cta_click"
                  properties={{ label: "view_source", location: "hero" }}
                  href="https://github.com/smigolsmigol/llmkit"
                  className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-6 py-2.5 text-sm text-zinc-300 hover:bg-white/[0.06] hover:text-white transition"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View source
                </TrackClick>
              </div>

              <p className="mt-4 text-xs text-zinc-600">
                by{' '}
                <a href="https://github.com/smigolsmigol" className="text-zinc-500 hover:text-zinc-300 transition" target="_blank" rel="noopener noreferrer">
                  @smigolsmigol
                </a>
              </p>
            </div>

            {/* right: floating provider icons */}
            <div className="relative hidden h-[420px] md:block">
              {providers.map((p, i) => {
                const positions = [
                  { top: '5%', left: '15%', rotate: '-6deg', scale: '1.1' },
                  { top: '2%', left: '55%', rotate: '4deg', scale: '1.2' },
                  { top: '8%', left: '85%', rotate: '-3deg', scale: '0.95' },
                  { top: '28%', left: '5%', rotate: '5deg', scale: '1' },
                  { top: '32%', left: '40%', rotate: '-4deg', scale: '1.15' },
                  { top: '25%', left: '72%', rotate: '7deg', scale: '1.05' },
                  { top: '52%', left: '18%', rotate: '-5deg', scale: '1.1' },
                  { top: '55%', left: '50%', rotate: '3deg', scale: '0.9' },
                  { top: '48%', left: '80%', rotate: '-7deg', scale: '1' },
                  { top: '75%', left: '10%', rotate: '4deg', scale: '0.95' },
                  { top: '72%', left: '55%', rotate: '-3deg', scale: '1.05' },
                ];
                const pos = positions[i] ?? { top: '50%', left: '50%', rotate: '0deg', scale: '1' };
                return (
                  <div
                    key={p.name}
                    className="absolute rounded-xl border border-white/[0.08] bg-[#111] p-3 shadow-lg shadow-black/30 transition hover:-translate-y-1 hover:shadow-xl"
                    style={{
                      top: pos.top,
                      left: pos.left,
                      transform: `rotate(${pos.rotate}) scale(${pos.scale})`,
                    }}
                  >
                    <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${p.bg}`}>
                      <ProviderIcon provider={p.id} className="h-5 w-5" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* terminal */}
      <div className="mx-auto max-w-3xl px-6 pb-10">
        <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-[#111]">
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2.5">
            <div className="flex gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
              <div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
              <div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
            </div>
            <span className="ml-2 text-xs text-zinc-500">terminal</span>
          </div>
          <div className="space-y-4 p-5 font-mono text-sm">
            <div>
              <p className="text-zinc-500"># MCP server for Claude Code / Cline / Cursor</p>
              <p><span className="text-emerald-400">$</span> <span className="text-zinc-300">npx @f3d1/llmkit-mcp-server</span></p>
            </div>
            <div>
              <p className="text-zinc-500"># wrap any command, see costs on exit</p>
              <p><span className="text-emerald-400">$</span> <span className="text-zinc-300">npx @f3d1/llmkit-cli -- python agent.py</span></p>
            </div>
            <div>
              <p className="text-zinc-500"># or one line in Python</p>
              <p>
                <span className="text-violet-400">client</span>
                <span className="text-zinc-500"> = </span>
                <span className="text-amber-300">OpenAI</span>
                <span className="text-zinc-400">(</span>
                <span className="text-zinc-300">http_client</span>
                <span className="text-zinc-500">=</span>
                <span className="text-amber-300">tracked</span>
                <span className="text-zinc-400">())</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* three pillars */}
      <div className="mx-auto max-w-5xl px-6 pb-12">
        <div className="grid gap-4 sm:grid-cols-3">
          {/* MCP Server */}
          <Link href="/mcp" className="group">
            <div className="h-full rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 transition hover:border-violet-500/20 hover:bg-white/[0.04]">
              <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10 text-violet-400">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>
              </div>
              <h3 className="text-base font-semibold">MCP Server</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                11 tools for cost tracking inside your IDE. 5 work locally by reading Claude Code, Cursor, and Cline session data. No account needed.
              </p>
              <p className="mt-4 text-xs text-violet-400 group-hover:text-violet-300 transition">
                Learn more {'->'}
              </p>
            </div>
          </Link>

          {/* API Gateway */}
          <Link href="/docs" className="group">
            <div className="h-full rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 transition hover:border-cyan-500/20 hover:bg-white/[0.04]">
              <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/></svg>
              </div>
              <h3 className="text-base font-semibold">API Gateway</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                Budget enforcement that actually blocks requests. Reservation pattern: estimate before, reject if over, settle after. Per-key and per-session limits.
              </p>
              <p className="mt-4 text-xs text-cyan-400 group-hover:text-cyan-300 transition">
                Get started {'->'}
              </p>
            </div>
          </Link>

          {/* Dashboard */}
          <Link href={ctaHref} className="group">
            <div className="h-full rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 transition hover:border-amber-500/20 hover:bg-white/[0.04]">
              <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
              </div>
              <h3 className="text-base font-semibold">Dashboard</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                Spend by model, provider, and session. Request log with full cost breakdown. API key management, budget configuration, anomaly detection.
              </p>
              <p className="mt-4 text-xs text-amber-400 group-hover:text-amber-300 transition">
                Try it free {'->'}
              </p>
            </div>
          </Link>
        </div>
      </div>

      {/* providers */}
      <div className="mx-auto max-w-5xl px-6 pb-10">
        <p className="mb-5 text-center text-sm text-zinc-500">
          11 providers. 730+ models priced. Cache-aware pricing that tracks read and write tokens separately.
        </p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {providers.map((p) => (
            <div
              key={p.name}
              className={`rounded-lg border border-white/[0.06] border-l-2 ${p.accent} bg-white/[0.02] px-3 py-2.5 transition hover:-translate-y-px hover:bg-white/[0.04] hover:border-white/[0.12]`}
            >
              <div className="flex items-center gap-2">
                <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${p.bg}`}>
                  <ProviderIcon provider={p.id} className="h-3.5 w-3.5" />
                </div>
                <div>
                  <p className="text-xs font-medium text-zinc-200">{p.name}</p>
                  <p className="text-[10px] text-zinc-600">{p.tag ?? `${p.models} models`}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* differentiators */}
      <div className="relative mx-auto max-w-5xl px-6 pb-10">
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[300px] w-[600px] bg-[radial-gradient(ellipse,_rgba(34,211,238,0.04),_transparent_70%)]" />
        <div className="relative grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
            <h3 className="text-sm font-semibold text-zinc-200">Budget enforcement</h3>
            <p className="mt-2 text-xs leading-relaxed text-zinc-500">
              Cost is reserved before the request. Exceeded means rejected, not logged after the fact.
            </p>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
            <h3 className="text-sm font-semibold text-zinc-200">Accurate costs</h3>
            <p className="mt-2 text-xs leading-relaxed text-zinc-500">
              Prompt caching makes tokens up to 90% cheaper. We track cached and uncached separately.
            </p>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
            <h3 className="text-sm font-semibold text-zinc-200">Open source</h3>
            <p className="mt-2 text-xs leading-relaxed text-zinc-500">
              MIT licensed. Self-host on Cloudflare Workers free tier. Your keys stay in your infra.
            </p>
          </div>
        </div>
      </div>

      {/* cta */}
      <div className="mx-auto max-w-2xl px-6 pb-8 pt-6 text-center">
        <p className="mb-4 text-sm text-zinc-500">Free while in beta. No credit card.</p>
        <div className="flex items-center justify-center gap-3">
          <Link
            href={ctaHref}
            className="rounded-lg bg-violet-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-violet-500 transition"
          >
            Try the dashboard
          </Link>
          <TrackClick
            event="cta_click"
            properties={{ label: "view_source", location: "footer" }}
            href="https://github.com/smigolsmigol/llmkit"
            className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-6 py-2.5 text-sm text-zinc-300 hover:bg-white/[0.06] hover:text-white transition"
            target="_blank"
            rel="noopener noreferrer"
          >
            View source
          </TrackClick>
        </div>
      </div>

      <PublicFooter />
    </div>
  );
}
