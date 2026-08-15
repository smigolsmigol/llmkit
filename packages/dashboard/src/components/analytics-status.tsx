'use client';

import { useEffect, useState } from 'react';
import type { AnalyticsAlert, AnalyticsSource } from '@/lib/ecosystem-analytics';

interface StatusData {
  freshness: { lastCollection: string; version: string };
  alerts: AnalyticsAlert[];
  sources: AnalyticsSource[];
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

export function AnalyticsStatus() {
  const [data, setData] = useState<StatusData | null>(null);

  useEffect(() => {
    fetch('/api/analytics', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(d => setData(d ? {
        freshness: d.freshness,
        alerts: d.alerts ?? [],
        sources: d.sources ?? [],
      } : null))
      .catch(() => setData(null));
  }, []);

  if (!data) return null;

  const staleMinutes = data.freshness.lastCollection
    ? Math.floor((Date.now() - new Date(data.freshness.lastCollection).getTime()) / 60000)
    : null;
  const isStale = staleMinutes !== null && staleMinutes > 90;
  const degradedSources = data.sources.filter((source) => source.status !== 'ok');
  const hasWarnings = isStale || degradedSources.length > 0;

  return (
    <div className="space-y-3">
      {/* freshness bar */}
      <div className={`flex items-center justify-between rounded-lg border px-4 py-2 text-xs ${
        hasWarnings
          ? 'border-red-500/30 bg-red-500/5 text-red-400'
          : 'border-border bg-card text-zinc-500'
      }`}>
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${hasWarnings ? 'bg-amber-400' : 'bg-emerald-400'}`} />
          {data.freshness.lastCollection ? (
            <span>
              Live snapshot refreshed {timeAgo(data.freshness.lastCollection)}
              {isStale && ' (STALE)'}
              {!isStale && degradedSources.length > 0 && ` (${degradedSources.length} source warning${degradedSources.length === 1 ? '' : 's'})`}
            </span>
          ) : (
            <span>Analytics: no collection data</span>
          )}
        </div>
        <span className="text-zinc-600">{data.freshness.version}</span>
      </div>

      {/* alerts */}
      {data.alerts.length > 0 && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
          <p className="mb-2 text-xs font-medium text-amber-400">Current source warnings</p>
          <div className="space-y-1">
            {data.alerts.slice(0, 5).map((a) => (
              <div key={`${a.type}:${a.created_at}:${a.message}`} className="flex items-start justify-between text-xs">
                <span className="text-zinc-400">{a.message}</span>
                <span className="shrink-0 ml-3 text-zinc-600">{timeAgo(a.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
