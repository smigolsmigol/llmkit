'use client';

import { useEffect, useState } from 'react';

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

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'up'
      ? 'bg-emerald-400'
      : status === 'degraded'
        ? 'bg-amber-400'
        : 'bg-red-400';
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} />;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function shortName(name: string): string {
  return name.replace('@f3d1/', '');
}

function SkeletonCard() {
  return (
    <div className="glow-hover rounded-lg border border-[#2a2a2a] bg-card p-4">
      <div className="h-3 w-24 animate-pulse rounded bg-[#1a1a1a]" />
      <div className="mt-2 h-7 w-16 animate-pulse rounded bg-[#1a1a1a]" />
      <div className="mt-2 h-3 w-20 animate-pulse rounded bg-[#1a1a1a]" />
    </div>
  );
}

function SkeletonBlock({ height }: { height: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg border border-[#2a2a2a] bg-card ${height}`}
    />
  );
}

function BarInline({
  value,
  max,
  color = 'bg-violet-500',
}: {
  value: number;
  max: number;
  color?: string;
}) {
  const pct = max > 0 ? Math.max((value / max) * 100, 1) : 0;
  return (
    <div className="h-1.5 w-full rounded-full bg-[#1a1a1a]">
      <div
        className={`h-1.5 rounded-full ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function LatencyBar({ ms, maxMs }: { ms: number; maxMs: number }) {
  const pct = maxMs > 0 ? Math.min((ms / maxMs) * 100, 100) : 0;
  const color =
    ms < 100
      ? 'bg-emerald-400'
      : ms < 300
        ? 'bg-amber-400'
        : 'bg-red-400';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 rounded-full bg-[#1a1a1a]">
        <div
          className={`h-1.5 rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="font-mono text-xs text-muted-foreground">{ms}ms</span>
    </div>
  );
}

export function AnalyticsView() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    fetch('/api/analytics', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  if (loading) {
    return (
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold">Analytics</h1>
        <div className="grid grid-cols-3 gap-1.5 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <SkeletonBlock height="h-56" />
          <SkeletonBlock height="h-56" />
        </div>
        <SkeletonBlock height="h-48" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold">Analytics</h1>
        <div className="rounded-lg border border-[#2a2a2a] bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {error === 'analytics not configured'
              ? 'Analytics API not configured. Set ANALYTICS_API_URL in environment.'
              : `Analytics unavailable: ${error || 'no data'}`}
          </p>
        </div>
      </div>
    );
  }

  const totalNpmWeekly = data.npm.reduce((sum, p) => sum + p.weekly, 0);
  const totalNpmAll = data.npm.reduce((sum, p) => sum + p.total, 0);
  const sortedByWeekly = [...data.npm].sort((a, b) => b.weekly - a.weekly);
  const topPkg = sortedByWeekly[0];
  const maxWeekly = topPkg?.weekly ?? 0;
  const servicesUp = data.health.filter((h) => h.status === 'up').length;
  const servicesTotal = data.health.length;
  const allUp = servicesUp === servicesTotal && servicesTotal > 0;
  const maxLatency = Math.max(...data.health.map((h) => h.latencyMs), 1);

  return (
    <div className="space-y-1.5">
      {/* header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Analytics</h1>
        <div className="flex items-center gap-2">
          {data.updatedAt && (
            <span className="text-xs text-muted-foreground">
              updated {timeAgo(data.updatedAt)}
            </span>
          )}
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            className="rounded px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            refresh
          </button>
        </div>
      </div>

      {/* stat cards: 6 across */}
      <div className="grid grid-cols-3 gap-1.5 lg:grid-cols-6">
        <div className="glow-hover rounded-lg border border-[#2a2a2a] bg-card p-4">
          <p className="text-xs text-muted-foreground">npm Weekly</p>
          <p className="mt-1 font-mono text-2xl font-semibold text-emerald-400">
            {formatNumber(totalNpmWeekly)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {data.npm.length} packages
          </p>
        </div>

        <div className="glow-hover rounded-lg border border-[#2a2a2a] bg-card p-4">
          <p className="text-xs text-muted-foreground">Top Package</p>
          <p className="mt-1 font-mono text-2xl font-semibold">
            {topPkg ? formatNumber(topPkg.weekly) : '-'}
          </p>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {topPkg ? shortName(topPkg.name) : 'n/a'}
          </p>
        </div>

        <div className="glow-hover rounded-lg border border-[#2a2a2a] bg-card p-4">
          <p className="text-xs text-muted-foreground">PyPI Weekly</p>
          <p className="mt-1 font-mono text-2xl font-semibold">
            {formatNumber(data.pypi.weekly)}
          </p>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {data.pypi.name}
          </p>
        </div>

        <div className="glow-hover rounded-lg border border-[#2a2a2a] bg-card p-4">
          <p className="text-xs text-muted-foreground">GitHub Stars</p>
          <p className="mt-1 font-mono text-2xl font-semibold">
            {formatNumber(data.github.stars)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {data.github.forks} forks, {data.github.watchers} watching
          </p>
        </div>

        <div className="glow-hover rounded-lg border border-[#2a2a2a] bg-card p-4">
          <p className="text-xs text-muted-foreground">Open Issues</p>
          <p className={`mt-1 font-mono text-2xl font-semibold ${data.github.openIssues > 20 ? 'text-amber-400' : ''}`}>
            {data.github.openIssues}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">GitHub</p>
        </div>

        <div className="glow-hover rounded-lg border border-[#2a2a2a] bg-card p-4">
          <p className="text-xs text-muted-foreground">Services</p>
          <p className={`mt-1 font-mono text-2xl font-semibold ${allUp ? 'text-emerald-400' : 'text-red-400'}`}>
            {servicesUp}/{servicesTotal}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {allUp ? 'all healthy' : 'degraded'}
          </p>
        </div>
      </div>

      {/* second row: bar chart + health grid */}
      <div className="grid grid-cols-2 gap-1.5">
        {/* npm downloads horizontal bar chart */}
        <div className="rounded-lg border border-[#2a2a2a] bg-card p-2">
          <div className="mb-1 border-b border-[#1a1a1a] pb-1">
            <h2 className="text-xs font-medium">npm Weekly Downloads</h2>
            <p className="text-[10px] text-muted-foreground">Per package, last 7 days</p>
          </div>
          <div className="space-y-1 py-1">
            {sortedByWeekly.map((pkg) => {
              const pct = maxWeekly > 0 ? (pkg.weekly / maxWeekly) * 100 : 0;
              return (
                <div key={pkg.name} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 truncate text-right font-mono text-[11px] text-muted-foreground">
                    {shortName(pkg.name)}
                  </span>
                  <div className="relative h-5 flex-1 rounded bg-[#1a1a1a]">
                    <div
                      className="absolute inset-y-0 left-0 rounded bg-violet-600"
                      style={{ width: `${Math.max(pct, 2)}%` }}
                    />
                    <span className="absolute inset-y-0 left-1.5 flex items-center font-mono text-[10px] font-medium text-white/80">
                      {formatNumber(pkg.weekly)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* service health */}
        <div className="rounded-lg border border-[#2a2a2a] bg-card p-2">
          <div className="mb-1 border-b border-[#1a1a1a] pb-1">
            <h2 className="text-xs font-medium">Service Health</h2>
            <p className="text-[10px] text-muted-foreground">Status and response times</p>
          </div>
          <div className="space-y-2 py-1">
            {data.health.map((svc) => (
              <div key={svc.service} className="flex items-center gap-3">
                <StatusDot status={svc.status} />
                <span className="w-20 shrink-0 text-xs font-medium">{svc.service}</span>
                <div className="flex-1">
                  <LatencyBar ms={svc.latencyMs} maxMs={maxLatency} />
                </div>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {timeAgo(svc.lastCheck)}
                </span>
              </div>
            ))}
          </div>
          {data.health.length > 0 && (
            <div className="mt-1 border-t border-[#1a1a1a] pt-1">
              <p className="text-[10px] text-muted-foreground">
                avg {Math.round(data.health.reduce((s, h) => s + h.latencyMs, 0) / data.health.length)}ms across {servicesTotal} services
              </p>
            </div>
          )}
        </div>
      </div>

      {/* third row: package details table */}
      {data.npm.length > 0 && (
        <div className="rounded-lg border border-[#2a2a2a] bg-card p-2">
          <div className="mb-1 border-b border-[#1a1a1a] pb-1">
            <h2 className="text-xs font-medium">Package Breakdown</h2>
            <p className="text-[10px] text-muted-foreground">
              {data.npm.length} npm packages + 1 PyPI
            </p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-1">Package</th>
                <th className="pb-1 text-right">Daily Avg</th>
                <th className="pb-1 text-right">Weekly</th>
                <th className="w-32 pb-1" />
                <th className="pb-1 text-right">Total</th>
                <th className="pb-1 text-right">% of Total</th>
              </tr>
            </thead>
            <tbody>
              {sortedByWeekly.map((pkg) => {
                const pctOfTotal =
                  totalNpmAll > 0
                    ? ((pkg.total / totalNpmAll) * 100).toFixed(1)
                    : '0.0';
                return (
                  <tr key={pkg.name} className="border-t border-[#1a1a1a]">
                    <td className="py-1.5 font-mono text-xs">{pkg.name}</td>
                    <td className="py-1.5 text-right font-mono text-xs text-muted-foreground">
                      {pkg.weekly > 0 ? Math.round(pkg.weekly / 7) : '-'}
                    </td>
                    <td className="py-1.5 text-right font-mono text-xs font-medium">
                      {formatNumber(pkg.weekly)}
                    </td>
                    <td className="py-1.5 px-2">
                      <BarInline value={pkg.weekly} max={maxWeekly} />
                    </td>
                    <td className="py-1.5 text-right font-mono text-xs text-muted-foreground">
                      {formatNumber(pkg.total)}
                    </td>
                    <td className="py-1.5 text-right font-mono text-xs text-muted-foreground">
                      {pctOfTotal}%
                    </td>
                  </tr>
                );
              })}
              {/* pypi row */}
              <tr className="border-t border-[#2a2a2a]">
                <td className="py-1.5 font-mono text-xs">
                  <span className="rounded bg-[#1a1a1a] px-1 py-0.5 text-[10px] text-amber-400">
                    PyPI
                  </span>{' '}
                  {data.pypi.name}
                </td>
                <td className="py-1.5 text-right font-mono text-xs text-muted-foreground">
                  {data.pypi.weekly > 0 ? Math.round(data.pypi.weekly / 7) : '-'}
                </td>
                <td className="py-1.5 text-right font-mono text-xs font-medium">
                  {formatNumber(data.pypi.weekly)}
                </td>
                <td className="py-1.5 px-2">
                  <BarInline
                    value={data.pypi.weekly}
                    max={maxWeekly}
                    color="bg-amber-500"
                  />
                </td>
                <td className="py-1.5 text-right font-mono text-xs text-muted-foreground">
                  {formatNumber(data.pypi.total)}
                </td>
                <td className="py-1.5 text-right font-mono text-xs text-muted-foreground">
                  -
                </td>
              </tr>
            </tbody>
          </table>
          {/* totals row outside table for clean border */}
          <div className="mt-1 flex items-center justify-between border-t border-[#2a2a2a] pt-1">
            <span className="text-xs font-medium">Total</span>
            <div className="flex gap-6">
              <span className="font-mono text-xs font-medium">
                {formatNumber(totalNpmWeekly + data.pypi.weekly)} weekly
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {formatNumber(totalNpmAll + data.pypi.total)} all time
              </span>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
