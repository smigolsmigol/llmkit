import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const { userId } = await auth();
  if (userId) redirect('/dashboard');

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* nav */}
      <nav className="border-b border-border/40 bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600 text-xs font-bold text-white">LK</div>
            <span className="font-semibold">LLMKit</span>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="https://github.com/smigolsmigol/llmkit"
              className="text-sm text-muted-foreground hover:text-foreground"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
            <Link href="/sign-in" className="text-sm text-muted-foreground hover:text-foreground">
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
            >
              Get started free
            </Link>
          </div>
        </div>
      </nav>

      {/* hero */}
      <div className="mx-auto max-w-5xl px-6">
        <div className="pb-8 pt-20 text-center">
          <div className="mb-4 inline-flex items-center rounded-full border border-violet-500/20 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-400">
            Open source, MIT licensed
          </div>
          <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
            Know exactly what your
            <br />
            <span className="text-violet-400">AI agents cost.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            API gateway with cost tracking and budget enforcement that actually works.
            Per-request logging across 11 providers. Budget limits that reject requests
            before they hit the provider.
          </p>
          <div className="mt-10 flex items-center justify-center gap-4">
            <Link
              href="/sign-up"
              className="rounded-lg bg-violet-600 px-8 py-3 text-sm font-medium text-white shadow-lg shadow-violet-600/20 hover:bg-violet-500"
            >
              Start tracking free
            </Link>
            <a
              href="https://github.com/smigolsmigol/llmkit"
              className="rounded-lg border border-border px-8 py-3 text-sm font-medium hover:bg-accent"
              target="_blank"
              rel="noopener noreferrer"
            >
              View source
            </a>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            No credit card. Unlimited requests during beta.
          </p>
        </div>

        {/* dashboard demo */}
        <div className="mt-8">
          <p className="mb-3 text-center text-sm font-medium text-muted-foreground">
            Real-time dashboard: spend by model, provider, and session
          </p>
          <div className="overflow-hidden rounded-2xl border border-border/60 shadow-2xl shadow-violet-600/5">
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
        <div className="mt-12">
          <p className="mb-3 text-center text-sm font-medium text-muted-foreground">
            CLI: wrap any command, see cost breakdown when it exits
          </p>
          <div className="overflow-hidden rounded-2xl border border-border/60 shadow-2xl shadow-violet-600/5">
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
        <div className="mt-20 grid grid-cols-4 gap-4 rounded-xl border border-border/60 bg-card/50 p-6">
          <div className="text-center">
            <p className="font-mono text-2xl font-bold text-violet-400">14</p>
            <p className="mt-1 text-xs text-muted-foreground">MCP tools</p>
          </div>
          <div className="text-center">
            <p className="font-mono text-2xl font-bold text-violet-400">11</p>
            <p className="mt-1 text-xs text-muted-foreground">AI providers</p>
          </div>
          <div className="text-center">
            <p className="font-mono text-2xl font-bold text-violet-400">45+</p>
            <p className="mt-1 text-xs text-muted-foreground">Models priced</p>
          </div>
          <div className="text-center">
            <p className="font-mono text-2xl font-bold text-violet-400">$0</p>
            <p className="mt-1 text-xs text-muted-foreground">During beta</p>
          </div>
        </div>

        {/* features */}
        <div className="mt-20">
          <h2 className="text-center text-2xl font-bold">What makes it different</h2>
          <p className="mx-auto mt-2 max-w-lg text-center text-sm text-muted-foreground">
            Not another observability dashboard. Budget enforcement that prevents overspend at request time.
          </p>
          <div className="mt-10 grid gap-6 sm:grid-cols-2">
            <div className="rounded-xl border border-border/60 bg-card/50 p-6">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-violet-600/10 text-violet-400">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/></svg>
              </div>
              <h3 className="font-semibold">Budget enforcement</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Reservation pattern: cost is estimated and reserved before the request reaches the provider.
                Budget exceeded? Request rejected. Not logged after the fact.
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-card/50 p-6">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-violet-600/10 text-violet-400">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 7h10"/><path d="M7 12h10"/><path d="M7 17h10"/></svg>
              </div>
              <h3 className="font-semibold">Local cost tracking</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                MCP server reads your Claude Code, Cline, and Cursor session data locally.
                No API key, no account, no data leaves your machine.
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-card/50 p-6">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-violet-600/10 text-violet-400">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/></svg>
              </div>
              <h3 className="font-semibold">Every provider, one view</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Anthropic, OpenAI, Google, Groq, xAI, DeepSeek, Mistral, Fireworks, Together, Ollama, OpenRouter.
                Cache-aware pricing included.
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-card/50 p-6">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-violet-600/10 text-violet-400">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>
              </div>
              <h3 className="font-semibold">Zero-code CLI</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Wrap any command. The CLI intercepts API calls, forwards through the proxy,
                and prints a cost summary when the process exits. Any language.
              </p>
            </div>
          </div>
        </div>

        {/* quick start */}
        <div className="mt-20">
          <h2 className="text-center text-2xl font-bold">Try it in 30 seconds</h2>
          <div className="mx-auto mt-8 max-w-2xl space-y-3">
            <div className="rounded-xl border border-border/60 bg-card/50 p-5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-violet-400">MCP Server</p>
                <span className="rounded-full bg-violet-600/10 px-2 py-0.5 text-[10px] text-violet-400">Claude Code / Cline / Cursor</span>
              </div>
              <code className="mt-2 block font-mono text-sm">npx @f3d1/llmkit-mcp-server</code>
            </div>
            <div className="rounded-xl border border-border/60 bg-card/50 p-5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-violet-400">CLI</p>
                <span className="rounded-full bg-violet-600/10 px-2 py-0.5 text-[10px] text-violet-400">any language</span>
              </div>
              <code className="mt-2 block font-mono text-sm">npx @f3d1/llmkit-cli -- python my_agent.py</code>
            </div>
            <div className="rounded-xl border border-border/60 bg-card/50 p-5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-violet-400">Python SDK</p>
                <span className="rounded-full bg-violet-600/10 px-2 py-0.5 text-[10px] text-violet-400">one line</span>
              </div>
              <code className="mt-2 block font-mono text-sm">client = OpenAI(http_client=tracked())</code>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="mt-24 rounded-2xl border border-violet-500/20 bg-violet-500/5 p-12 text-center">
          <h2 className="text-3xl font-bold">Free while in beta</h2>
          <p className="mt-3 text-muted-foreground">
            Unlimited requests. All 11 providers. Budget enforcement. No credit card required.
          </p>
          <Link
            href="/sign-up"
            className="mt-8 inline-block rounded-lg bg-violet-600 px-10 py-3.5 text-sm font-medium text-white shadow-lg shadow-violet-600/20 hover:bg-violet-500"
          >
            Create free account
          </Link>
        </div>

        {/* footer */}
        <div className="mt-16 border-t border-border/40 pb-12 pt-8 text-center text-xs text-muted-foreground">
          <p>
            MIT licensed. Built with{' '}
            <a href="https://claude.ai/claude-code" className="underline hover:text-foreground" target="_blank" rel="noopener noreferrer">Claude Code</a>
            .{' '}
            <a href="https://github.com/smigolsmigol/llmkit" className="underline hover:text-foreground" target="_blank" rel="noopener noreferrer">
              Source on GitHub
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
