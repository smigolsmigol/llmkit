const NPM_PACKAGES = [
  '@f3d1/llmkit-mcp-server',
  '@f3d1/llmkit-cli',
  '@f3d1/llmkit-sdk',
  '@f3d1/llmkit-ai-sdk-provider',
  '@f3d1/llmkit-shared',
  '@f3d1/plugin-llmkit',
] as const;

const SOURCE_TIMEOUT_MS = 10_000;

export type AnalyticsSourceStatus = 'ok' | 'degraded' | 'unavailable';

export interface AnalyticsSource {
  name: string;
  status: AnalyticsSourceStatus;
  detail: string;
}

export interface AnalyticsAlert {
  type: 'source' | 'health';
  message: string;
  created_at: string;
}

export interface NpmPackageAnalytics {
  name: string;
  weekly: number | null;
  monthly: number | null;
  recent: number | null;
  recentDay: string;
  daily: Array<{ day: string; count: number }>;
  status: AnalyticsSourceStatus;
}

export interface EcosystemAnalyticsSnapshot {
  npm: NpmPackageAnalytics[];
  pypi: {
    name: 'llmkit-sdk';
    weekly: number | null;
    monthly: number | null;
    status: AnalyticsSourceStatus;
  };
  github: {
    stars: number | null;
    forks: number | null;
    openItems: number | null;
    watchers: number | null;
    status: AnalyticsSourceStatus;
  };
  health: Array<{
    service: string;
    status: 'up' | 'down' | 'degraded';
    latencyMs: number | null;
    lastCheck: string;
    version: string | null;
  }>;
  sources: AnalyticsSource[];
  alerts: AnalyticsAlert[];
  caveats: string[];
  updatedAt: string;
  freshness: { lastCollection: string; version: 'direct-v1' };
}

class SourceResponseError extends Error {
  constructor(readonly status: number) {
    super(`source returned HTTP ${status}`);
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function sourceFailureDetail(error: unknown): string {
  return error instanceof SourceResponseError ? `HTTP ${error.status}` : 'request failed';
}

async function fetchJson(url: string, revalidate: number, headers: HeadersInit = {}): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', ...headers },
    next: { revalidate },
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
  });
  if (!response.ok) throw new SourceResponseError(response.status);
  return response.json();
}

async function collectNpmPackage(name: string): Promise<NpmPackageAnalytics> {
  try {
    const payload = asObject(await fetchJson(
      `https://api.npmjs.org/downloads/range/last-month/${encodeURIComponent(name)}`,
      300,
    ));
    const daily = (Array.isArray(payload.downloads) ? payload.downloads : []).flatMap((entry) => {
      const row = asObject(entry);
      const day = asString(row.day);
      const count = asFiniteNumber(row.downloads);
      return day && count !== null && count >= 0 ? [{ day, count }] : [];
    });
    if (daily.length === 0) throw new Error('npm response omitted daily downloads');

    const lastThirtyDays = daily.slice(-30);
    const lastSevenDays = lastThirtyDays.slice(-7);
    const latest = lastThirtyDays.at(-1);
    return {
      name,
      weekly: lastSevenDays.reduce((sum, row) => sum + row.count, 0),
      monthly: lastThirtyDays.reduce((sum, row) => sum + row.count, 0),
      recent: latest?.count ?? null,
      recentDay: latest?.day ?? '',
      daily: lastThirtyDays.slice(-14),
      status: 'ok',
    };
  } catch {
    return {
      name,
      weekly: null,
      monthly: null,
      recent: null,
      recentDay: '',
      daily: [],
      status: 'unavailable',
    };
  }
}

async function collectNpm(): Promise<{
  data: NpmPackageAnalytics[];
  source: AnalyticsSource;
  alerts: AnalyticsAlert[];
}> {
  const data = await Promise.all(NPM_PACKAGES.map(collectNpmPackage));
  const available = data.filter((pkg) => pkg.status === 'ok').length;
  const status: AnalyticsSourceStatus = available === data.length
    ? 'ok'
    : available === 0 ? 'unavailable' : 'degraded';
  const alerts = status === 'ok' ? [] : [{
    type: 'source' as const,
    message: `npm download data is available for ${available}/${data.length} packages`,
    created_at: new Date().toISOString(),
  }];
  return {
    data,
    source: { name: 'npm', status, detail: `${available}/${data.length} packages available` },
    alerts,
  };
}

