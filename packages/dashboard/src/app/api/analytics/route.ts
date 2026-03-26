import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { getAccountPlan } from '@/lib/queries';

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const plan = await getAccountPlan(userId);
  if (plan !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const apiUrl = process.env.ANALYTICS_API_URL;
  const apiKey = process.env.ANALYTICS_API_KEY;

  if (!apiUrl) {
    return NextResponse.json({ error: 'analytics not configured' }, { status: 503 });
  }

  try {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const res = await fetch(`${apiUrl}/api/analytics/overview`, {
      headers,
      next: { revalidate: 300 },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `upstream ${res.status}` },
        { status: 502 },
      );
    }

    const raw = await res.json();

    // normalize npm from {pkgName: {last_week, last_month, daily}} to [{name, weekly, total, recent, daily}]
    const npm = Object.entries(raw.npm || {})
      .filter(([name]) => name !== 'collected_at')
      .map(([name, stats]: [string, any]) => {
        const daily: Array<{day: string; count: number; organic?: number; ci_noise?: number}> = stats.daily ?? [];
        const last = daily.length > 0 ? daily[daily.length - 1] : null;
        return {
          name,
          weekly: stats.organic_week ?? stats.last_week ?? 0,
          weeklyRaw: stats.last_week ?? 0,
          total: stats.organic_month ?? stats.last_month ?? 0,
          recent: last?.organic ?? last?.count ?? 0,
          recentDay: last?.day ?? '',
          daily: daily.slice(-14).map(d => ({
            day: d.day,
            count: d.organic ?? d.count,
            raw: d.count,
            ci_noise: d.ci_noise ?? 0,
          })),
        };
      });

    // normalize health from {service: {status, latency_ms}, collected_at} to [{service, status, latencyMs, lastCheck}]
    const healthCollectedAt = raw.health?.collected_at ?? new Date().toISOString();
    const health = Object.entries(raw.health || {})
      .filter(([key]) => key !== 'collected_at')
      .map(([service, stats]: [string, any]) => ({
        service,
        status: stats.status === 'up' ? 'up' : stats.status === 'degraded' ? 'degraded' : 'down',
        latencyMs: stats.latency_ms ?? 0,
        lastCheck: healthCollectedAt,
      }));

    // normalize github
    const gh = raw.github || {};
    const github = {
      stars: gh.stars ?? 0,
      forks: gh.forks ?? 0,
      openIssues: gh.open_issues ?? 0,
      watchers: gh.watchers ?? 0,
    };

    const pypi = {
      name: 'llmkit-sdk',
      weekly: raw.pypi?.last_week ?? 0,
      total: raw.pypi?.last_month ?? 0,
    };

    const updatedAt = raw.npm?.collected_at ?? raw.health?.collected_at ?? new Date().toISOString();

    // v2 fields from upgraded Hetzner collector
    const freshness = raw.freshness ? {
      lastCollection: raw.freshness.last_success ?? raw.freshness.collected_at,
      version: raw.freshness.version ?? '1.0',
    } : null;

    const accounts = raw.accounts ? {
      total: raw.accounts.total ?? 0,
      list: raw.accounts.accounts ?? [],
    } : null;

    // fetch alerts separately (not in overview response)
    let alerts: Array<{type: string; message: string; created_at: string}> = [];
    try {
      const alertHeaders: Record<string, string> = { Accept: 'application/json' };
      if (apiKey) alertHeaders['Authorization'] = `Bearer ${apiKey}`;
      const alertRes = await fetch(`${apiUrl}/api/analytics/alerts?limit=20`, {
        headers: alertHeaders,
        next: { revalidate: 60 },
      });
      if (alertRes.ok) {
        const alertData = await alertRes.json();
        alerts = alertData.alerts ?? [];
      }
    } catch { /* alerts are optional */ }

    return NextResponse.json({
      npm,
      pypi,
      github,
      health,
      updatedAt,
      freshness,
      accounts,
      alerts,
    });
  } catch {
    return NextResponse.json({ error: 'analytics unavailable' }, { status: 502 });
  }
}
