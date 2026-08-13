
import type { Metadata } from 'next';
import { PublicPageHero } from '@/components/public/public-page-hero';
import { PublicShell } from '@/components/public/public-shell';

export const metadata: Metadata = {
  title: 'MCP Server - LLMKit',
  description: '11 MCP tools for AI cost inspection. 5 local tools read supported Claude Code sessions and Cline task data without an account.',
  openGraph: {
    title: 'LLMKit MCP Server',
    description: '11 tools for AI cost tracking inside your IDE. 5 work locally, no account needed.',
    url: 'https://llmkit.sh/mcp',
  },
};

const localTools = [
  { name: 'llmkit_local_session', desc: 'Current Claude Code session and latest detected Cline task cost' },
  { name: 'llmkit_local_projects', desc: 'Cumulative cost per project, ranked by spend' },
  { name: 'llmkit_local_cache', desc: 'Cache savings analysis: how much prompt caching saved' },
  { name: 'llmkit_local_forecast', desc: '30-day API-rate projection from the detected local history' },
  { name: 'llmkit_local_agents', desc: 'Claude Code subagent attribution for the current session' },
];

const proxyTools = [
  { name: 'llmkit_usage_stats', desc: 'Spend, requests, top models for a time period' },
  { name: 'llmkit_cost_query', desc: 'Cost breakdown by provider, model, session, or day' },
  { name: 'llmkit_budget_status', desc: 'Budget limits and remaining balance' },
  { name: 'llmkit_session_summary', desc: 'Recent sessions with cost, duration, models' },
  { name: 'llmkit_list_keys', desc: 'Configured gateway key metadata and status' },
  { name: 'llmkit_health', desc: 'Proxy health and response time' },
];

const supportedSources = [
  { name: 'Claude Code', desc: 'Reads local JSONL sessions with token and cache-usage fields' },
  { name: 'Cline on VS Code', desc: 'Reads Cline task data from extension global storage' },
  { name: 'Cline on Cursor / Windsurf', desc: 'Detects the same Cline extension storage in supported editor variants' },
  { name: 'Remote editor installs', desc: 'Checks supported VS Code, Cursor, and Windsurf server directories' },
  { name: 'WSL from Windows', desc: 'Checks reachable WSL home directories for supported remote editor storage' },
];

function ToolRow({ name, desc }: { name: string; desc: string }) {
  return (
    <div className="public-row-link flex items-start gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
      <code className="shrink-0 rounded bg-white/[0.06] px-2 py-0.5 font-mono text-xs text-violet-400">{name}</code>
      <p className="text-xs text-zinc-400">{desc}</p>
    </div>
  );
}

export default function McpPage() {
  return (
    <PublicShell>
      <PublicPageHero
        eyebrow="MCP / local evidence"
        title="Ask your coding agent what the session cost."
        description="Eleven cost tools in one MCP server. Five inspect supported local Claude Code and Cline data without an account, a proxy, or an API key."
        aside={(
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.07] text-center">
            <div className="bg-[#0c0d12] p-4"><p className="text-2xl font-semibold text-cyan-300">5</p><p className="mt-1 font-mono text-[9px] text-zinc-600">local tools</p></div>
            <div className="bg-[#0c0d12] p-4"><p className="text-2xl font-semibold text-violet-300">6</p><p className="mt-1 font-mono text-[9px] text-zinc-600">proxy tools</p></div>
          </div>
        )}
      />

      {/* install */}
      <div className="mx-auto max-w-2xl px-6 pb-10">
        <div className="public-panel overflow-hidden rounded-xl">
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2.5">
            <div className="flex gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
              <div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
              <div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
            </div>
            <span className="ml-2 text-xs text-zinc-500">install</span>
          </div>
          <div className="p-5 font-mono text-sm">
            <p><span className="text-emerald-400">$</span> <span className="text-zinc-300">npx @f3d1/llmkit-mcp-server</span></p>
          </div>
        </div>
      </div>

      {/* config snippet */}
      <div className="mx-auto max-w-2xl px-6 pb-12">
        <p className="mb-3 text-center text-xs text-zinc-500">Add to your MCP client config</p>
        <div className="public-panel overflow-hidden rounded-xl">
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2.5">
            <span className="text-xs text-zinc-500">.mcp.json (Claude Code) or .cursor/mcp.json (Cursor)</span>
          </div>
          <pre className="p-5 font-mono text-xs text-zinc-300 overflow-x-auto">{`{
  "mcpServers": {
    "llmkit": {
      "command": "npx",
      "args": ["-y", "@f3d1/llmkit-mcp-server"]
    }
  }
}`}</pre>
        </div>
        <p className="mt-3 text-center text-xs text-zinc-600">
          No API key is needed for local tools. Proxy tools require an existing key in LLMKIT_API_KEY while new account creation is closed.
        </p>
      </div>

      {/* local tools */}
      <div className="mx-auto max-w-3xl px-6 pb-10">
        <div className="mb-4">
          <h2 className="text-base font-semibold">Local tools <span className="ml-2 text-xs font-normal text-cyan-400">no account needed</span></h2>
          <p className="mt-1 text-xs text-zinc-500">Reads supported Claude Code sessions and Cline task data from detected editor storage.</p>
        </div>
        <div className="space-y-2">
          {localTools.map((t) => <ToolRow key={t.name} {...t} />)}
        </div>
      </div>

      {/* proxy tools */}
      <div className="mx-auto max-w-3xl px-6 pb-10">
        <div className="mb-4">
          <h2 className="text-base font-semibold">Proxy tools <span className="ml-2 text-xs font-normal text-violet-400">requires API key</span></h2>
          <p className="mt-1 text-xs text-zinc-500">Queries your LLMKit proxy for spend, budgets, and sessions.</p>
        </div>
        <div className="space-y-2">
          {proxyTools.map((t) => <ToolRow key={t.name} {...t} />)}
        </div>
      </div>

      {/* supported sources */}
      <div className="mx-auto max-w-3xl px-6 pb-12">
        <h2 className="mb-5 text-lg font-semibold">Supported local sources</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {supportedSources.map((t) => (
            <div key={t.name} className="public-row-link rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
              <p className="text-sm font-medium text-zinc-200">{t.name}</p>
              <p className="mt-1 text-xs text-zinc-500">{t.desc}</p>
            </div>
          ))}
        </div>
      </div>

    </PublicShell>
  );
}
