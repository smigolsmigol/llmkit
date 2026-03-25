'use client';

import { useEffect, useState } from 'react';

interface Alert {
  type: string;
  message: string;
  created_at: string;
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function AlertsPanel() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/analytics', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(d => setAlerts(d?.alerts ?? []))
      .catch(() => setAlerts([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <p className="text-xs text-zinc-500">Loading alerts...</p>
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <p className="text-sm text-zinc-400">No alerts. Everything is running clean.</p>
        <p className="mt-1 text-xs text-zinc-600">Alerts fire on: service down, download spike/drop, new signups, collection failures.</p>
      </div>
    );
  }

  const grouped = new Map<string, Alert[]>();
  for (const a of alerts) {
    const day = formatDate(a.created_at);
    const existing = grouped.get(day) ?? [];
    existing.push(a);
    grouped.set(day, existing);
  }

  return (
    <div className="space-y-3">
      {Array.from(grouped.entries()).map(([day, dayAlerts]) => (
        <div key={day}>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-600">{day}</p>
          <div className="space-y-1">
            {dayAlerts.map((a, i) => (
              <div key={i} className="flex items-start justify-between rounded-lg border border-border bg-card px-3 py-2">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-amber-400" />
                  <span className="text-xs text-zinc-300">{a.message}</span>
                </div>
                <span className="shrink-0 ml-3 text-[10px] text-zinc-600">{timeAgo(a.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
