import { auth } from '@clerk/nextjs/server';
import { getTotalSpend, getSpendByProvider, getDailySpend, getRecentRequests, getModelBreakdown, getRequestSummary, getSessions } from '@/lib/queries';
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

  const [spend, providers, dailySpend, recent, models, summary, sessions] = await Promise.all([
    getTotalSpend(userId),
    getSpendByProvider(userId, days),
    getDailySpend(userId, days || 365),
    getRecentRequests(userId, 10),
    getModelBreakdown(userId, days),
    getRequestSummary(userId, days),
    getSessions(userId, 10, days),
  ]);

  const chartData = dailySpend.map((d) => ({
    date: d.date,
    cost: d.costCents / 100,
    requests: d.requests,
    inputTokens: d.inputTokens,
    outputTokens: d.outputTokens,
  }));

  const providerData = providers
    .map((p) => ({
      provider: p.provider,
      cost: p.totalCostCents / 100,
      count: p.count,
    }))
    .sort((a, b) => b.cost - a.cost);

  const totalRequests = providers.reduce((sum, p) => sum + p.count, 0);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Overview</h1>
        <TimeRangeSelector />
      </div>

      {totalRequests === 0 && (
        <div className="rounded-lg border border-primary/20 bg-card p-6">
          <p className="font-medium">Get started</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create an API key in the Keys tab, then point your OpenAI or Anthropic
            SDK at the LLMKit proxy. You bring your own provider keys. LLMKit
            tracks costs and enforces budgets. Free during beta, no limits.
          </p>
        </div>
      )}

      <div className="grid grid-cols-4 gap-4">
        <div className="glow-hover rounded-lg border border-primary/20 bg-card p-5">
          <p className="text-sm text-muted-foreground">Total Spend (30d)</p>
          <p className="mt-1 font-mono text-3xl font-bold text-primary">
            {formatCents(spend.month)}
          </p>
        </div>
        <StatCard label="Today" value={formatCents(spend.today)} />
        <StatCard label="This Week" value={formatCents(spend.week)} />
        <StatCard label="Total Requests" value={totalRequests.toLocaleString()} />
      </div>

      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="Avg Cost / Request"
          value={formatCents(summary.avgCostCents)}
        />
        <StatCard
          label="Avg Latency"
          value={`${summary.avgLatencyMs}ms`}
          sublabel={summary.totalRequests > 0
            ? `~${Math.round((summary.totalInputTokens + summary.totalOutputTokens) / summary.totalRequests).toLocaleString()} tokens/req`
            : undefined}
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

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="mb-1 text-sm font-medium">Daily Spend</h2>
          <p className="mb-3 text-xs text-muted-foreground">Cost per day in USD</p>
          <CostChart data={chartData} />
        </div>
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="mb-1 text-sm font-medium">Request Volume</h2>
          <p className="mb-3 text-xs text-muted-foreground">API calls per day</p>
          <RequestChart data={chartData} />
        </div>
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="mb-1 text-sm font-medium">By Provider</h2>
          <p className="mb-3 text-xs text-muted-foreground">Spend distribution</p>
          <ProviderChart data={providerData} />
        </div>
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="mb-1 text-sm font-medium">Token Usage</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            <span className="mr-3"><span className="inline-block h-2 w-2 rounded-full bg-[#3b82f6]" /> Input</span>
            <span><span className="inline-block h-2 w-2 rounded-full bg-[#06b6d4]" /> Output</span>
          </p>
          <TokenChart data={chartData} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Model Breakdown */}
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">
            Cost by Model
          </h2>
          {models.length === 0 ? (
            <p className="text-sm text-muted-foreground/60">No data yet</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">Model</th>
                  <th className="pb-2 font-medium text-right">Reqs</th>
                  <th className="pb-2 font-medium text-right">Spend</th>
                  <th className="pb-2 font-medium text-right">Avg ms</th>
                  <th className="pb-2 font-medium text-right">$/1k tok</th>
                </tr>
              </thead>
              <tbody>
                {models.slice(0, 8).map((m) => (
                  <tr key={m.model} className="border-t border-border/30">
                    <td className="py-1.5 font-mono text-xs">{m.model}</td>
                    <td className="py-1.5 text-right text-muted-foreground">{m.requests}</td>
                    <td className="py-1.5 text-right font-mono">{formatCents(m.spendCents)}</td>
                    <td className="py-1.5 text-right text-muted-foreground">{m.avgLatencyMs.toLocaleString()}</td>
                    <td className="py-1.5 text-right font-mono text-muted-foreground">{formatCents(m.costPer1kTokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Session Breakdown */}
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">
            Recent Sessions
          </h2>
          {sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground/60">No sessions yet. Pass x-llmkit-session-id header to group requests.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">Session</th>
                  <th className="pb-2 font-medium text-right">Reqs</th>
                  <th className="pb-2 font-medium text-right">Cost</th>
                  <th className="pb-2 font-medium text-right">Providers</th>
                </tr>
              </thead>
              <tbody>
                {sessions.slice(0, 8).map((s) => (
                  <tr key={s.sessionId} className="border-t border-border/30">
                    <td className="max-w-[180px] truncate py-1.5 font-mono text-xs">{s.sessionId}</td>
                    <td className="py-1.5 text-right text-muted-foreground">{s.requestCount}</td>
                    <td className="py-1.5 text-right font-mono">{formatCents(s.totalCostCents)}</td>
                    <td className="py-1.5 text-right text-xs text-muted-foreground">{s.providers.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Recent Requests</h2>
        <RequestFeed requests={recent} />
      </div>
    </div>
  );
}
