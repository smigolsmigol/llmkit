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

    // normalize npm from {pkgName: {last_week, last_month}} to [{name, weekly, total}]
    const npm = Object.entries(raw.npm || {}).map(([name, stats]: [string, any]) => ({
      name,
      weekly: stats.last_week ?? 0,
      total: stats.last_month ?? 0,
    }));

    // normalize health from {service: {status, latency_ms, checked_at}} to [{service, status, latencyMs, lastCheck}]
    const health = Object.entries(raw.health || {}).map(([service, stats]: [string, any]) => ({
      service,
      status: stats.status === 'up' ? 'up' : stats.status === 'degraded' ? 'degraded' : 'down',
      latencyMs: stats.latency_ms ?? 0,
      lastCheck: stats.checked_at ?? new Date().toISOString(),
    }));

    // normalize github
    const gh = raw.github || {};
    const github = {
      stars: gh.stars ?? 0,
      forks: gh.forks ?? 0,
      openIssues: gh.open_issues ?? 0,
      watchers: gh.watchers ?? 0,
    };

    // normalize pypi
    const pypi = {
      name: 'llmkit-sdk',
      weekly: raw.pypi?.last_week ?? 0,
      total: raw.pypi?.total_releases ?? 0,
    };

    return NextResponse.json({
      npm,
      pypi,
      github,
      health,
      updatedAt: raw.collected_at ?? new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ error: 'analytics unavailable' }, { status: 502 });
  }
}
