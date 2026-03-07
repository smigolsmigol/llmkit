import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import {
  getAllAccounts,
  getAdminStats,
  getAdminDailyStats,
  getAdminUserBreakdown,
  getAdminTopModels,
} from '@/lib/queries';
import { StatCard } from '@/components/stat-card';
import { CostChart } from '@/components/charts/cost-chart';
import { TimeRangeSelector } from '@/components/time-range-selector';
import { formatCents } from '@/lib/format';
import { AccountTable } from './account-table';

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const { userId } = await auth();
  if (!userId || userId !== process.env.ADMIN_USER_ID) {
    redirect('/dashboard');
  }

  const params = await searchParams;
  const days = params.days !== undefined ? Number(params.days) : 30;

  const [accounts, stats, dailyStats, userBreakdown, topModels] = await Promise.all([
    getAllAccounts(),
    getAdminStats(days),
    getAdminDailyStats(days),
    getAdminUserBreakdown(days),
    getAdminTopModels(days),
  ]);

  const chartData = dailyStats.map((d) => ({
    date: d.date,
    cost: d.costCents / 100,
  }));

  const totalTokens = stats.totalInputTokens + stats.totalOutputTokens;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Admin</h1>
        <TimeRangeSelector />
      </div>

      {/* row 1: money + volume */}
      <div className="grid grid-cols-4 gap-4">
        <div className="glow-hover rounded-lg border border-primary/20 bg-card p-5">
          <p className="text-sm text-muted-foreground">Platform Spend</p>
          <p className="mt-1 font-mono text-3xl font-bold text-primary">
            {formatCents(stats.totalSpendCents)}
          </p>
        </div>
        <StatCard label="Total Requests" value={stats.totalRequests.toLocaleString()} />
        <StatCard label="Accounts" value={String(stats.totalAccounts)} />
        <StatCard
          label="Tokens Processed"
          value={totalTokens > 1_000_000 ? `${(totalTokens / 1_000_000).toFixed(1)}M` : totalTokens.toLocaleString()}
          sublabel={`${stats.totalInputTokens.toLocaleString()} in / ${stats.totalOutputTokens.toLocaleString()} out`}
        />
      </div>

      {/* row 2: health + activity */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="Active Keys (today)"
          value={String(stats.activeKeysToday)}
          sublabel={`${stats.activeKeysWeek} this week, ${stats.activeKeysMonth} this month`}
        />
        <StatCard
          label="Error Rate"
          value={`${stats.errorRate.toFixed(1)}%`}
          sublabel={stats.errorRate > 5 ? 'above threshold' : 'healthy'}
        />
        <StatCard
          label="Avg Latency"
          value={`${stats.avgLatencyMs}ms`}
          sublabel={stats.avgTokensPerReq > 0 ? `~${stats.avgTokensPerReq.toLocaleString()} tokens/req` : 'across all providers'}
        />
        <StatCard
          label="p95 Latency"
          value={`${stats.p95LatencyMs}ms`}
          sublabel="95th percentile"
        />
      </div>

      {/* row 3: spend chart */}
      <div className="rounded-lg border border-border bg-card p-5">
        <h2 className="mb-4 text-sm font-medium text-muted-foreground">Daily Platform Spend (30d)</h2>
        <CostChart data={chartData} />
      </div>

      {/* row 4: top models + per-user side by side */}
      <div className="grid grid-cols-2 gap-4">
        {topModels.length > 0 && (
          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">Top Models</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="pb-2">Model</th>
                    <th className="pb-2">Provider</th>
                    <th className="pb-2 text-right">Reqs</th>
                    <th className="pb-2 text-right">Spend</th>
                    <th className="pb-2 text-right">Avg ms</th>
                    <th className="pb-2 text-right">Tok/req</th>
                    <th className="pb-2 text-right">$/1k tok</th>
                  </tr>
                </thead>
                <tbody>
                  {topModels.slice(0, 10).map((m) => (
                    <tr key={m.model} className="border-t border-border/50">
                      <td className="py-1.5 font-mono text-xs">{m.model}</td>
                      <td className="py-1.5 text-xs text-muted-foreground">{m.provider}</td>
                      <td className="py-1.5 text-right text-xs">{m.requests}</td>
                      <td className="py-1.5 text-right font-mono text-xs">{formatCents(m.spendCents)}</td>
                      <td className="py-1.5 text-right text-xs text-muted-foreground">{m.avgLatencyMs.toLocaleString()}</td>
                      <td className="py-1.5 text-right text-xs text-muted-foreground">{m.avgTokensPerReq.toLocaleString()}</td>
                      <td className="py-1.5 text-right font-mono text-xs">{formatCents(m.costPer1kTokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {userBreakdown.length > 0 && (
          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">Per-User Breakdown</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="pb-2">User</th>
                    <th className="pb-2">Plan</th>
                    <th className="pb-2 text-right">Reqs</th>
                    <th className="pb-2 text-right">Spend</th>
                    <th className="pb-2 text-right">Errs</th>
                    <th className="pb-2 text-right">Avg ms</th>
                  </tr>
                </thead>
                <tbody>
                  {userBreakdown.map((u) => (
                    <tr key={u.userId} className="border-t border-border/50">
                      <td className="py-1.5 font-mono text-xs" title={u.userId}>
                        {u.note || u.userId.slice(0, 12) + '...'}
                      </td>
                      <td className="py-1.5 text-xs text-muted-foreground">{u.plan}</td>
                      <td className="py-1.5 text-right text-xs">{u.requests}</td>
                      <td className="py-1.5 text-right font-mono text-xs">{formatCents(u.spendCents)}</td>
                      <td className="py-1.5 text-right text-xs text-red-400">{u.errors || ''}</td>
                      <td className="py-1.5 text-right text-xs">{u.avgLatencyMs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* row 5: account management */}
      <div>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">
          Accounts ({accounts.length})
        </h2>
        <AccountTable accounts={accounts} />
      </div>
    </div>
  );
}
