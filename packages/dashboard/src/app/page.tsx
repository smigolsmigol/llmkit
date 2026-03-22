import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const { userId } = await auth();
  if (userId) redirect('/dashboard');

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-6 py-16">
        {/* header */}
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Know exactly what your AI agents cost.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Open-source API gateway with cost tracking and budget enforcement.
            Per-request logging, per-key budgets, 11 providers.
            Free while in beta.
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Link
              href="/sign-up"
              className="rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Get started free
            </Link>
            <a
              href="https://github.com/smigolsmigol/llmkit"
              className="rounded-lg border border-border px-6 py-3 text-sm font-medium hover:bg-accent"
              target="_blank"
              rel="noopener noreferrer"
            >
              View on GitHub
            </a>
          </div>
        </div>

        {/* demos */}
        <div className="mt-16 space-y-10">
          <div>
            <p className="mb-3 text-center text-sm font-medium text-muted-foreground">Dashboard: cost breakdown by model, provider, and session</p>
            <div className="overflow-hidden rounded-xl border border-border shadow-2xl">
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
          <div>
            <p className="mb-3 text-center text-sm font-medium text-muted-foreground">CLI: wrap any command, get a cost summary when it exits</p>
            <div className="overflow-hidden rounded-xl border border-border shadow-2xl">
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
        </div>

        {/* features */}
        <div className="mt-20 grid gap-8 sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-card p-6">
            <h3 className="font-semibold">Budget enforcement</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Reservation pattern: estimated cost is reserved before the request, settled after.
              Your agents can't spend money you haven't approved.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-6">
            <h3 className="font-semibold">14 MCP tools</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Works inside Claude Code, Cline, and Cursor. Local cost tracking with no API key.
              Notion sync for team visibility.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-6">
            <h3 className="font-semibold">Every provider, one dashboard</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Anthropic, OpenAI, Google, Groq, xAI, DeepSeek, Mistral, and more.
              Cost breakdown by model, provider, session, and end user.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-6">
            <h3 className="font-semibold">Zero-code CLI</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Wrap any command: npx @f3d1/llmkit-cli -- python my_agent.py.
              Prints a cost summary when it exits. Works with any language.
            </p>
          </div>
        </div>

        {/* quick start */}
        <div className="mt-20">
          <h2 className="text-center text-2xl font-bold">Try it in 30 seconds</h2>
          <div className="mx-auto mt-8 max-w-2xl space-y-4">
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="mb-2 text-xs font-medium text-muted-foreground">MCP Server (Claude Code / Cline / Cursor)</p>
              <code className="text-sm">npx @f3d1/llmkit-mcp-server</code>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="mb-2 text-xs font-medium text-muted-foreground">CLI (wrap any command)</p>
              <code className="text-sm">npx @f3d1/llmkit-cli -- python my_agent.py</code>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Python SDK (one line)</p>
              <code className="text-sm">client = OpenAI(http_client=tracked())</code>
            </div>
          </div>
        </div>

        {/* pricing */}
        <div className="mt-20 text-center">
          <h2 className="text-2xl font-bold">Free while in beta</h2>
          <p className="mt-2 text-muted-foreground">
            Unlimited requests. All providers. Budget enforcement. No credit card.
          </p>
          <Link
            href="/sign-up"
            className="mt-6 inline-block rounded-lg bg-primary px-8 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Create free account
          </Link>
        </div>

        {/* footer */}
        <div className="mt-20 border-t border-border pt-8 text-center text-xs text-muted-foreground">
          <p>
            MIT licensed.{' '}
            <a href="https://github.com/smigolsmigol/llmkit" className="underline hover:text-foreground" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
