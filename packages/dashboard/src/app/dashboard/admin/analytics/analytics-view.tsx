'use client';

import { useEffect, useState } from 'react';
import { StatCard } from '@/components/stat-card';

interface NpmPackage {
  name: string;
  weekly: number;
  total: number;
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
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
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
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

export function AnalyticsView() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/analytics')
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
  }, []);

  if (loading) {
    return (
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold">Analytics</h1>
        <div className="grid grid-cols-4 gap-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg border border-[#2a2a2a] bg-card" />
          ))}
        </div>
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

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Analytics</h1>
        {data.updatedAt && (
          <span className="text-xs text-muted-foreground">
            updated {timeAgo(data.updatedAt)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        <StatCard
          label="npm Downloads (weekly)"
          value={formatNumber(totalNpmWeekly)}
          sublabel={`${data.npm.length} packages`}
        />
        <StatCard
          label="PyPI Downloads (weekly)"
          value={formatNumber(data.pypi.weekly)}
          sublabel={data.pypi.name}
        />
        <StatCard
          label="GitHub Stars"
          value={formatNumber(data.github.stars)}
          sublabel={`${data.github.forks} forks, ${data.github.openIssues} issues`}
        />
        <StatCard
          label="GitHub Watchers"
          value={formatNumber(data.github.watchers)}
        />
      </div>

      {data.npm.length > 0 && (
        <div className="rounded-lg border border-[#2a2a2a] bg-card p-2">
          <div className="mb-1 border-b border-[#1a1a1a] pb-1">
            <h2 className="text-xs font-medium">npm Packages</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-1">Package</th>
                <th className="pb-1 text-right">Weekly</th>
                <th className="pb-1 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.npm.map((pkg) => (
                <tr key={pkg.name} className="border-t border-[#1a1a1a]">
                  <td className="py-1 font-mono text-xs">{pkg.name}</td>
                  <td className="py-1 text-right font-mono text-xs">{formatNumber(pkg.weekly)}</td>
                  <td className="py-1 text-right font-mono text-xs text-muted-foreground">{formatNumber(pkg.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.health.length > 0 && (
        <div className="rounded-lg border border-[#2a2a2a] bg-card p-2">
          <div className="mb-1 border-b border-[#1a1a1a] pb-1">
            <h2 className="text-xs font-medium">Service Health</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-1">Service</th>
                <th className="pb-1">Status</th>
                <th className="pb-1 text-right">Latency</th>
                <th className="pb-1 text-right">Last Check</th>
              </tr>
            </thead>
            <tbody>
              {data.health.map((svc) => (
                <tr key={svc.service} className="border-t border-[#1a1a1a]">
                  <td className="py-1 text-xs font-medium">{svc.service}</td>
                  <td className="py-1 text-xs">
                    <span className="flex items-center gap-1.5">
                      <StatusDot status={svc.status} />
                      {svc.status}
                    </span>
                  </td>
                  <td className="py-1 text-right font-mono text-xs text-muted-foreground">
                    {svc.latencyMs}ms
                  </td>
                  <td className="py-1 text-right text-xs text-muted-foreground">
                    {timeAgo(svc.lastCheck)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
