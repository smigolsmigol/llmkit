'use client';

import { useEffect, useState } from 'react';
import { DownloadTrendChart } from '@/components/charts/download-trend';
import { Sparkline } from '@/components/charts/sparkline';

interface NpmPackage {
  name: string;
  weekly: number;
  total: number;
  recent: number;
  recentDay: string;
  daily: Array<{ day: string; count: number }>;
}

interface PypiStats {
  name: string;
  weekly: number;
  total: number;
}

interface GithubStats {
  stars: number;
  forks: number;
  openIssues: number;
  watchers: number;
}

interface HealthEntry {
  service: string;
  status: 'up' | 'down' | 'degraded';
  latencyMs: number;
  lastCheck: string;
}

interface AnalyticsData {
  npm: NpmPackage[];
  pypi: PypiStats;
  github: GithubStats;
  health: HealthEntry[];
  updatedAt: string;
}

interface EcosystemPanelProps {
  accountCount: number;
  activeUserCount: number;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function shortName(name: string): string {
  return name.replace('@f3d1/', '');
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function StatusDot({ status }: { status: string }) {
  const color = status === 'up' ? 'bg-emerald-400' : status === 'degraded' ? 'bg-amber-400' : 'bg-red-400';
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

function FunnelBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max((value / max) * 100, 3) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-right text-[11px] text-muted-foreground">{label}</span>
      <div className="relative h-5 flex-1 rounded bg-[#1a1a1a]">
        <div className={`absolute inset-y-0 left-0 rounded ${color}`} style={{ width: `${pct}%` }} />
        <span className="absolute inset-y-0 left-1.5 flex items-center font-mono text-[10px] font-medium text-white/80">
          {fmt(value)}
        </span>
      </div>
    </div>
  );
}

export function EcosystemPanel({ accountCount, activeUserCount }: EcosystemPanelProps) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/analytics', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-1.5">
        <div className="grid grid-cols-4 gap-1.5">
          {['s1', 's2', 's3', 's4'].map((id) => (
            <div key={id} className="h-24 animate-pulse rounded-lg border border-[#2a2a2a] bg-card" />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <div className="h-48 animate-pulse rounded-lg border border-[#2a2a2a] bg-card" />
          <div className="h-48 animate-pulse rounded-lg border border-[#2a2a2a] bg-card" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-lg border border-[#2a2a2a] bg-card p-4 text-center text-xs text-muted-foreground">
        Analytics API unavailable
      </div>
    );
  }

  const totalNpmWeekly = data.npm.reduce((s, p) => s + p.weekly, 0);
  const sortedByWeekly = [...data.npm].sort((a, b) => b.weekly - a.weekly);
  const servicesUp = data.health.filter((h) => h.status === 'up').length;
  const allUp = servicesUp === data.health.length && data.health.length > 0;

  // aggregate daily downloads across all npm packages
  const dailyMap = new Map<string, number>();
  for (const pkg of data.npm) {
    for (const d of pkg.daily) {
      dailyMap.set(d.day, (dailyMap.get(d.day) ?? 0) + d.count);
    }
  }
  const aggregatedDaily = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, count]) => ({ day, count }));

  // sparkline data: daily totals
  const npmSparkline = aggregatedDaily.map((d) => d.count);

  // max for bar scaling in funnel
  const funnelMax = totalNpmWeekly + data.pypi.weekly;

  const maxWeekly = Math.max(sortedByWeekly[0]?.weekly ?? 0, data.pypi.weekly);
  const grandTotal = data.npm.reduce((s, p) => s + p.total, 0) + data.pypi.total;

  return (
    <div className="space-y-1.5">
      {/* ecosystem stat cards with sparklines */}
      <div className="grid grid-cols-4 gap-1.5">
        <div className="glow-hover rounded-lg border border-[#2a2a2a] bg-card p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">npm Weekly</p>
            <span className="text-[10px] text-muted-foreground">{data.npm.length} pkgs</span>
          </div>
          <p className="mt-0.5 font-mono text-2xl font-bold text-violet-400">{fmt(totalNpmWeekly)}</p>
          <Sparkline data={npmSparkline} color="#7c3aed" height={28} />
        </div>

        <div className="glow-hover rounded-lg border border-[#2a2a2a] bg-card p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">PyPI Weekly</p>
            <span className="text-[10px] text-muted-foreground">{data.pypi.name}</span>
          </div>
          <p className="mt-0.5 font-mono text-2xl font-bold text-amber-400">{fmt(data.pypi.weekly)}</p>
          <div className="mt-1 text-[10px] text-muted-foreground">{fmt(data.pypi.total)} monthly</div>
        </div>

        <div className="glow-hover rounded-lg border border-[#2a2a2a] bg-card p-3">
          <p className="text-xs text-muted-foreground">GitHub</p>
          <p className="mt-0.5 font-mono text-2xl font-bold">{fmt(data.github.stars)}</p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {data.github.forks} forks, {data.github.openIssues} issues, {data.github.watchers} watching
          </p>
        </div>

        <div className="glow-hover rounded-lg border border-[#2a2a2a] bg-card p-3">
          <p className="text-xs text-muted-foreground">Services</p>
          <p className={`mt-0.5 font-mono text-2xl font-bold ${allUp ? 'text-emerald-400' : 'text-red-400'}`}>
            {servicesUp}/{data.health.length}
          </p>
          <div className="mt-1 flex gap-1">
            {data.health.map((h) => (
              <StatusDot key={h.service} status={h.status} />
            ))}
          </div>
        </div>
      </div>

      {/* download trend + conversion funnel */}
      <div className="grid grid-cols-2 gap-1.5">
        <div className="rounded-lg border border-[#2a2a2a] bg-card p-2">
          <div className="mb-1 border-b border-[#1a1a1a] pb-1">
            <h2 className="text-xs font-medium">Download Trends</h2>
            <p className="text-[10px] text-muted-foreground">npm (all packages) + PyPI, last 14 days</p>
          </div>
          <DownloadTrendChart npmDaily={aggregatedDaily} />
        </div>

        <div className="rounded-lg border border-[#2a2a2a] bg-card p-2">
          <div className="mb-1 border-b border-[#1a1a1a] pb-1">
            <h2 className="text-xs font-medium">Conversion Funnel</h2>
            <p className="text-[10px] text-muted-foreground">weekly installs to active users</p>
          </div>
          <div className="space-y-1.5 py-2">
            <FunnelBar label="Installs" value={funnelMax} max={funnelMax} color="bg-violet-600" />
            <FunnelBar label="Stars" value={data.github.stars} max={funnelMax} color="bg-blue-500" />
            <FunnelBar label="Signups" value={accountCount} max={funnelMax} color="bg-teal-500" />
            <FunnelBar label="Active" value={activeUserCount} max={funnelMax} color="bg-emerald-500" />
          </div>
          {funnelMax > 0 && (
            <div className="border-t border-[#1a1a1a] pt-1">
              <p className="text-[10px] text-muted-foreground">
                {accountCount > 0 ? ((activeUserCount / accountCount) * 100).toFixed(0) : 0}% activation rate,{' '}
                {funnelMax > 0 ? ((accountCount / funnelMax) * 100).toFixed(1) : 0}% install-to-signup
              </p>
            </div>
          )}
        </div>
      </div>

      {/* service health + package breakdown side by side */}
      <div className="grid grid-cols-2 gap-1.5">
        <div className="rounded-lg border border-[#2a2a2a] bg-card p-2">
          <div className="mb-1 border-b border-[#1a1a1a] pb-1">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-medium">Service Health</h2>
              {data.updatedAt && (
                <span className="text-[10px] text-muted-foreground">{timeAgo(data.updatedAt)}</span>
              )}
            </div>
          </div>
          <div className="space-y-1.5 py-1">
            {data.health.map((svc) => {
              const maxMs = Math.max(...data.health.map((h) => h.latencyMs), 1);
              const pct = Math.min((svc.latencyMs / maxMs) * 100, 100);
              const barColor = svc.latencyMs < 100 ? 'bg-emerald-400' : svc.latencyMs < 300 ? 'bg-amber-400' : 'bg-red-400';
              return (
                <div key={svc.service} className="flex items-center gap-2">
                  <StatusDot status={svc.status} />
                  <span className="w-20 shrink-0 text-xs font-medium">{svc.service}</span>
                  <div className="h-1.5 flex-1 rounded-full bg-[#1a1a1a]">
                    <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-12 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
                    {svc.latencyMs}ms
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-lg border border-[#2a2a2a] bg-card p-2">
          <div className="mb-1 border-b border-[#1a1a1a] pb-1">
            <h2 className="text-xs font-medium">Package Breakdown</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-1">Package</th>
                <th className="pb-1 text-right">Weekly</th>
                <th className="w-24 pb-1" />
                <th className="pb-1 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {sortedByWeekly.map((pkg) => (
                <tr key={pkg.name} className="border-t border-[#1a1a1a]">
                  <td className="py-1 font-mono text-[11px]">{shortName(pkg.name)}</td>
                  <td className="py-1 text-right font-mono text-[11px] font-medium">{fmt(pkg.weekly)}</td>
                  <td className="py-1 px-1.5">
                    <div className="h-1.5 w-full rounded-full bg-[#1a1a1a]">
                      <div
                        className="h-1.5 rounded-full bg-violet-500"
                        style={{ width: `${maxWeekly > 0 ? Math.max((pkg.weekly / maxWeekly) * 100, 1) : 0}%` }}
                      />
                    </div>
                  </td>
                  <td className="py-1 text-right font-mono text-[11px] text-muted-foreground">{fmt(pkg.total)}</td>
                </tr>
              ))}
              <tr className="border-t border-[#2a2a2a]">
                <td className="py-1 font-mono text-[11px]">
                  <span className="rounded bg-[#1a1a1a] px-1 py-0.5 text-[9px] text-amber-400">PyPI</span>{' '}
                  {data.pypi.name}
                </td>
                <td className="py-1 text-right font-mono text-[11px] font-medium">{fmt(data.pypi.weekly)}</td>
                <td className="py-1 px-1.5">
                  <div className="h-1.5 w-full rounded-full bg-[#1a1a1a]">
                    <div
                      className="h-1.5 rounded-full bg-amber-500"
                      style={{ width: `${maxWeekly > 0 ? Math.max((data.pypi.weekly / maxWeekly) * 100, 1) : 0}%` }}
                    />
                  </div>
                </td>
                <td className="py-1 text-right font-mono text-[11px] text-muted-foreground">{fmt(data.pypi.total)}</td>
              </tr>
            </tbody>
          </table>
          <div className="mt-1 flex justify-between border-t border-[#2a2a2a] pt-1 text-[10px]">
            <span className="font-medium">Total</span>
            <span className="font-mono text-muted-foreground">{fmt(grandTotal)} all time</span>
          </div>
        </div>
      </div>
    </div>
  );
}
