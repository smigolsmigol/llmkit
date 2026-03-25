'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CostChart } from '@/components/charts/cost-chart';
import { ProviderChart } from '@/components/charts/provider-chart';
import { RequestChart } from '@/components/charts/request-chart';
import { TokenChart } from '@/components/charts/token-chart';
import { EcosystemPanel } from '@/components/ecosystem-panel';
import { StatCard } from '@/components/stat-card';
import { formatCents } from '@/lib/format';
import type { TimeseriesPoint, AccountRow } from '@/lib/queries';
import { AccountTable } from './account-table';
import { AlertsPanel } from './alerts-panel';
import { ThresholdStatCard } from './threshold-stat-card';

const tabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'infra', label: 'Infrastructure' },
  { id: 'ecosystem', label: 'Ecosystem' },
  { id: 'users', label: 'Users' },
  { id: 'alerts', label: 'Alerts' },
] as const;

type TabId = (typeof tabs)[number]['id'];

function timeAgo(date: string): string {
  const ms = Date.now() - new Date(date).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface AdminTabsProps {
  stats: {
    totalSpendCents: number;
    totalRequests: number;
    totalAccounts: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    activeKeysToday: number;
    activeKeysWeek: number;
    activeKeysMonth: number;
    errorRate: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    avgTokensPerReq: number;
  };
  deltas: {
    spend: number | null;
    requests: number | null;
    tokens: number | null;
    errorRate: number | null;
    avgLatency: number | null;
    p95Latency: number | null;
  };
  totalTokens: number;
  activeUsers: number;
  timeseries: TimeseriesPoint[];
  providerSpend: Array<{ provider: string; cost: number; count: number }>;
  providerHealth: Array<{
    provider: string;
    requests: number;
    successRate: number;
    lastErrorAt: string | null;
    avgLatencyMs: number;
    p95LatencyMs: number;
    spendCents: number;
  }>;
  topModels: Array<{
    model: string;
    provider: string;
    requests: number;
    spendCents: number;
    avgLatencyMs: number;
    avgTokensPerReq: number;
    costPer1kTokens: number;
  }>;
  userBreakdown: Array<{
    userId: string;
    note: string | null;
    plan: string;
    requests: number;
    spendCents: number;
    errors: number;
    avgLatencyMs: number;
  }>;
  accounts: AccountRow[];
}

export function AdminTabs(props: AdminTabsProps) {
  const { stats, deltas, totalTokens, activeUsers, timeseries, providerSpend, providerHealth, topModels, userBreakdown, accounts } = props;
  const searchParams = useSearchParams();
  const router = useRouter();
  const activeTab = (searchParams.get('tab') as TabId) || 'overview';

  useEffect(() => {
    window.dispatchEvent(new Event('resize'));
  }, [activeTab]);

  function setTab(id: TabId) {
    const params = new URLSearchParams(searchParams.toString());
    if (id === 'overview') {
      params.delete('tab');
    } else {
      params.set('tab', id);
    }
    router.push(`?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="space-y-1.5">
      {/* tab bar */}
      <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === t.id
                ? 'bg-violet-500/15 text-violet-400'
                : 'text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview */}
      <div style={{ display: activeTab === 'overview' ? 'block' : 'none' }}>
        <div className="space-y-1.5">
          {/* stat cards row 1 */}
          <div className="grid grid-cols-4 gap-1.5">
            <div className="glow-hover rounded-lg border border-border bg-card p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Platform Spend</p>
                {deltas.spend != null && (
                  <span className={`text-[10px] font-medium ${deltas.spend > 0 ? 'text-emerald-400' : deltas.spend < 0 ? 'text-red-400' : 'text-muted-foreground'}`}>
                    {deltas.spend > 0 ? '\u2191' : deltas.spend < 0 ? '\u2193' : ''}{Math.abs(deltas.spend)}%
                  </span>
                )}
              </div>
              <p className="mt-0.5 font-mono text-2xl font-bold text-primary">{formatCents(stats.totalSpendCents)}</p>
            </div>
            <StatCard label="Total Requests" value={stats.totalRequests.toLocaleString()} delta={deltas.requests} />
            <StatCard label="Accounts" value={String(stats.totalAccounts)} sublabel={`${activeUsers} active in period`} />
            <StatCard
              label="Tokens Processed"
              value={totalTokens > 1_000_000 ? `${(totalTokens / 1_000_000).toFixed(1)}M` : totalTokens.toLocaleString()}
              sublabel={`${stats.totalInputTokens.toLocaleString()} in / ${stats.totalOutputTokens.toLocaleString()} out`}
              delta={deltas.tokens}
            />
          </div>

          {/* stat cards row 2 */}
          <div className="grid grid-cols-4 gap-1.5">
            <StatCard
              label="Active Keys (today)"
              value={String(stats.activeKeysToday)}
              sublabel={`${stats.activeKeysWeek} this week, ${stats.activeKeysMonth} this month`}
            />
            <Link href="/dashboard/admin/requests?status=error">
              <ThresholdStatCard
                label="Error Rate"
                value={`${stats.errorRate.toFixed(1)}%`}
                sublabel={stats.errorRate > 5 ? 'above threshold' : 'healthy'}
                delta={deltas.errorRate}
                rawValue={stats.errorRate}
                thresholds={{ amber: 2, red: 5 }}
              />
            </Link>
            <ThresholdStatCard
              label="Avg Latency"
              value={`${stats.avgLatencyMs}ms`}
              sublabel={stats.avgTokensPerReq > 0 ? `~${stats.avgTokensPerReq.toLocaleString()} tokens/req` : 'across all providers'}
              delta={deltas.avgLatency}
              rawValue={stats.avgLatencyMs}
              thresholds={{ amber: 2000, red: 5000 }}
            />
            <ThresholdStatCard
              label="p95 Latency"
              value={`${stats.p95LatencyMs}ms`}
              sublabel="95th percentile"
              delta={deltas.p95Latency}
              rawValue={stats.p95LatencyMs}
              thresholds={{ amber: 3000, red: 8000 }}
            />
          </div>

          {/* charts */}
          <div className="grid grid-cols-2 gap-1.5">
            <div className="rounded-lg border border-border bg-card p-2">
              <div className="mb-1 border-b border-[#1a1a1a] pb-1">
                <h2 className="text-xs font-medium">Platform Spend</h2>
                <p className="text-[10px] text-muted-foreground">Hourly, all users</p>
              </div>
              <CostChart data={timeseries} />
            </div>
            <div className="rounded-lg border border-border bg-card p-2">
              <div className="mb-1 border-b border-[#1a1a1a] pb-1">
                <h2 className="text-xs font-medium">Request Volume</h2>
                <p className="text-[10px] text-muted-foreground">Per hour, platform-wide</p>
              </div>
              <RequestChart data={timeseries} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <div className="rounded-lg border border-border bg-card p-2">
              <div className="mb-1 border-b border-[#1a1a1a] pb-1">
                <h2 className="text-xs font-medium">Token Usage</h2>
                <p className="text-[10px] text-muted-foreground">Input/output, platform-wide</p>
              </div>
              <TokenChart data={timeseries} />
            </div>
            <div className="rounded-lg border border-border bg-card p-2">
              <div className="mb-1 border-b border-[#1a1a1a] pb-1">
                <h2 className="text-xs font-medium">Spend by Provider</h2>
                <p className="text-[10px] text-muted-foreground">Cost distribution</p>
              </div>
              <ProviderChart data={providerSpend} />
            </div>
          </div>
        </div>
      </div>

      {/* Infrastructure */}
      <div style={{ display: activeTab === 'infra' ? 'block' : 'none' }}>
        <div className="space-y-1.5">
          {providerHealth.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-2">
              <div className="mb-1 border-b border-[#1a1a1a] pb-1">
                <h2 className="text-xs font-medium">Provider Health</h2>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="pb-1">Provider</th>
                    <th className="pb-1 text-right">Reqs</th>
                    <th className="pb-1 text-right">Success</th>
                    <th className="pb-1 text-right">Last Error</th>
                    <th className="pb-1 text-right">Avg ms</th>
                    <th className="pb-1 text-right">p95 ms</th>
                    <th className="pb-1 text-right">Spend</th>
                  </tr>
                </thead>
                <tbody>
                  {providerHealth.map((p) => (
                    <tr key={p.provider} className="border-t border-[#1a1a1a]">
                      <td className="py-1 text-xs font-medium">
                        <Link href={`/dashboard/admin/requests?provider=${p.provider}`} className="text-primary hover:underline">{p.provider}</Link>
                      </td>
                      <td className="py-1 text-right text-xs">{p.requests}</td>
                      <td className={`py-1 text-right text-xs font-mono ${p.successRate < 95 ? 'text-red-400' : 'text-emerald-400'}`}>
                        {p.successRate < 100 ? (
                          <Link href={`/dashboard/admin/requests?provider=${p.provider}&status=error`} className="hover:underline">{p.successRate}%</Link>
                        ) : <>{p.successRate}%</>}
                      </td>
                      <td className="py-1 text-right text-xs text-muted-foreground">{p.lastErrorAt ? timeAgo(p.lastErrorAt) : '-'}</td>
                      <td className="py-1 text-right text-xs text-muted-foreground">{p.avgLatencyMs.toLocaleString()}</td>
                      <td className="py-1 text-right text-xs text-muted-foreground">{p.p95LatencyMs.toLocaleString()}</td>
                      <td className="py-1 text-right font-mono text-xs">{formatCents(p.spendCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {topModels.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-2">
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
                        <td className="py-1 font-mono text-xs">
                          <Link href={`/dashboard/admin/requests?model=${encodeURIComponent(m.model)}`} className="text-primary hover:underline">{m.model}</Link>
                        </td>
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
        </div>
      </div>

      {/* Ecosystem */}
      <div style={{ display: activeTab === 'ecosystem' ? 'block' : 'none' }}>
        <EcosystemPanel accountCount={accounts.length} activeUserCount={activeUsers} />
      </div>

      {/* Users */}
      <div style={{ display: activeTab === 'users' ? 'block' : 'none' }}>
        <div className="space-y-1.5">
          {userBreakdown.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-2">
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
                          <Link href={`/dashboard/admin/requests?user=${u.userId}`} className="text-primary hover:underline">
                            {u.note || `${u.userId.slice(0, 12)}...`}
                          </Link>
                        </td>
                        <td className="py-1 text-xs text-muted-foreground">{u.plan}</td>
                        <td className="py-1 text-right text-xs">{u.requests}</td>
                        <td className="py-1 text-right font-mono text-xs">{formatCents(u.spendCents)}</td>
                        <td className="py-1 text-right text-xs">
                          {u.errors > 0 ? (
                            <Link href={`/dashboard/admin/requests?user=${u.userId}&status=error`} className="text-red-400 hover:underline">{u.errors}</Link>
                          ) : ''}
                        </td>
                        <td className="py-1 text-right text-xs">{u.avgLatencyMs}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="rounded-lg border border-border bg-card p-2">
            <div className="mb-1 border-b border-[#1a1a1a] pb-1">
              <h2 className="text-xs font-medium">Accounts ({accounts.length})</h2>
            </div>
            <AccountTable accounts={accounts} />
          </div>
        </div>
      </div>

      {/* Alerts */}
      <div style={{ display: activeTab === 'alerts' ? 'block' : 'none' }}>
        <AlertsPanel />
      </div>
    </div>
  );
}
