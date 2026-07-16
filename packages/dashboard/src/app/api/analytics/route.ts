import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { getAccountPlan } from '@/lib/queries';

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

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

    const responseBody: unknown = await res.json();
    const raw = asObject(responseBody);
    const npmPayload = asObject(raw.npm);

    // normalize npm from {pkgName: {last_week, last_month, daily}} to [{name, weekly, total, recent, daily}]
    const npm = Object.entries(npmPayload)
      .filter(([name]) => name !== 'collected_at')
      .map(([name, value]) => {
        const stats = asObject(value);
        const daily = (Array.isArray(stats.daily) ? stats.daily : []).map((entry) => {
          const item = asObject(entry);
          return {
            day: asString(item.day),
            count: asNumber(item.count),
            organic: typeof item.organic === 'number' ? item.organic : undefined,
            ci_noise: typeof item.ci_noise === 'number' ? item.ci_noise : undefined,
          };
        });
        const last = daily.length > 0 ? daily[daily.length - 1] : null;
        return {
          name,
          weekly: asNumber(stats.organic_week ?? stats.last_week),
          weeklyRaw: asNumber(stats.last_week),
          total: asNumber(stats.organic_month ?? stats.last_month),
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
    const healthPayload = asObject(raw.health);
    const healthCollectedAt = asString(healthPayload.collected_at, new Date().toISOString());
    const health = Object.entries(healthPayload)
      .filter(([key]) => key !== 'collected_at')
      .map(([service, value]) => {
        const stats = asObject(value);
        return {
          service,
          status: stats.status === 'up' ? 'up' : stats.status === 'degraded' ? 'degraded' : 'down',
          latencyMs: asNumber(stats.latency_ms),
          lastCheck: healthCollectedAt,
        };
      });

    // normalize github
    const gh = asObject(raw.github);
    const github = {
      stars: asNumber(gh.stars),
      forks: asNumber(gh.forks),
      openIssues: asNumber(gh.open_issues),
      watchers: asNumber(gh.watchers),
    };

    const pypiPayload = asObject(raw.pypi);
    const pypi = {
      name: 'llmkit-sdk',
      weekly: asNumber(pypiPayload.last_week),
      total: asNumber(pypiPayload.last_month),
    };

    const updatedAt = asString(
      npmPayload.collected_at,
      asString(healthPayload.collected_at, new Date().toISOString()),
    );

    // v2 fields from upgraded Hetzner collector
    const freshnessPayload = asObject(raw.freshness);
    const freshness = raw.freshness ? {
      lastCollection: asString(
        freshnessPayload.last_success,
        asString(freshnessPayload.collected_at),
      ),
      version: asString(freshnessPayload.version, '1.0'),
    } : null;

    const accountsPayload = asObject(raw.accounts);
    const accounts = raw.accounts ? {
      total: asNumber(accountsPayload.total),
      list: Array.isArray(accountsPayload.accounts) ? accountsPayload.accounts : [],
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
        const alertBody: unknown = await alertRes.json();
        const alertData = asObject(alertBody);
        alerts = (Array.isArray(alertData.alerts) ? alertData.alerts : []).flatMap((entry) => {
          const alert = asObject(entry);
          const type = asString(alert.type);
          const message = asString(alert.message);
          const createdAt = asString(alert.created_at);
          return type && message && createdAt
            ? [{ type, message, created_at: createdAt }]
            : [];
        });
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
