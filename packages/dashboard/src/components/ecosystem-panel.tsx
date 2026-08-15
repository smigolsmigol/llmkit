'use client';

import { useEffect, useState } from 'react';
import { PackageDownloadsChart } from '@/components/charts/package-downloads';
import { Sparkline } from '@/components/charts/sparkline';
import type { EcosystemAnalyticsSnapshot } from '@/lib/ecosystem-analytics';

interface EcosystemPanelProps {
  accountCount: number;
  activeUserCount: number;
}

function fmt(n: number | null): string {
  if (n === null) return 'n/a';
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

function SignalBar({ label, value, max, color }: { label: string; value: number | null; max: number; color: string }) {
  const numericValue = value ?? 0;
  const pct = max > 0 && value !== null ? Math.max((numericValue / max) * 100, 3) : 0;
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

function buildNpmSparkline(packages: EcosystemAnalyticsSnapshot['npm']): number[] {
  const dailyMap = new Map<string, number>();
  for (const pkg of packages) {
    for (const day of pkg.daily) {
      dailyMap.set(day.day, (dailyMap.get(day.day) ?? 0) + day.count);
    }
  }
  return Array.from(dailyMap.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, count]) => count);
}

function summarizeEcosystem(
  data: EcosystemAnalyticsSnapshot,
  accountCount: number,
  activeUserCount: number,
) {
  const availableNpmPackages = data.npm.filter((pkg) => pkg.status === 'ok').length;
  const npmWeekly = availableNpmPackages > 0
    ? data.npm.reduce((sum, pkg) => sum + (pkg.weekly ?? 0), 0)
    : null;
  const npmMonthly = availableNpmPackages > 0
    ? data.npm.reduce((sum, pkg) => sum + (pkg.monthly ?? 0), 0)
    : null;
  const sortedByWeekly = [...data.npm].sort((a, b) => (b.weekly ?? -1) - (a.weekly ?? -1));
  const servicesUp = data.health.filter((health) => health.status === 'up').length;
  const maxSignal = Math.max(
    npmWeekly ?? 0,
    data.pypi.weekly ?? 0,
    data.github.stars ?? 0,
    accountCount,
    activeUserCount,
    1,
  );
  const monthlyTotal = npmMonthly === null && data.pypi.monthly === null
    ? null
    : (npmMonthly ?? 0) + (data.pypi.monthly ?? 0);

  return {
    availableNpmPackages,
    npmWeekly,
    sortedByWeekly,
    servicesUp,
    allUp: servicesUp === data.health.length && data.health.length > 0,
    npmSparkline: buildNpmSparkline(data.npm),
    maxSignal,
    maxWeekly: Math.max(sortedByWeekly[0]?.weekly ?? 0, data.pypi.weekly ?? 0),
    monthlyTotal,
    monthlyTotalIsPartial: availableNpmPackages < data.npm.length || data.pypi.monthly === null,
  };
}

export function EcosystemPanel({ accountCount, activeUserCount }: EcosystemPanelProps) {
  const [data, setData] = useState<EcosystemAnalyticsSnapshot | null>(null);
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-1.5">
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

  return <EcosystemContent data={data} accountCount={accountCount} activeUserCount={activeUserCount} />;
}

