'use client';

import { useEffect, useState } from 'react';

interface Alert {
  type: string;
  message: string;
  created_at: string;
}

interface StatusData {
  freshness: { lastCollection: string; version: string } | null;
  alerts: Alert[];
  accounts: { total: number } | null;
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
      .then(d => setData({
        freshness: d?.freshness ?? null,
        alerts: d?.alerts ?? [],
        accounts: d?.accounts ?? null,
      }))
      .catch(() => setData(null));
  }, []);

  if (!data) return null;

  const staleMinutes = data.freshness?.lastCollection
    ? Math.floor((Date.now() - new Date(data.freshness.lastCollection).getTime()) / 60000)
    : null;
  const isStale = staleMinutes !== null && staleMinutes > 90;

  return (
    <div className="space-y-3">
      {/* freshness bar */}
      <div className={`flex items-center justify-between rounded-lg border px-4 py-2 text-xs ${
        isStale
          ? 'border-red-500/30 bg-red-500/5 text-red-400'
          : 'border-border bg-card text-zinc-500'
      }`}>
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${isStale ? 'bg-red-400 animate-pulse' : 'bg-emerald-400'}`} />
          {data.freshness?.lastCollection ? (
            <span>
              Analytics collected {timeAgo(data.freshness.lastCollection)}
              {isStale && ' (STALE)'}
            </span>
          ) : (
            <span>Analytics: no collection data</span>
          )}
        </div>
        <span className="text-zinc-600">v{data.freshness?.version ?? '?'}</span>
      </div>

      {/* alerts */}
      {data.alerts.length > 0 && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
          <p className="mb-2 text-xs font-medium text-amber-400">Recent alerts</p>
          <div className="space-y-1">
            {data.alerts.slice(0, 5).map((a, i) => (
              <div key={i} className="flex items-start justify-between text-xs">
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
