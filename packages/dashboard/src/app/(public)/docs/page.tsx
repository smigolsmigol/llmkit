import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicPageHero } from '@/components/public/public-page-hero';
import { PublicShell } from '@/components/public/public-shell';
import { RECOVERY_STATUS_HREF } from '@/lib/public-recovery';

export const metadata: Metadata = {
  title: 'Quickstart - LLMKit',
  description: 'Choose the narrowest LLMKit surface that can see your run: local MCP tools, a CLI wrapper, Python response tracking, or the existing-key gateway.',
  openGraph: {
    title: 'LLMKit - Quickstart',
    description: 'Measure one run locally before changing your application or routing provider traffic.',
    url: 'https://llmkit.sh/docs',
  },
};

const pathCards = [
  {
    id: 'mcp',
    label: 'MCP',
    title: 'Ask your coding agent what this session cost.',
    detail: 'Reads supported Claude Code sessions and Cline task data from local storage.',
    fit: 'Fastest path',
  },
  {
    id: 'cli',
    label: 'CLI',
    title: 'Measure a command without editing the app.',
    detail: 'Runs a local proxy around clients that honor standard provider base URLs.',
    fit: 'No code change',
  },
  {
    id: 'python',
    label: 'Python',
    title: 'Keep estimates beside application responses.',
    detail: 'Adds an httpx transport hook and reads usage returned by the provider.',
    fit: 'In-process',
  },
] as const;

const navItems = [
  { href: '#choose', label: 'Choose a path' },
  { href: '#local-setup', label: 'MCP' },
  { href: '#cli', label: 'CLI' },
  { href: '#python', label: 'Python' },
  { href: '#boundaries', label: 'Compare paths' },
  { href: '#hosted-gateway', label: 'Hosted gateway' },
  { href: '#resources', label: 'Resources' },
] as const;

const comparisonRows = [
  {
    surface: 'MCP',
    evidence: 'Supported local session data',
    account: 'No',
    boundary: 'Supported agent storage',
  },
  {
    surface: 'CLI',
    evidence: 'Requests through the local proxy',
    account: 'No',
    boundary: 'Standard base-URL support',
  },
  {
    surface: 'Python',
    evidence: 'Usage returned by the provider',
    account: 'No',
    boundary: 'Custom httpx client support',
  },
  {
    surface: 'Gateway',
    evidence: 'Hosted proxied requests',
    account: 'Existing key',
    boundary: 'Hosted service availability',
  },
] as const;

function Snippet({ label, code, prompt = false }: { label: string; code: string; prompt?: boolean }) {
  return (
    <div className="public-panel overflow-hidden rounded-xl">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400">{label}</span>
        <span className="font-mono text-[10px] text-zinc-500">plain text</span>
      </div>
      <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-6 text-zinc-300">
        <code>{prompt ? <><span className="text-emerald-400">$ </span>{code}</> : code}</code>
      </pre>
    </div>
  );
}

function SectionHeader({
  index,
  label,
  title,
  description,
}: {
  index: string;
  label: string;
  title: string;
  description: string;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-[150px_minmax(0,1fr)]">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-violet-300">{index} / {label}</p>
      <div>
        <h2 className="text-2xl font-semibold tracking-[-0.025em] text-white sm:text-3xl">{title}</h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">{description}</p>
      </div>
    </div>
  );
}

