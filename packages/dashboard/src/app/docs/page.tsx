import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicNav } from '@/components/public-nav';
import { PublicFooter } from '@/components/public-footer';

export const metadata: Metadata = {
  title: 'Getting Started - LLMKit',
  description: 'Three ways to track AI costs: MCP server for Claude Code/Cursor/Cline, Python SDK, or CLI. Get running in 30 seconds.',
  openGraph: {
    title: 'LLMKit - Getting Started',
    description: 'Track AI costs in 30 seconds. MCP server, Python SDK, or CLI.',
    url: 'https://llmkit-dashboard.vercel.app/docs',
  },
};

function CodeBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-[#111]">
      <div className="border-b border-white/[0.06] px-4 py-2.5">
        <span className="text-xs text-zinc-500">{title}</span>
      </div>
      <div className="p-5 font-mono text-sm">{children}</div>
    </div>
  );
}

export default function DocsPage() {
  return (
    <div className="relative min-h-screen bg-[#0a0a0a] text-white selection:bg-violet-500/30">
      <div
        className="pointer-events-none fixed inset-0 z-50 opacity-[0.02]"
        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")` }}
      />

      <PublicNav />

      <div className="relative">
        <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 h-[400px] w-[700px] bg-[radial-gradient(ellipse,_rgba(34,211,238,0.06),_transparent_70%)]" />
        <div className="relative mx-auto max-w-3xl px-6 pt-16 pb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Getting Started</h1>
          <p className="mx-auto mt-4 max-w-lg text-base leading-relaxed text-zinc-400">
            Three ways to track costs. Pick what fits your workflow.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-3xl space-y-16 px-6 pb-16">

        {/* MCP Server */}
        <section>
          <div className="mb-2 flex items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/10 font-mono text-sm font-bold text-violet-400">1</span>
            <h2 className="text-lg font-semibold">MCP Server</h2>
          </div>
          <p className="mb-4 text-sm text-zinc-400">
            Cost tracking inside Claude Code, Cursor, or Cline. Local tools work without an account.
          </p>
          <CodeBlock title="install + run">
            <p><span className="text-emerald-400">$</span> <span className="text-zinc-300">npx @f3d1/llmkit-mcp-server</span></p>
          </CodeBlock>
          <div className="mt-4">
            <CodeBlock title="add to your MCP config">
              <pre className="text-xs text-zinc-300">{`{
  "mcpServers": {
    "llmkit": {
      "command": "npx",
      "args": ["@f3d1/llmkit-mcp-server"]
    }
  }
}`}</pre>
            </CodeBlock>
          </div>
          <p className="mt-3 text-xs text-zinc-500">
            That's it. Ask your AI assistant "how much did this session cost?" and it'll use the local tools.
            <Link href="/mcp" className="ml-1 text-violet-400 hover:text-violet-300 transition">See all 11 tools {'->'}</Link>
          </p>
        </section>

        {/* Python SDK */}
        <section>
          <div className="mb-2 flex items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/10 font-mono text-sm font-bold text-cyan-400">2</span>
            <h2 className="text-lg font-semibold">Python SDK</h2>
          </div>
          <p className="mb-4 text-sm text-zinc-400">
            One-line integration. Wraps any OpenAI-compatible SDK via httpx transport hooks. Zero migration.
          </p>
          <CodeBlock title="install">
            <p><span className="text-emerald-400">$</span> <span className="text-zinc-300">pip install llmkit-sdk</span></p>
          </CodeBlock>
          <div className="mt-4">
            <CodeBlock title="usage">
              <div className="space-y-1 text-zinc-300">
                <p><span className="text-violet-400">from</span> openai <span className="text-violet-400">import</span> OpenAI</p>
                <p><span className="text-violet-400">from</span> llmkit <span className="text-violet-400">import</span> tracked</p>
                <p className="text-zinc-600">&nbsp;</p>
                <p><span className="text-zinc-400">client</span> = <span className="text-amber-300">OpenAI</span>(http_client=<span className="text-amber-300">tracked</span>())</p>
                <p className="text-zinc-600">&nbsp;</p>
                <p><span className="text-zinc-500"># use client normally. costs tracked automatically.</span></p>
                <p><span className="text-zinc-400">res</span> = client.chat.completions.<span className="text-amber-300">create</span>(</p>
                <p>    model=<span className="text-emerald-400">&quot;gpt-4o&quot;</span>,</p>
                <p>    messages=[{'{'}  <span className="text-emerald-400">&quot;role&quot;</span>: <span className="text-emerald-400">&quot;user&quot;</span>, <span className="text-emerald-400">&quot;content&quot;</span>: <span className="text-emerald-400">&quot;hello&quot;</span> {'}'}]</p>
                <p>)</p>
              </div>
            </CodeBlock>
          </div>
          <p className="mt-3 text-xs text-zinc-500">
            Works with OpenAI, Anthropic, Gemini, xAI, DeepSeek, Groq, Together, Fireworks, Mistral. Any SDK that accepts http_client.
          </p>
        </section>

        {/* TypeScript */}
        <section>
          <div className="mb-2 flex items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10 font-mono text-sm font-bold text-blue-400">3</span>
            <h2 className="text-lg font-semibold">TypeScript SDK</h2>
          </div>
          <p className="mb-4 text-sm text-zinc-400">
            Full client with sessions, cost tracking, and streaming. Also available as a Vercel AI SDK provider.
          </p>
          <CodeBlock title="install">
            <p><span className="text-emerald-400">$</span> <span className="text-zinc-300">npm install @f3d1/llmkit-sdk</span></p>
          </CodeBlock>
          <div className="mt-4">
            <CodeBlock title="usage">
              <div className="space-y-1 text-zinc-300">
                <p><span className="text-violet-400">import</span> {'{'} LLMKit {'}'} <span className="text-violet-400">from</span> <span className="text-emerald-400">&apos;@f3d1/llmkit-sdk&apos;</span></p>
                <p className="text-zinc-600">&nbsp;</p>
                <p><span className="text-violet-400">const</span> kit = <span className="text-violet-400">new</span> <span className="text-amber-300">LLMKit</span>({'{'} apiKey: process.env.LLMKIT_KEY {'}'})</p>
                <p><span className="text-violet-400">const</span> res = <span className="text-violet-400">await</span> kit.<span className="text-amber-300">chat</span>({'{'}</p>
                <p>  provider: <span className="text-emerald-400">&apos;openai&apos;</span>,</p>
                <p>  model: <span className="text-emerald-400">&apos;gpt-4o&apos;</span>,</p>
                <p>  messages: [{'{'} role: <span className="text-emerald-400">&apos;user&apos;</span>, content: <span className="text-emerald-400">&apos;hello&apos;</span> {'}'}]</p>
                <p>{'}'})</p>
                <p className="text-zinc-600">&nbsp;</p>
                <p>console.<span className="text-amber-300">log</span>(res.content, res.cost)</p>
              </div>
            </CodeBlock>
          </div>
        </section>

        {/* CLI */}
        <section>
          <div className="mb-2 flex items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/10 font-mono text-sm font-bold text-amber-400">4</span>
            <h2 className="text-lg font-semibold">CLI</h2>
          </div>
          <p className="mb-4 text-sm text-zinc-400">
            Wrap any command. The CLI intercepts API calls, prints a cost summary when the process exits. Zero code changes.
          </p>
          <CodeBlock title="wrap a command">
            <p><span className="text-emerald-400">$</span> <span className="text-zinc-300">npx @f3d1/llmkit-cli -- python my_agent.py</span></p>
          </CodeBlock>
          <div className="mt-4">
            <CodeBlock title="output">
              <div className="text-xs text-zinc-400">
                <p className="text-violet-400 font-bold">    LLMKIT</p>
                <p>&nbsp;</p>
                <p>    <span className="text-white font-bold">$0.0847</span> <span className="text-zinc-600">total</span>  12 requests  <span className="text-zinc-600">34.2s</span>  <span className="text-zinc-600">~$8.96/hr</span></p>
                <p>&nbsp;</p>
                <p>    <span className="text-zinc-600">claude-sonnet-4-20250514</span>  8 reqs   $0.0623  <span className="text-violet-400">████████████████</span><span className="text-zinc-700">░░░░</span></p>
                <p>    <span className="text-zinc-600">gpt-4o-mini</span>              4 reqs   $0.0224  <span className="text-cyan-400">██████</span><span className="text-zinc-700">░░░░░░░░░░░░░░</span></p>
              </div>
            </CodeBlock>
          </div>
        </section>

        {/* API Gateway */}
        <section>
          <h2 className="mb-2 text-lg font-semibold">API Gateway (optional)</h2>
          <p className="mb-4 text-sm text-zinc-400">
            For budget enforcement and centralized logging. Create an account, get an API key, and route requests through the proxy.
          </p>
          <div className="space-y-4">
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-5">
              <p className="text-sm font-medium text-zinc-200">1. Create an account</p>
              <p className="mt-1 text-xs text-zinc-500">
                <Link href="/sign-up" className="text-violet-400 hover:text-violet-300 transition">Sign up free</Link> and get an API key from the dashboard.
              </p>
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-5">
              <p className="text-sm font-medium text-zinc-200">2. Set your provider keys</p>
              <p className="mt-1 text-xs text-zinc-500">
                Add your Anthropic, OpenAI, or other provider API keys in Settings. Encrypted with AES-GCM.
              </p>
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-5">
              <p className="text-sm font-medium text-zinc-200">3. Configure budgets</p>
              <p className="mt-1 text-xs text-zinc-500">
                Set per-key limits (daily, weekly, monthly). Budget enforcement uses a reservation pattern: cost is estimated before the request, rejected if over limit.
              </p>
            </div>
          </div>
        </section>

        {/* links */}
        <section>
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
                {r.label} <span className="text-zinc-600">{'\u2197'}</span>
              </a>
            ))}
          </div>
        </section>
      </div>

      <PublicFooter />
    </div>
  );
}
