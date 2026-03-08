import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import {
  getAllAccounts,
  getAdminStats,
  getAdminRequestTimeseries,
  getAdminUserBreakdown,
  getAdminTopModels,
  getAccountPlan,
} from '@/lib/queries';
import { StatCard } from '@/components/stat-card';
import { CostChart } from '@/components/charts/cost-chart';
import { RequestChart } from '@/components/charts/request-chart';
import { TimeRangeSelector } from '@/components/time-range-selector';
import { formatCents } from '@/lib/format';
import { AccountTable } from './account-table';

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect('/dashboard');
  const plan = await getAccountPlan(userId);
  if (plan !== 'admin') redirect('/dashboard');

  const params = await searchParams;
  const days = params.days !== undefined ? Number(params.days) : 30;

  const [accounts, stats, timeseries, userBreakdown, topModels] = await Promise.all([
    getAllAccounts(),
    getAdminStats(days),
    getAdminRequestTimeseries(days),
    getAdminUserBreakdown(days),
    getAdminTopModels(days),
  ]);

  const totalTokens = stats.totalInputTokens + stats.totalOutputTokens;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Admin</h1>
        <TimeRangeSelector />
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        <div className="glow-hover rounded-lg border border-[#2a2a2a] bg-card p-3">
          <p className="text-xs text-muted-foreground">Platform Spend</p>
          <p className="mt-0.5 font-mono text-2xl font-bold text-primary">
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

      <div className="grid grid-cols-4 gap-1.5">
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

      <div className="grid grid-cols-2 gap-1.5">
        <div className="rounded-lg border border-[#2a2a2a] bg-card p-2">
          <div className="mb-1 border-b border-[#1a1a1a] pb-1">
            <h2 className="text-xs font-medium">Platform Spend</h2>
            <p className="text-[10px] text-muted-foreground">Hourly, all users</p>
          </div>
          <CostChart data={timeseries} />
        </div>
        <div className="rounded-lg border border-[#2a2a2a] bg-card p-2">
          <div className="mb-1 border-b border-[#1a1a1a] pb-1">
            <h2 className="text-xs font-medium">Request Volume</h2>
            <p className="text-[10px] text-muted-foreground">Per hour, platform-wide</p>
          </div>
          <RequestChart data={timeseries} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        {topModels.length > 0 && (
          <div className="rounded-lg border border-[#2a2a2a] bg-card p-2">
            <div className="mb-1 border-b border-[#1a1a1a] pb-1">
              <h2 className="text-xs font-medium">Top Models</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="pb-1">Model</th>
                    <th className="pb-1">Provider</th>
                    <th className="pb-1 text-right">Reqs</th>
                    <th className="pb-1 text-right">Spend</th>
                    <th className="pb-1 text-right">Avg ms</th>
                    <th className="pb-1 text-right">Tok/req</th>
                    <th className="pb-1 text-right">$/1k tok</th>
                  </tr>
                </thead>
                <tbody>
                  {topModels.slice(0, 10).map((m) => (
                    <tr key={m.model} className="border-t border-[#1a1a1a]">
                      <td className="py-1 font-mono text-xs">{m.model}</td>
                      <td className="py-1 text-xs text-muted-foreground">{m.provider}</td>
                      <td className="py-1 text-right text-xs">{m.requests}</td>
                      <td className="py-1 text-right font-mono text-xs">{formatCents(m.spendCents)}</td>
                      <td className="py-1 text-right text-xs text-muted-foreground">{m.avgLatencyMs.toLocaleString()}</td>
                      <td className="py-1 text-right text-xs text-muted-foreground">{m.avgTokensPerReq.toLocaleString()}</td>
                      <td className="py-1 text-right font-mono text-xs">{formatCents(m.costPer1kTokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {userBreakdown.length > 0 && (
          <div className="rounded-lg border border-[#2a2a2a] bg-card p-2">
            <div className="mb-1 border-b border-[#1a1a1a] pb-1">
              <h2 className="text-xs font-medium">Per-User Breakdown</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="pb-1">User</th>
                    <th className="pb-1">Plan</th>
                    <th className="pb-1 text-right">Reqs</th>
                    <th className="pb-1 text-right">Spend</th>
                    <th className="pb-1 text-right">Errs</th>
                    <th className="pb-1 text-right">Avg ms</th>
                  </tr>
                </thead>
                <tbody>
                  {userBreakdown.map((u) => (
                    <tr key={u.userId} className="border-t border-[#1a1a1a]">
                      <td className="py-1 font-mono text-xs" title={u.userId}>
                        {u.note || u.userId.slice(0, 12) + '...'}
                      </td>
                      <td className="py-1 text-xs text-muted-foreground">{u.plan}</td>
                      <td className="py-1 text-right text-xs">{u.requests}</td>
                      <td className="py-1 text-right font-mono text-xs">{formatCents(u.spendCents)}</td>
                      <td className="py-1 text-right text-xs text-red-400">{u.errors || ''}</td>
                      <td className="py-1 text-right text-xs">{u.avgLatencyMs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-[#2a2a2a] bg-card p-2">
        <div className="mb-1 border-b border-[#1a1a1a] pb-1">
          <h2 className="text-xs font-medium">Accounts ({accounts.length})</h2>
        </div>
        <AccountTable accounts={accounts} />
      </div>
    </div>
  );
}
