export const dynamic = 'force-dynamic';

import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { getTotalSpend, getSpendByProvider, getRequestTimeseries, getRecentRequests, getModelBreakdown, getRequestSummary, getSessions, getUserStatsTrend, getBudgetUsage } from '@/lib/queries';
import { StatCard } from '@/components/stat-card';
import { CostChart } from '@/components/charts/cost-chart';
import { ProviderChart } from '@/components/charts/provider-chart';
import { RequestChart } from '@/components/charts/request-chart';
import { TokenChart } from '@/components/charts/token-chart';
import { TimeRangeSelector } from '@/components/time-range-selector';
import { RequestFeed } from '@/components/request-feed';
import { formatCents } from '@/lib/format';

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) return null;

  const params = await searchParams;
  const days = params.days !== undefined ? Number(params.days) : 30;

  const [spend, providers, timeseries, recent, models, summary, sessions, trend, budgetUsage] = await Promise.all([
    getTotalSpend(userId, days),
    getSpendByProvider(userId, days),
    getRequestTimeseries(userId, days || 365),
    getRecentRequests(userId, 10),
    getModelBreakdown(userId, days),
    getRequestSummary(userId, days),
    getSessions(userId, 10, days),
    getUserStatsTrend(userId, days),
    getBudgetUsage(userId),
  ]);

  const providerData = providers
    .map((p) => ({
      provider: p.provider,
      cost: p.totalCostCents / 100,
      count: p.count,
    }))
    .sort((a, b) => b.cost - a.cost);

  const totalRequests = providers.reduce((sum, p) => sum + p.count, 0);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Overview</h1>
        <TimeRangeSelector />
      </div>

      {totalRequests === 0 && (
        <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-8">
          <h2 className="text-lg font-semibold">Get started</h2>
          <p className="mt-1 text-sm text-muted-foreground">Three steps to start tracking costs.</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <Link href="/dashboard/keys" className="group rounded-lg border border-border bg-card p-5 hover:border-violet-500/40">
              <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600/10 text-sm font-bold text-violet-400">1</div>
              <p className="font-medium group-hover:text-violet-400">Create an API key</p>
              <p className="mt-1 text-xs text-muted-foreground">Generate a key to authenticate proxy requests.</p>
            </Link>
            <Link href="/dashboard/providers" className="group rounded-lg border border-border bg-card p-5 hover:border-violet-500/40">
              <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600/10 text-sm font-bold text-violet-400">2</div>
              <p className="font-medium group-hover:text-violet-400">Add a provider key</p>
              <p className="mt-1 text-xs text-muted-foreground">Paste your OpenAI, Anthropic, or other provider API key.</p>
            </Link>
            <Link href="/docs" className="group block rounded-lg border border-border bg-card p-5 transition hover:border-violet-500/20">
              <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600/10 text-sm font-bold text-violet-400">3</div>
              <p className="font-medium group-hover:text-violet-400">Send your first request</p>
              <p className="mt-1 text-xs text-muted-foreground">See code snippets for Python, CLI, or env vars. Costs appear here automatically.</p>
            </Link>
          </div>
          <div className="mt-6 rounded-lg border border-border bg-card p-4">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Or try the local MCP tools (no proxy needed)</p>
            <code className="text-sm">npx @f3d1/llmkit-mcp-server</code>
          </div>
        </div>
      )}

      {totalRequests > 0 && <div className="grid grid-cols-4 gap-1.5">
        <div className="group relative">
          <div className="absolute -inset-px rounded-lg bg-gradient-to-b from-white/[0.06] to-transparent opacity-0 transition duration-300 group-hover:opacity-100" />
          <div className="relative glow-hover rounded-lg border border-border bg-card p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-zinc-500">Total Spend ({days}d)</p>
              {trend.deltas.spend != null && (
                <span className={`text-[10px] font-medium ${trend.deltas.spend > 0 ? 'text-emerald-400' : trend.deltas.spend < 0 ? 'text-red-400' : 'text-zinc-500'}`}>
                  {trend.deltas.spend > 0 ? '\u2191' : trend.deltas.spend < 0 ? '\u2193' : ''}{Math.abs(trend.deltas.spend)}%
                </span>
              )}
            </div>
            <p className="text-gradient-violet mt-0.5 font-mono text-2xl font-bold">
              {formatCents(spend.range)}
            </p>
          </div>
        </div>
        <StatCard label="Today" value={formatCents(spend.today)} />
        <StatCard label="This Week" value={formatCents(spend.week)} />
        <StatCard label="Total Requests" value={totalRequests.toLocaleString()} delta={trend.deltas.requests} />
      </div>}

      {budgetUsage.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5">
          {budgetUsage.map((b) => {
            const pct = b.limitCents > 0 ? Math.min(100, (b.usedCents / b.limitCents) * 100) : 0;
            const warn = pct >= 80;
            return (
              <div key={b.budgetId} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">{b.name}</p>
                  <span className={`text-[10px] font-medium ${warn ? 'text-amber-400' : 'text-muted-foreground'}`}>
                    {b.period}
                  </span>
                </div>
                <p className="mt-0.5 font-mono text-lg font-semibold">
                  {formatCents(b.usedCents)} <span className="text-sm text-muted-foreground">/ {formatCents(b.limitCents)}</span>
                </p>
                <div className="mt-1.5 h-1.5 rounded-full bg-secondary">
                  <div
                    className={`h-full rounded-full transition-all ${warn ? 'bg-amber-400' : 'bg-primary'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {totalRequests > 0 && (
        <div className="grid grid-cols-4 gap-1.5">
          <StatCard
            label="Avg Cost / Request"
            value={formatCents(summary.avgCostCents)}
            delta={trend.deltas.avgCost}
          />
          <StatCard
            label="Avg Latency"
            value={`${summary.avgLatencyMs}ms`}
            sublabel={summary.totalRequests > 0
              ? `~${Math.round((summary.totalInputTokens + summary.totalOutputTokens) / summary.totalRequests).toLocaleString()} tokens/req`
              : undefined}
            delta={trend.deltas.avgLatency}
          />
          <StatCard
            label="Tokens Processed"
            value={summary.totalInputTokens + summary.totalOutputTokens > 0
              ? `${((summary.totalInputTokens + summary.totalOutputTokens) / 1000).toFixed(1)}k`
              : '0'}
            sublabel={`${(summary.totalInputTokens / 1000).toFixed(1)}k in / ${(summary.totalOutputTokens / 1000).toFixed(1)}k out`}
          />
          <StatCard
            label="Projected Monthly"
            value={formatCents(summary.projectedMonthlyCents)}
            sublabel="based on last 7 days"
          />
        </div>
      )}

      {totalRequests > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <div className="rounded-lg border border-border bg-card p-2">
              <div className="mb-1 border-b border-[#1a1a1a] pb-1">
                <h2 className="text-xs font-medium">Spend</h2>
                <p className="text-[10px] text-muted-foreground">
                  <span className="mr-2"><span className="inline-block h-1.5 w-1.5 rounded-full bg-[#7c3aed]" /> Input</span>
                  <span><span className="inline-block h-1.5 w-1.5 rounded-full bg-[#a78bfa]" /> Output</span>
                </p>
              </div>
              <CostChart data={timeseries} />
            </div>
            <div className="rounded-lg border border-border bg-card p-2">
              <div className="mb-1 border-b border-[#1a1a1a] pb-1">
                <h2 className="text-xs font-medium">Request Volume</h2>
                <p className="text-[10px] text-muted-foreground">Requests per hour</p>
              </div>
              <RequestChart data={timeseries} />
            </div>
            <div className="rounded-lg border border-border bg-card p-2">
              <div className="mb-1 border-b border-[#1a1a1a] pb-1">
                <h2 className="text-xs font-medium">By Provider</h2>
                <p className="text-[10px] text-muted-foreground">Spend distribution</p>
              </div>
              <ProviderChart data={providerData} />
            </div>
            <div className="rounded-lg border border-border bg-card p-2">
              <div className="mb-1 border-b border-[#1a1a1a] pb-1">
                <h2 className="text-xs font-medium">Token Usage</h2>
                <p className="text-[10px] text-muted-foreground">
                  <span className="mr-2"><span className="inline-block h-1.5 w-1.5 rounded-full bg-[#3b82f6]" /> Input</span>
                  <span><span className="inline-block h-1.5 w-1.5 rounded-full bg-[#06b6d4]" /> Output</span>
                </p>
              </div>
              <TokenChart data={timeseries} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <div className="rounded-lg border border-border bg-card p-2">
              <div className="mb-1 border-b border-[#1a1a1a] pb-1">
                <h2 className="text-xs font-medium">Cost by Model</h2>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="pb-1 font-medium">Model</th>
                    <th className="pb-1 font-medium text-right">Reqs</th>
                    <th className="pb-1 font-medium text-right">Spend</th>
                    <th className="pb-1 font-medium text-right">Avg ms</th>
                    <th className="pb-1 font-medium text-right">$/1k tok</th>
                  </tr>
                </thead>
                <tbody>
                  {models.slice(0, 8).map((m) => (
                    <tr key={m.model} className="border-t border-[#1a1a1a]">
                      <td className="py-1 font-mono text-xs">{m.model}</td>
                      <td className="py-1 text-right text-muted-foreground">{m.requests}</td>
                      <td className="py-1 text-right font-mono">{formatCents(m.spendCents)}</td>
                      <td className="py-1 text-right text-muted-foreground">{m.avgLatencyMs.toLocaleString()}</td>
                      <td className="py-1 text-right font-mono text-muted-foreground">{formatCents(m.costPer1kTokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-lg border border-border bg-card p-2">
              <div className="mb-1 border-b border-[#1a1a1a] pb-1">
                <h2 className="text-xs font-medium">Recent Sessions</h2>
              </div>
              {sessions.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground/60">Pass x-llmkit-session-id header to group requests.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="pb-1 font-medium">Session</th>
                      <th className="pb-1 font-medium text-right">Reqs</th>
                      <th className="pb-1 font-medium text-right">Cost</th>
                      <th className="pb-1 font-medium text-right">Providers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.slice(0, 8).map((s) => (
                      <tr key={s.sessionId} className="border-t border-[#1a1a1a] transition-colors hover:bg-secondary/50">
                        <td className="max-w-[180px] truncate py-1 font-mono text-xs">
                          {s.sessionId === 'no-session' ? (
                            <span className="text-muted-foreground">{s.sessionId}</span>
                          ) : (
                            <Link href={`/dashboard/requests?session_id=${encodeURIComponent(s.sessionId)}`} className="text-primary hover:underline">
                              {s.sessionId}
                            </Link>
                          )}
                        </td>
                        <td className="py-1 text-right text-muted-foreground">{s.requestCount}</td>
                        <td className="py-1 text-right font-mono">{formatCents(s.totalCostCents)}</td>
                        <td className="py-1 text-right text-xs text-muted-foreground">{s.providers.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-2">
            <div className="mb-1 border-b border-[#1a1a1a] pb-1">
              <h2 className="text-xs font-medium">Recent Requests</h2>
            </div>
            <RequestFeed requests={recent} />
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-border bg-card p-2">
          <div className="mb-1 border-b border-[#1a1a1a] pb-1">
            <h2 className="text-xs font-medium">Recent Requests</h2>
          </div>
          <RequestFeed requests={recent} />
        </div>
      )}
    </div>
  );
}