async function collectGithub(): Promise<{
  data: EcosystemAnalyticsSnapshot['github'];
  source: AnalyticsSource;
  alerts: AnalyticsAlert[];
}> {
  try {
    const raw = asObject(await fetchJson(
      'https://api.github.com/repos/smigolsmigol/llmkit',
      300,
      { 'User-Agent': 'llmkit-dashboard' },
    ));
    const stars = asFiniteNumber(raw.stargazers_count);
    const forks = asFiniteNumber(raw.forks_count);
    const openItems = asFiniteNumber(raw.open_issues_count);
    const watchers = asFiniteNumber(raw.subscribers_count);
    if ([stars, forks, openItems, watchers].some((value) => value === null)) {
      throw new Error('GitHub response omitted repository counts');
    }
    return {
      data: { stars, forks, openItems, watchers, status: 'ok' },
      source: { name: 'github', status: 'ok', detail: 'public repository snapshot' },
      alerts: [],
    };
  } catch (error) {
    return {
      data: { stars: null, forks: null, openItems: null, watchers: null, status: 'unavailable' },
      source: { name: 'github', status: 'unavailable', detail: sourceFailureDetail(error) },
      alerts: [{
        type: 'source',
        message: 'GitHub repository metrics are unavailable',
        created_at: new Date().toISOString(),
      }],
    };
  }
}

async function collectPypi(): Promise<{
  data: EcosystemAnalyticsSnapshot['pypi'];
  source: AnalyticsSource;
  alerts: AnalyticsAlert[];
}> {
  try {
    const raw = asObject(await fetchJson(
      'https://pypistats.org/api/packages/llmkit-sdk/recent?mirrors=false',
      900,
      { 'User-Agent': 'llmkit-dashboard' },
    ));
    const data = asObject(raw.data);
    const weekly = asFiniteNumber(data.last_week);
    const monthly = asFiniteNumber(data.last_month);
    if (weekly === null || monthly === null) throw new Error('PyPI Stats response omitted counts');
    return {
      data: { name: 'llmkit-sdk', weekly, monthly, status: 'ok' },
      source: { name: 'pypi-stats', status: 'ok', detail: 'mirror-excluded download counts' },
      alerts: [],
    };
  } catch (error) {
    return {
      data: { name: 'llmkit-sdk', weekly: null, monthly: null, status: 'unavailable' },
      source: { name: 'pypi-stats', status: 'unavailable', detail: sourceFailureDetail(error) },
      alerts: [{
        type: 'source',
        message: 'PyPI download metrics are unavailable',
        created_at: new Date().toISOString(),
      }],
    };
  }
}

async function collectProxyHealth(): Promise<{
  data: EcosystemAnalyticsSnapshot['health'];
  source: AnalyticsSource;
  alerts: AnalyticsAlert[];
}> {
  const observedAt = new Date().toISOString();
  const startedAt = Date.now();
  try {
    const raw = asObject(await fetchJson('https://api.llmkit.sh/health', 60));
    const latencyMs = Math.max(Date.now() - startedAt, 0);
    const reportedStatus = asString(raw.status);
    const version = asString(raw.version) || null;
    const status = reportedStatus === 'ok' ? 'up' : 'degraded';
    const sourceStatus: AnalyticsSourceStatus = status === 'up' ? 'ok' : 'degraded';
    return {
      data: [{ service: 'proxy', status, latencyMs, lastCheck: observedAt, version }],
      source: { name: 'proxy-health', status: sourceStatus, detail: `HTTP 200, status ${reportedStatus || 'unknown'}` },
      alerts: status === 'up' ? [] : [{
        type: 'health',
        message: `Proxy health reported ${reportedStatus || 'an unknown state'}`,
        created_at: observedAt,
      }],
    };
  } catch (error) {
    return {
      data: [{ service: 'proxy', status: 'down', latencyMs: null, lastCheck: observedAt, version: null }],
      source: { name: 'proxy-health', status: 'unavailable', detail: sourceFailureDetail(error) },
      alerts: [{ type: 'health', message: 'Proxy health check is unavailable', created_at: observedAt }],
    };
  }
}

export async function collectEcosystemAnalytics(): Promise<EcosystemAnalyticsSnapshot> {
  const [npm, github, pypi, proxy] = await Promise.all([
    collectNpm(),
    collectGithub(),
    collectPypi(),
    collectProxyHealth(),
  ]);
  const updatedAt = new Date().toISOString();

  return {
    npm: npm.data,
    pypi: pypi.data,
    github: github.data,
    health: proxy.data,
    sources: [npm.source, github.source, pypi.source, proxy.source],
    alerts: [...npm.alerts, ...github.alerts, ...pypi.alerts, ...proxy.alerts],
    caveats: [
      'Registry download counts are not unique installs and may include CI, bots, mirrors, and repeated downloads.',
      'GitHub public repository counts do not include private traffic, clone, or referrer analytics.',
    ],
    updatedAt,
    freshness: { lastCollection: updatedAt, version: 'direct-v1' },
  };
}
