import { PublicNav } from '@/components/public-nav';
import { PublicFooter } from '@/components/public-footer';

const localTools = [
  { name: 'llmkit_local_session', desc: 'Current session cost across all detected AI coding tools' },
  { name: 'llmkit_local_projects', desc: 'Cumulative cost per project, ranked by spend' },
  { name: 'llmkit_local_cache', desc: 'Cache savings analysis: how much prompt caching saved' },
  { name: 'llmkit_local_forecast', desc: 'Monthly cost projection, compared to Claude Max subscription' },
  { name: 'llmkit_local_agents', desc: 'Subagent cost attribution for the current session' },
];

const proxyTools = [
  { name: 'llmkit_usage_stats', desc: 'Spend, requests, top models for a time period' },
  { name: 'llmkit_cost_query', desc: 'Cost breakdown by provider, model, session, or day' },
  { name: 'llmkit_budget_status', desc: 'Budget limits and remaining balance' },
  { name: 'llmkit_session_summary', desc: 'Recent sessions with cost, duration, models' },
  { name: 'llmkit_list_keys', desc: 'All API keys with status' },
  { name: 'llmkit_health', desc: 'Proxy health and response time' },
];

const notionTools = [
  { name: 'llmkit_notion_cost_snapshot', desc: 'Formatted cost snapshot synced to Notion' },
  { name: 'llmkit_notion_budget_check', desc: 'Budget status with approval workflow' },
  { name: 'llmkit_notion_session_report', desc: 'Per-session breakdown synced to Notion' },
];

const supportedTools = [
  { name: 'Claude Code', desc: 'Reads JSONL session files, full cost + token breakdown' },
  { name: 'Cursor', desc: 'Via VS Code extension storage, all variants detected' },
  { name: 'Cline', desc: 'Parses task data from saoudrizwan.claude-dev extension' },
  { name: 'Windsurf', desc: 'VS Code server dirs, auto-detected alongside others' },
  { name: 'WSL', desc: 'Scans WSL distros for remote VS Code server data' },
];

function ToolRow({ name, desc }: { name: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
      <code className="shrink-0 rounded bg-white/[0.06] px-2 py-0.5 font-mono text-xs text-violet-400">{name}</code>
      <p className="text-xs text-zinc-400">{desc}</p>
    </div>
  );
}

export default function McpPage() {
  return (
    <div className="relative min-h-screen bg-[#0a0a0a] text-white selection:bg-violet-500/30">
      <div
        className="pointer-events-none fixed inset-0 z-50 opacity-[0.02]"
        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")` }}
      />

      <PublicNav />

      {/* hero */}
      <div className="relative">
        <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 h-[400px] w-[700px] bg-[radial-gradient(ellipse,_rgba(192,132,252,0.06),_transparent_70%)]" />
        <div className="relative mx-auto max-w-3xl px-6 pt-16 pb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            MCP Server
          </h1>
          <p className="mx-auto mt-4 max-w-lg text-base leading-relaxed text-zinc-400">
            14 tools for cost tracking inside your IDE.
            5 work locally without an account or API key.
          </p>
        </div>
      </div>

      {/* install */}
      <div className="mx-auto max-w-2xl px-6 pb-10">
        <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-[#111]">
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
        <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-[#111]">
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2.5">
            <span className="text-xs text-zinc-500">claude_desktop_config.json</span>
          </div>
          <pre className="p-5 font-mono text-xs text-zinc-300 overflow-x-auto">{`{
  "mcpServers": {
    "llmkit": {
      "command": "npx",
      "args": ["@f3d1/llmkit-mcp-server"]
    }
  }
}`}</pre>
        </div>
        <p className="mt-3 text-center text-xs text-zinc-600">
          No API key needed for local tools. Add LLMKIT_API_KEY to env for proxy tools.
        </p>
      </div>

      {/* local tools */}
      <div className="mx-auto max-w-3xl px-6 pb-10">
        <div className="mb-4">
          <h2 className="text-base font-semibold">Local tools <span className="ml-2 text-xs font-normal text-cyan-400">no account needed</span></h2>
          <p className="mt-1 text-xs text-zinc-500">Reads Claude Code, Cursor, and Cline session data from your machine.</p>
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

      {/* notion tools */}
      <div className="mx-auto max-w-3xl px-6 pb-12">
        <div className="mb-4">
          <h2 className="text-base font-semibold">Notion sync <span className="ml-2 text-xs font-normal text-amber-400">requires NOTION_TOKEN</span></h2>
          <p className="mt-1 text-xs text-zinc-500">Push cost snapshots and session reports to Notion pages.</p>
        </div>
        <div className="space-y-2">
          {notionTools.map((t) => <ToolRow key={t.name} {...t} />)}
        </div>
      </div>

      {/* supported tools */}
      <div className="mx-auto max-w-3xl px-6 pb-12">
        <h2 className="mb-5 text-lg font-semibold">Supported coding tools</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {supportedTools.map((t) => (
            <div key={t.name} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
              <p className="text-sm font-medium text-zinc-200">{t.name}</p>
              <p className="mt-1 text-xs text-zinc-500">{t.desc}</p>
            </div>
          ))}
        </div>
      </div>

      <PublicFooter />
    </div>
  );
}
