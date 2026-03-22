import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const { userId } = await auth();
  if (userId) redirect('/dashboard');

  return (
    <div className="relative min-h-screen bg-[#0a0a0a] text-white selection:bg-violet-500/30">
      {/* noise texture */}
      <div
        className="pointer-events-none fixed inset-0 z-50 opacity-[0.02]"
        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")` }}
      />

      {/* nav */}
      <nav className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#0a0a0a]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-1.5">
            <img src="/logo-animated.svg" alt="LLMKit" width={28} height={28} />
            <span className="font-mono text-lg font-semibold tracking-tight">LLMKit</span>
            <svg className="ml-0.5 h-3.5 w-3.5 shrink-0 text-violet-400" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.2" />
              <circle cx="12" cy="4" r="2" fill="currentColor" opacity="0.8">
                <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="2.5s" repeatCount="indefinite" />
              </circle>
            </svg>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com/smigolsmigol/llmkit"
              className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition"
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
              GitHub
            </a>
            <Link href="/sign-in" className="text-sm text-zinc-400 hover:text-white transition">
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className="rounded-lg bg-white px-4 py-1.5 text-sm font-medium text-black hover:bg-zinc-200 transition"
            >
              Get started
            </Link>
          </div>
        </div>
      </nav>

      {/* hero */}
      <div className="relative overflow-hidden">
        {/* radial gradient spotlight */}
        <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 h-[600px] w-[900px] bg-[radial-gradient(ellipse,_rgba(124,58,237,0.12),_transparent_70%)]" />

        <div className="mx-auto max-w-5xl px-6 pb-12 pt-24 text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-4 py-1.5 text-xs text-zinc-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Open source, MIT licensed
          </div>

          <h1 className="text-5xl font-bold leading-[1.1] tracking-tight sm:text-7xl">
            Know exactly what your
            <br />
            <span className="bg-gradient-to-r from-violet-400 via-purple-400 to-indigo-400 bg-clip-text text-transparent">
              AI agents cost.
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-zinc-400">
            API gateway with cost tracking and budget enforcement.
            Set a limit, and requests get rejected before they hit the provider. Not after.
          </p>

          <div className="mt-10 flex items-center justify-center gap-4">
            <Link
              href="/sign-up"
              className="group relative inline-flex items-center justify-center"
            >
              <div className="absolute -inset-0.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 opacity-60 blur-sm transition group-hover:opacity-100" />
              <div className="relative rounded-xl bg-violet-600 px-8 py-3 text-sm font-medium text-white transition group-hover:bg-violet-500">
                Start tracking free
              </div>
            </Link>
            <a
              href="https://github.com/smigolsmigol/llmkit"
              className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-8 py-3 text-sm font-medium text-zinc-300 hover:bg-white/[0.06] hover:text-white transition"
              target="_blank"
              rel="noopener noreferrer"
            >
              View source
            </a>
          </div>

          <p className="mt-4 text-xs text-zinc-500">No credit card. Unlimited requests during beta.</p>

          {/* code snippet - above the fold */}
          <div className="mx-auto mt-12 max-w-2xl overflow-hidden rounded-xl border border-white/[0.06] bg-[#111] text-left">
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
                <p className="text-zinc-500"># track costs locally (no account needed)</p>
                <p><span className="text-emerald-400">$</span> <span className="text-zinc-300">npx @f3d1/llmkit-mcp-server</span></p>
              </div>
              <div>
                <p className="text-zinc-500"># or wrap any command</p>
                <p><span className="text-emerald-400">$</span> <span className="text-zinc-300">npx @f3d1/llmkit-cli -- python agent.py</span></p>
              </div>
              <div>
                <p className="text-zinc-500"># or one line in Python</p>
                <p><span className="text-violet-400">client</span> <span className="text-zinc-500">=</span> <span className="text-amber-300">OpenAI</span><span className="text-zinc-400">(</span><span className="text-zinc-300">http_client</span><span className="text-zinc-500">=</span><span className="text-amber-300">tracked</span><span className="text-zinc-400">())</span></p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* dashboard demo */}
      <div className="mx-auto max-w-5xl px-6 pb-8">
        <p className="mb-3 text-center text-sm text-zinc-500">
          Real-time dashboard: spend by model, provider, and session
        </p>
        <div className="overflow-hidden rounded-2xl border border-white/[0.06] shadow-2xl shadow-violet-600/5">
          <video
            src="https://github.com/user-attachments/assets/d07dac81-8f18-4920-ae77-62872822d078"
            autoPlay
            loop
            muted
            playsInline
            className="w-full"
          />
        </div>
      </div>

      {/* CLI demo */}
      <div className="mx-auto max-w-5xl px-6 pb-8">
        <p className="mb-3 text-center text-sm text-zinc-500">
          CLI: wrap any command, see cost breakdown when it exits
        </p>
        <div className="overflow-hidden rounded-2xl border border-white/[0.06] shadow-2xl shadow-violet-600/5">
          <video
            src="https://github.com/user-attachments/assets/8ec33732-f651-4e35-9a27-5263c8a87ba7"
            autoPlay
            loop
            muted
            playsInline
            className="w-full"
          />
        </div>
      </div>

      {/* stats bar */}
      <div className="mx-auto max-w-5xl px-6 py-16">
        <div className="grid grid-cols-4 gap-px overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.03]">
          {[
            { value: '14', label: 'MCP tools' },
            { value: '11', label: 'AI providers' },
            { value: '45+', label: 'Models priced' },
            { value: '$0', label: 'During beta' },
          ].map((s) => (
            <div key={s.label} className="p-6 text-center">
              <p className="font-mono text-3xl font-bold bg-gradient-to-b from-white to-zinc-400 bg-clip-text text-transparent">{s.value}</p>
              <p className="mt-1 text-xs text-zinc-500">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* features */}
      <div className="mx-auto max-w-5xl px-6 py-16">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight">What makes it different</h2>
          <p className="mt-3 text-zinc-400">Not another observability dashboard. Budget enforcement that prevents overspend at request time.</p>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {[
            {
              icon: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/></svg>,
              title: 'Budget enforcement',
              desc: 'Reservation pattern: cost is estimated and reserved before the request. Budget exceeded? Request rejected. Not logged after the fact.',
            },
            {
              icon: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>,
              title: 'Local cost tracking',
              desc: 'MCP server reads your Claude Code, Cline, and Cursor session data locally. No account, no data leaves your machine.',
            },
            {
              icon: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>,
              title: 'Every provider, one view',
              desc: 'Anthropic, OpenAI, Google, Groq, xAI, DeepSeek, Mistral, Fireworks, Together, Ollama, OpenRouter. Cache-aware pricing.',
            },
            {
              icon: <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>,
              title: 'Zero-code CLI',
              desc: 'Wrap any command. The CLI intercepts API calls, forwards through the proxy, prints a cost summary when the process exits.',
            },
          ].map((f) => (
            <div key={f.title} className="group relative">
              <div className="absolute -inset-px rounded-2xl bg-gradient-to-b from-white/[0.08] to-transparent opacity-0 transition duration-500 group-hover:opacity-100" />
              <div className="relative rounded-2xl border border-white/[0.06] bg-white/[0.02] p-7">
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 text-violet-400">
                  {f.icon}
                </div>
                <h3 className="font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="mx-auto max-w-5xl px-6 py-16">
        <div className="relative overflow-hidden rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/[0.08] to-indigo-500/[0.04] p-16 text-center">
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[300px] w-[500px] bg-[radial-gradient(ellipse,_rgba(124,58,237,0.15),_transparent_70%)]" />
          <div className="relative">
            <h2 className="text-3xl font-bold tracking-tight">Free while in beta</h2>
            <p className="mt-3 text-zinc-400">
              Unlimited requests. All 11 providers. Budget enforcement. No credit card.
            </p>
            <Link
              href="/sign-up"
              className="mt-8 inline-block rounded-xl bg-white px-10 py-3.5 text-sm font-semibold text-black hover:bg-zinc-200 transition"
            >
              Create free account
            </Link>
          </div>
        </div>
      </div>

      {/* footer */}
      <div className="mx-auto max-w-5xl border-t border-white/[0.06] px-6 pb-12 pt-8 text-center text-xs text-zinc-500">
        <p>
          MIT licensed. Built with{' '}
          <a href="https://claude.ai/claude-code" className="text-zinc-400 underline hover:text-white transition" target="_blank" rel="noopener noreferrer">Claude Code</a>
          .{' '}
          <a href="https://github.com/smigolsmigol/llmkit" className="text-zinc-400 underline hover:text-white transition" target="_blank" rel="noopener noreferrer">
            Source on GitHub
          </a>
        </p>
      </div>
    </div>
  );
}
