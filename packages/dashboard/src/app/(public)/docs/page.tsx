
import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicPageHero } from '@/components/public/public-page-hero';
import { PublicShell } from '@/components/public/public-shell';
import { RECOVERY_STATUS_HREF } from '@/lib/public-recovery';

export const metadata: Metadata = {
  title: 'Getting Started - LLMKit',
  description: 'Choose a verified LLMKit surface: local MCP tools, Python response tracking, CLI interception, or the existing-key gateway client.',
  openGraph: {
    title: 'LLMKit - Getting Started',
    description: 'Local cost evidence first, gateway enforcement when the authenticated boundary is available.',
    url: 'https://llmkit.sh/docs',
  },
};

function CodeBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="public-panel overflow-hidden rounded-xl">
      <div className="border-b border-white/[0.06] px-4 py-2.5">
        <span className="text-xs text-zinc-400">{title}</span>
      </div>
      <div className="overflow-x-auto p-5 font-mono text-sm">{children}</div>
    </div>
  );
}

export default function DocsPage() {
  return (
    <PublicShell>
      <PublicPageHero
        eyebrow="Docs / local first"
        title="Start with one surface, not a platform migration."
        description="Run the local tools in seconds. Add application instrumentation or gateway enforcement only when the ownership boundary calls for it."
        aside={(
          <div className="public-panel-soft rounded-xl p-4 font-mono text-[10px] leading-5 text-zinc-400">
            <p className="text-emerald-300">available now</p>
            <p className="mt-1">MCP / CLI / Python tracker</p>
            <p>no hosted account required</p>
          </div>
        )}
      />

      <div className="mx-auto max-w-4xl space-y-14 px-6 pb-16">

        {/* MCP Server */}
        <section id="local-setup" className="scroll-mt-24 border-t border-white/[0.07] pt-8">
          <div className="mb-2 flex items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/10 font-mono text-sm font-bold text-violet-400">1</span>
            <h2 className="text-lg font-semibold">MCP Server</h2>
          </div>
          <p className="mb-4 text-sm text-zinc-400">
            Inspect supported Claude Code sessions and Cline task data. Cline data can be discovered in VS Code, Cursor, Windsurf, and remote server storage.
          </p>
          <CodeBlock title="install + run">
            <p><span className="text-emerald-400">$</span> <span className="text-zinc-300">npx @f3d1/llmkit-mcp-server</span></p>
          </CodeBlock>
          <div className="mt-4">
            <CodeBlock title="add to your MCP config">
              <pre className="overflow-x-auto text-xs text-zinc-300">{`{
  "mcpServers": {
    "llmkit": {
      "command": "npx",
      "args": ["-y", "@f3d1/llmkit-mcp-server"]
    }
  }
}`}</pre>
            </CodeBlock>
          </div>
          <p className="mt-3 text-xs text-zinc-400">
            That's it. Ask your AI assistant "how much did this session cost?" and it'll use the local tools.
            <Link href="/mcp" className="ml-1 text-violet-400 hover:text-violet-300 transition">See all 11 tools {'->'}</Link>
          </p>
        </section>

        {/* Python SDK */}
        <section className="border-t border-white/[0.07] pt-8">
          <div className="mb-2 flex items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/10 font-mono text-sm font-bold text-cyan-400">2</span>
            <h2 className="text-lg font-semibold">Python SDK</h2>
          </div>
          <p className="mb-4 text-sm text-zinc-400">
            Add an httpx transport hook to estimate cost from supported OpenAI- and Anthropic-style chat responses. No LLMKit account or proxy is required.
          </p>
          <CodeBlock title="install">
            <p><span className="text-emerald-400">$</span> <span className="text-zinc-300">pip install llmkit-sdk</span></p>
          </CodeBlock>
          <div className="mt-4">
            <CodeBlock title="usage">
              <div className="space-y-1 text-zinc-300">
                <p><span className="text-violet-400">from</span> openai <span className="text-violet-400">import</span> OpenAI</p>
                <p><span className="text-violet-400">from</span> llmkit <span className="text-violet-400">import</span> tracked</p>
                <p className="text-zinc-400">&nbsp;</p>
                <p><span className="text-zinc-400">client</span> = <span className="text-amber-300">OpenAI</span>(http_client=<span className="text-amber-300">tracked</span>())</p>
                <p className="text-zinc-400">&nbsp;</p>
                <p><span className="text-zinc-400"># use client normally. costs tracked automatically.</span></p>
                <p><span className="text-zinc-400">res</span> = client.chat.completions.<span className="text-amber-300">create</span>(</p>
                <p>    model=<span className="text-emerald-400">&quot;gpt-4o&quot;</span>,</p>
                <p>    messages=[{'{'}  <span className="text-emerald-400">&quot;role&quot;</span>: <span className="text-emerald-400">&quot;user&quot;</span>, <span className="text-emerald-400">&quot;content&quot;</span>: <span className="text-emerald-400">&quot;hello&quot;</span> {'}'}]</p>
                <p>)</p>
              </div>
            </CodeBlock>
          </div>
          <p className="mt-3 text-xs text-zinc-400">
            Use this path only with clients that accept an httpx client. Estimates use the bundled pricing snapshot and the usage fields returned by the provider.
          </p>
        </section>

        {/* TypeScript */}
        <section className="border-t border-white/[0.07] pt-8">
          <div className="mb-2 flex items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10 font-mono text-sm font-bold text-blue-400">3</span>
            <h2 className="text-lg font-semibold">TypeScript gateway SDK</h2>
          </div>
          <p className="mb-4 text-sm text-zinc-400">
            Typed sessions, cost metadata, and streaming through the hosted gateway. This path requires an existing LLMKit API key while new account creation is closed.
          </p>
          <CodeBlock title="install">
            <p><span className="text-emerald-400">$</span> <span className="text-zinc-300">npm install @f3d1/llmkit-sdk</span></p>
          </CodeBlock>
          <div className="mt-4">
            <CodeBlock title="usage">
              <div className="space-y-1 text-zinc-300">
                <p><span className="text-violet-400">import</span> {'{'} LLMKit {'}'} <span className="text-violet-400">from</span> <span className="text-emerald-400">&apos;@f3d1/llmkit-sdk&apos;</span></p>
                <p className="text-zinc-400">&nbsp;</p>
                <p><span className="text-violet-400">const</span> kit = <span className="text-violet-400">new</span> <span className="text-amber-300">LLMKit</span>({'{'} apiKey: process.env.LLMKIT_API_KEY! {'}'})</p>
                <p><span className="text-violet-400">const</span> res = <span className="text-violet-400">await</span> kit.<span className="text-amber-300">chat</span>({'{'}</p>
                <p>  provider: <span className="text-emerald-400">&apos;openai&apos;</span>,</p>
                <p>  model: <span className="text-emerald-400">&apos;gpt-4o&apos;</span>,</p>
                <p>  messages: [{'{'} role: <span className="text-emerald-400">&apos;user&apos;</span>, content: <span className="text-emerald-400">&apos;hello&apos;</span> {'}'}]</p>
                <p>{'}'})</p>
                <p className="text-zinc-400">&nbsp;</p>
                <p>console.<span className="text-amber-300">log</span>(res.content, res.cost)</p>
              </div>
            </CodeBlock>
          </div>
        </section>

        {/* CLI */}
        <section className="border-t border-white/[0.07] pt-8">
          <div className="mb-2 flex items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/10 font-mono text-sm font-bold text-amber-400">4</span>
            <h2 className="text-lg font-semibold">CLI</h2>
          </div>
          <p className="mb-4 text-sm text-zinc-400">
            Wrap a command that uses an OpenAI or Anthropic client honoring the standard base-URL environment variable. The CLI runs a local proxy and prints a cost summary on exit.
          </p>
          <CodeBlock title="wrap a command">
            <p><span className="text-emerald-400">$</span> <span className="text-zinc-300">npx @f3d1/llmkit-cli -- python my_agent.py</span></p>
          </CodeBlock>
          <div className="mt-4">
            <CodeBlock title="illustrative output shape">
              <div className="text-xs text-zinc-400">
                <p className="text-violet-400 font-bold">    LLMKIT</p>
                <p>&nbsp;</p>
                <p>    <span className="text-white font-bold">$0.0847</span> <span className="text-zinc-400">total</span>  12 requests  <span className="text-zinc-400">34.2s</span>  <span className="text-zinc-400">~$8.96/hr</span></p>
                <p>&nbsp;</p>
                <p>    <span className="text-zinc-400">claude-sonnet-4-20250514</span>  8 reqs   $0.0623  <span className="text-violet-400">================</span><span className="text-zinc-500">----</span></p>
                <p>    <span className="text-zinc-400">gpt-4o-mini</span>              4 reqs   $0.0224  <span className="text-cyan-400">======</span><span className="text-zinc-500">--------------</span></p>
              </div>
            </CodeBlock>
          </div>
          <p className="mt-3 text-xs text-zinc-400">
            The command is unchanged, but coverage is protocol-specific. Calls that bypass OPENAI_BASE_URL or ANTHROPIC_BASE_URL are not observed.
          </p>
        </section>

        {/* Hosted API Gateway */}
        <section className="border-t border-white/[0.07] pt-8">
          <h2 className="mb-2 text-lg font-semibold">Hosted API gateway</h2>
          <p className="mb-4 text-sm text-zinc-400">
            Hosted account creation and API-key management are temporarily unavailable while the authenticated service is restored.
          </p>
          <div className="space-y-4">
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-5">
              <p className="text-sm font-medium text-zinc-200">Available now</p>
              <p className="mt-1 text-xs text-zinc-400">
                The MCP local tools, CLI, and Python tracked() path above remain available without an LLMKit account.
              </p>
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-5">
              <p className="text-sm font-medium text-zinc-200">Hosted path</p>
              <p className="mt-1 text-xs text-zinc-400">
                <Link href={RECOVERY_STATUS_HREF} className="text-violet-400 hover:text-violet-300 transition">
                  Check the service status
                </Link>{' '}
                before attempting dashboard or gateway setup.
              </p>
            </div>
          </div>
        </section>

        {/* links */}
        <section className="border-t border-white/[0.07] pt-8">
          <h2 className="mb-4 text-lg font-semibold">Resources</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { label: 'GitHub repo', href: 'https://github.com/smigolsmigol/llmkit', ext: true },
              { label: 'MCP Server (npm)', href: 'https://www.npmjs.com/package/@f3d1/llmkit-mcp-server', ext: true },
              { label: 'Python SDK (PyPI)', href: 'https://pypi.org/project/llmkit-sdk/', ext: true },
              { label: 'TypeScript SDK (npm)', href: 'https://www.npmjs.com/package/@f3d1/llmkit-sdk', ext: true },
              { label: 'CLI (npm)', href: 'https://www.npmjs.com/package/@f3d1/llmkit-cli', ext: true },
              { label: 'Vercel AI SDK Provider', href: 'https://www.npmjs.com/package/@f3d1/llmkit-ai-sdk-provider', ext: true },
            ].map((r) => (
              <a
                key={r.label}
                href={r.href}
                className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm text-zinc-300 transition hover:bg-white/[0.04] hover:text-white"
                target="_blank"
                rel="noopener noreferrer"
              >
                {r.label} <span className="text-zinc-400">{'\u2197'}</span>
              </a>
            ))}
          </div>
        </section>
      </div>

    </PublicShell>
  );
}