export default function DocsPage() {
  return (
    <PublicShell>
      <PublicPageHero
        eyebrow="Docs / quickstart"
        title="Measure one run before you change your stack."
        description="Choose the narrowest surface that can see the request. Start local, keep provider credentials on your machine, and move to gateway enforcement only when you need a shared boundary."
        aside={(
          <div className="public-panel-soft divide-y divide-white/[0.06] overflow-hidden rounded-xl text-xs">
            <div className="flex items-center justify-between gap-6 px-4 py-3">
              <span className="text-zinc-400">Local tools</span>
              <span className="font-mono text-emerald-300">available</span>
            </div>
            <div className="flex items-center justify-between gap-6 px-4 py-3">
              <span className="text-zinc-400">Account</span>
              <span className="font-mono text-zinc-300">not required</span>
            </div>
            <div className="flex items-center justify-between gap-6 px-4 py-3">
              <span className="text-zinc-400">Hosted gateway</span>
              <span className="font-mono text-amber-300">existing keys</span>
            </div>
          </div>
        )}
      />

      <div className="mx-auto max-w-6xl px-6 pb-24">
        <section id="choose" className="scroll-mt-24 border-y border-white/[0.07] py-8">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="public-kicker">Choose by outcome</p>
              <h2 className="mt-2 text-xl font-semibold text-white">What do you need to see?</h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-zinc-400">All three paths run locally and require no LLMKit account.</p>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            {pathCards.map((path) => (
              <a
                key={path.id}
                href={path.id === 'mcp' ? '#local-setup' : `#${path.id}`}
                className="public-panel-soft group rounded-xl p-5 transition hover:border-violet-300/25 hover:bg-white/[0.03]"
              >
                <div className="flex items-center justify-between gap-4 font-mono text-[10px] uppercase tracking-[0.14em]">
                  <span className="text-violet-300">{path.label}</span>
                  <span className="text-zinc-500">{path.fit}</span>
                </div>
                <p className="mt-5 text-base font-medium leading-6 text-zinc-100">{path.title}</p>
                <p className="mt-2 text-sm leading-6 text-zinc-400">{path.detail}</p>
                <span className="mt-5 inline-flex font-mono text-xs text-zinc-400 transition group-hover:text-violet-200">Open setup -&gt;</span>
              </a>
            ))}
          </div>
        </section>

        <div className="mt-12 grid gap-12 lg:grid-cols-[170px_minmax(0,1fr)] lg:gap-16">
          <aside className="hidden lg:block">
            <nav aria-label="Documentation sections" className="sticky top-24">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">On this page</p>
              <ul className="mt-4 space-y-1 border-l border-white/[0.08]">
                {navItems.map((item) => (
                  <li key={item.href}>
                    <a href={item.href} className="block border-l border-transparent py-1.5 pl-4 text-sm text-zinc-400 transition hover:border-violet-400 hover:text-white">
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>

          <div className="min-w-0 space-y-20">
            <section id="local-setup" className="scroll-mt-24">
              <SectionHeader
                index="01"
                label="MCP"
                title="Put session cost inside the conversation."
                description="Use this when the agent already owns the session context. LLMKit exposes local cost tools for supported Claude Code sessions and Cline task data discovered across compatible editor storage."
              />
              <div className="mt-7 grid gap-4">
                <Snippet label="Run the server" code="npx @f3d1/llmkit-mcp-server" prompt />
                <Snippet
                  label="MCP configuration"
                  code={`{
  "mcpServers": {
    "llmkit": {
      "command": "npx",
      "args": ["-y", "@f3d1/llmkit-mcp-server"]
    }
  }
}`}
                />
              </div>
              <div className="mt-4 flex flex-col gap-3 rounded-lg border border-emerald-300/10 bg-emerald-300/[0.025] px-4 py-3 text-sm leading-6 text-zinc-400 sm:flex-row sm:items-center sm:justify-between">
                <span>Then ask: "How much did this session cost?"</span>
                <Link href="/mcp" className="shrink-0 font-mono text-xs text-violet-300 transition hover:text-violet-200">Inspect all 11 tools -&gt;</Link>
              </div>
            </section>

            <section id="cli" className="scroll-mt-24 border-t border-white/[0.07] pt-12">
              <SectionHeader
                index="02"
                label="CLI"
                title="Wrap the process you already run."
                description="Use this when you want one command around an existing agent or script. The wrapper starts a local proxy, points compatible clients at it, and prints the observed cost summary when the process exits."
              />
              <div className="mt-7">
                <Snippet label="Wrap a command" code="npx @f3d1/llmkit-cli -- python my_agent.py" prompt />
              </div>
              <p className="mt-4 border-l border-amber-300/30 pl-4 text-sm leading-6 text-zinc-400">
                Coverage is protocol-specific. Calls that bypass OPENAI_BASE_URL or ANTHROPIC_BASE_URL are not observed.
              </p>
            </section>

            <section id="python" className="scroll-mt-24 border-t border-white/[0.07] pt-12">
              <SectionHeader
                index="03"
                label="Python"
                title="Track usage where the response enters your app."
                description="Use this when your OpenAI- or Anthropic-style client accepts a custom httpx client. Estimates come from provider usage fields and the pricing snapshot bundled with the package."
              />
              <div className="mt-7 grid gap-4">
                <Snippet label="Install" code="pip install llmkit-sdk" prompt />
                <Snippet
                  label="Track an OpenAI client"
                  code={`from openai import OpenAI
from llmkit import tracked

client = OpenAI(http_client=tracked())
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "hello"}],
)`}
                />
              </div>
            </section>

            <section id="boundaries" className="scroll-mt-24 border-t border-white/[0.07] pt-12">
              <SectionHeader
                index="04"
                label="Boundaries"
                title="Pick the observer closest to the truth you need."
                description="The surfaces do not make the same claim. Choose based on where request and usage data are actually available."
              />
              <div className="public-panel-soft mt-7 overflow-hidden rounded-xl">
                <div className="divide-y divide-white/[0.06] md:hidden">
                  {comparisonRows.map((row) => (
                    <dl key={row.surface} className="grid grid-cols-[104px_minmax(0,1fr)] gap-x-4 gap-y-2 p-4 text-sm">
                      <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-500">Surface</dt>
                      <dd className="font-medium text-zinc-200">{row.surface}</dd>
                      <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-500">Evidence</dt>
                      <dd className="text-zinc-400">{row.evidence}</dd>
                      <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-500">Account</dt>
                      <dd className="text-zinc-400">{row.account}</dd>
                      <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-500">Boundary</dt>
                      <dd className="text-zinc-400">{row.boundary}</dd>
                    </dl>
                  ))}
                </div>
                <table className="hidden w-full border-collapse text-left text-sm md:table">
                  <thead className="border-b border-white/[0.07] font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Surface</th>
                      <th className="px-4 py-3 font-medium">Evidence source</th>
                      <th className="px-4 py-3 font-medium">Account</th>
                      <th className="px-4 py-3 font-medium">Main boundary</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06] text-zinc-400">
                    {comparisonRows.map((row) => (
                      <tr key={row.surface}>
                        <td className="px-4 py-4 font-medium text-zinc-200">{row.surface}</td>
                        <td className="px-4 py-4">{row.evidence}</td>
                        <td className="px-4 py-4">{row.account}</td>
                        <td className="px-4 py-4">{row.boundary}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section id="hosted-gateway" className="scroll-mt-24 border-t border-white/[0.07] pt-12">
              <SectionHeader
                index="05"
                label="Hosted API gateway"
                title="Use the shared boundary only if you already have a key."
                description="The TypeScript SDK provides typed sessions, cost metadata, and streaming through the hosted gateway. It requires an existing LLMKit API key. New account creation and API-key management remain unavailable while the authenticated service is restored."
              />
              <div className="mt-7 grid gap-4 sm:grid-cols-[minmax(0,1fr)_220px]">
                <Snippet
                  label="Existing-key client"
                  code={`import { LLMKit } from '@f3d1/llmkit-sdk'

const kit = new LLMKit({
  apiKey: process.env.LLMKIT_API_KEY!,
})`}
                />
                <Link href={RECOVERY_STATUS_HREF} className="public-panel-soft flex min-h-28 flex-col justify-between rounded-xl p-5 transition hover:border-violet-300/25">
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-amber-300">Hosted status</span>
                  <span className="text-sm text-zinc-300">Check the authenticated service boundary -&gt;</span>
                </Link>
              </div>
            </section>

            <section id="resources" className="scroll-mt-24 border-t border-white/[0.07] pt-12">
              <SectionHeader
                index="06"
                label="Resources"
                title="Inspect the package you are about to trust."
                description="Source, package registries, and the public tool reference are the canonical paths for implementation detail."
              />
              <div className="mt-7 grid gap-2 sm:grid-cols-2">
                {[
                  { label: 'GitHub source', href: 'https://github.com/smigolsmigol/llmkit' },
                  { label: 'MCP tool reference', href: '/mcp' },
                  { label: 'MCP Server on npm', href: 'https://www.npmjs.com/package/@f3d1/llmkit-mcp-server' },
                  { label: 'Python SDK on PyPI', href: 'https://pypi.org/project/llmkit-sdk/' },
                  { label: 'CLI on npm', href: 'https://www.npmjs.com/package/@f3d1/llmkit-cli' },
                  { label: 'TypeScript SDK on npm', href: 'https://www.npmjs.com/package/@f3d1/llmkit-sdk' },
                  { label: 'Vercel AI SDK provider on npm', href: 'https://www.npmjs.com/package/@f3d1/llmkit-ai-sdk-provider' },
                ].map((resource) => (
                  resource.href.startsWith('/') ? (
                    <Link key={resource.label} href={resource.href} className="public-panel-soft rounded-lg px-4 py-3 text-sm text-zinc-300 transition hover:border-violet-300/25 hover:text-white">
                      {resource.label} <span className="text-zinc-500">-&gt;</span>
                    </Link>
                  ) : (
                    <a key={resource.label} href={resource.href} target="_blank" rel="noopener noreferrer" className="public-panel-soft rounded-lg px-4 py-3 text-sm text-zinc-300 transition hover:border-violet-300/25 hover:text-white">
                      {resource.label} <span className="text-zinc-500">-&gt;</span>
                    </a>
                  )
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </PublicShell>
  );
}