function EcosystemContent({
  data,
  accountCount,
  activeUserCount,
}: EcosystemPanelProps & { data: EcosystemAnalyticsSnapshot }) {
  const {
    availableNpmPackages,
    npmWeekly,
    sortedByWeekly,
    servicesUp,
    allUp,
    npmSparkline,
    maxSignal,
    maxWeekly,
    monthlyTotal,
    monthlyTotalIsPartial,
  } = summarizeEcosystem(data, accountCount, activeUserCount);

  return (
    <div className="space-y-1.5">
      {/* ecosystem stat cards with sparklines */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-1.5">
        <div className="glow-hover rounded-lg border border-[#2a2a2a] bg-card p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">npm downloads</p>
            <span className="text-[10px] text-muted-foreground">{availableNpmPackages}/{data.npm.length} pkgs</span>
          </div>
          <p className="mt-0.5 font-mono text-2xl font-bold text-violet-400">{fmt(npmWeekly)}</p>
          <div className="text-[10px] text-muted-foreground">7d registry count, includes automation</div>
          <Sparkline data={npmSparkline} color="#7c3aed" height={28} />
        </div>

        <div className="glow-hover rounded-lg border border-[#2a2a2a] bg-card p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">PyPI Weekly</p>
            <span className="text-[10px] text-muted-foreground">{data.pypi.name}</span>
          </div>
          <p className="mt-0.5 font-mono text-2xl font-bold text-amber-400">{fmt(data.pypi.weekly)}</p>
          <div className="mt-1 text-[10px] text-muted-foreground">{fmt(data.pypi.monthly)} over 30d</div>
        </div>

        <div className="glow-hover rounded-lg border border-[#2a2a2a] bg-card p-3">
          <p className="text-xs text-muted-foreground">GitHub</p>
          <p className="mt-0.5 font-mono text-2xl font-bold">{fmt(data.github.stars)}</p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {fmt(data.github.forks)} forks, {fmt(data.github.openItems)} open items, {fmt(data.github.watchers)} watching
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

      {/* download trend + adoption signals */}
      <div className="grid grid-cols-2 gap-1.5">
        <div className="rounded-lg border border-[#2a2a2a] bg-card p-2">
          <div className="mb-1 border-b border-[#1a1a1a] pb-1">
            <h2 className="text-xs font-medium">Daily Downloads</h2>
            <p className="text-[10px] text-muted-foreground">raw registry counts, last 14 days</p>
          </div>
          <PackageDownloadsChart packages={data.npm} />
        </div>

        <div className="rounded-lg border border-[#2a2a2a] bg-card p-2">
          <div className="mb-1 border-b border-[#1a1a1a] pb-1">
            <h2 className="text-xs font-medium">Adoption signals</h2>
            <p className="text-[10px] text-muted-foreground">directional counts, not one conversion cohort</p>
          </div>
          <div className="space-y-1.5 py-2">
            <SignalBar label="npm 7d" value={npmWeekly} max={maxSignal} color="bg-violet-600" />
            <SignalBar label="PyPI 7d" value={data.pypi.weekly} max={maxSignal} color="bg-amber-500" />
            <SignalBar label="Stars" value={data.github.stars} max={maxSignal} color="bg-blue-500" />
            <SignalBar label="Accounts" value={accountCount} max={maxSignal} color="bg-teal-500" />
            <SignalBar label="Active" value={activeUserCount} max={maxSignal} color="bg-emerald-500" />
          </div>
          <div className="border-t border-[#1a1a1a] pt-1">
            <p className="text-[10px] text-muted-foreground">
              Downloads are not unique installs. No install-to-account conversion is inferred.
            </p>
          </div>
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
              const maxMs = Math.max(...data.health.map((h) => h.latencyMs ?? 0), 1);
              const pct = svc.latencyMs === null ? 0 : Math.min((svc.latencyMs / maxMs) * 100, 100);
              const barColor = svc.latencyMs !== null && svc.latencyMs < 100
                ? 'bg-emerald-400'
                : svc.latencyMs !== null && svc.latencyMs < 300 ? 'bg-amber-400' : 'bg-red-400';
              return (
                <div key={svc.service} className="flex items-center gap-2">
                  <StatusDot status={svc.status} />
                  <span className="w-20 shrink-0 text-xs font-medium">{svc.service}</span>
                  <div className="h-1.5 flex-1 rounded-full bg-[#1a1a1a]">
                    <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-12 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
                    {svc.latencyMs === null ? 'n/a' : `${svc.latencyMs}ms`}
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
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-1">Package</th>
                <th className="pb-1 text-right">Weekly</th>
                <th className="w-24 pb-1" />
                <th className="pb-1 text-right">30d</th>
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
                        style={{ width: `${maxWeekly > 0 && pkg.weekly !== null ? Math.max((pkg.weekly / maxWeekly) * 100, 1) : 0}%` }}
                      />
                    </div>
                  </td>
                  <td className="py-1 text-right font-mono text-[11px] text-muted-foreground">{fmt(pkg.monthly)}</td>
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
                      style={{ width: `${maxWeekly > 0 && data.pypi.weekly !== null ? Math.max((data.pypi.weekly / maxWeekly) * 100, 1) : 0}%` }}
                    />
                  </div>
                </td>
                <td className="py-1 text-right font-mono text-[11px] text-muted-foreground">{fmt(data.pypi.monthly)}</td>
              </tr>
            </tbody>
          </table></div>
          <div className="mt-1 flex justify-between border-t border-[#2a2a2a] pt-1 text-[10px]">
            <span className="font-medium">Total</span>
            <span className="font-mono text-muted-foreground">
              {fmt(monthlyTotal)} over 30d{monthlyTotalIsPartial ? ' (partial)' : ''}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
