import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  userId: null as string | null,
  plan: 'free',
  apiKeys: [] as Array<{ id: string }>,
  requests: [] as Array<Record<string, unknown>>,
  dbCalls: [] as Array<{ table: string; operation: string; args: unknown[] }>,
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(async () => ({ userId: state.userId })),
}));

vi.mock('@/lib/queries', () => ({
  getAccountPlan: vi.fn(async () => state.plan),
}));

function queryFor(table: string) {
  const result = table === 'api_keys'
    ? { data: state.apiKeys, error: null }
    : { data: state.requests, error: null };
  const query: Record<string, unknown> = {};
  for (const operation of ['select', 'eq', 'in', 'gte', 'order', 'limit']) {
    query[operation] = (...args: unknown[]) => {
      state.dbCalls.push({ table, operation, args });
      return query;
    };
  }
  // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are awaitable thenables.
  query.then = (
    resolve: (value: typeof result) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return query;
}

vi.mock('@/lib/supabase', () => ({
  createServerClient: vi.fn(() => ({ from: (table: string) => queryFor(table) })),
}));

import { GET as getAnalytics } from '@/app/api/analytics/route';
import { GET as getExport } from '@/app/api/export/route';
import { GET as getPricing } from '@/app/api/pricing/route';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  state.userId = 'user-1';
  state.plan = 'free';
  state.apiKeys = [{ id: 'key-1' }];
  state.requests = [];
  state.dbCalls = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.PRICING_API_URL;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('analytics API', () => {
  it('enforces authentication and admin access', async () => {
    state.userId = null;
    expect((await getAnalytics()).status).toBe(401);

    state.userId = 'user-1';
    expect((await getAnalytics()).status).toBe(403);
  });

  it('collects a direct snapshot without the retired analytics host', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-15T12:00:00Z'));
    state.plan = 'admin';

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith('https://api.npmjs.org/downloads/range/')) {
        return new Response(JSON.stringify({
          downloads: [
            { day: '2026-08-07', downloads: 1 },
            { day: '2026-08-08', downloads: 2 },
            { day: '2026-08-09', downloads: 3 },
            { day: '2026-08-10', downloads: 4 },
            { day: '2026-08-11', downloads: 5 },
            { day: '2026-08-12', downloads: 6 },
            { day: '2026-08-13', downloads: 7 },
            { day: '2026-08-14', downloads: 8 },
            { day: 42, downloads: 'bad' },
          ],
        }), { status: 200 });
      }
      if (url === 'https://api.github.com/repos/smigolsmigol/llmkit') {
        return new Response(JSON.stringify({
          stargazers_count: 45,
          forks_count: 31,
          open_issues_count: 56,
          subscribers_count: 23,
        }), { status: 200 });
      }
      if (url.startsWith('https://pypistats.org/')) {
        return new Response(JSON.stringify({ data: { last_week: 12, last_month: 50 } }), { status: 200 });
      }
      if (url === 'https://api.llmkit.sh/health') {
        return new Response(JSON.stringify({ status: 'ok', version: '0.0.1' }), { status: 200 });
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await getAnalytics();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      pypi: { name: 'llmkit-sdk', weekly: 12, monthly: 50, status: 'ok' },
      github: { stars: 45, forks: 31, openItems: 56, watchers: 23, status: 'ok' },
      freshness: { lastCollection: '2026-08-15T12:00:00.000Z', version: 'direct-v1' },
      alerts: [],
    });
    expect(body.npm).toHaveLength(6);
    expect(body.npm[0]).toMatchObject({
      name: '@f3d1/llmkit-mcp-server',
      weekly: 35,
      monthly: 36,
      recent: 8,
      recentDay: '2026-08-14',
      status: 'ok',
    });
    expect(body.health).toEqual([expect.objectContaining({ service: 'proxy', status: 'up', version: '0.0.1' })]);
    expect(body.sources.every((source: { status: string }) => source.status === 'ok')).toBe(true);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('analytics.example'))).toBe(false);
  });

  it('returns an honest partial snapshot without leaking transport details', async () => {
    state.plan = 'admin';
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('github.com')) throw new Error('private transport detail');
      return new Response('', { status: url.includes('pypistats') ? 503 : 429 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await getAnalytics();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.npm.every((pkg: { status: string }) => pkg.status === 'unavailable')).toBe(true);
    expect(body.github).toMatchObject({ stars: null, status: 'unavailable' });
    expect(body.pypi).toMatchObject({ weekly: null, status: 'unavailable' });
    expect(body.health).toEqual([expect.objectContaining({ service: 'proxy', status: 'down' })]);
    expect(body.alerts).toHaveLength(4);
    expect(JSON.stringify(body)).not.toContain('private transport detail');
  });
});

describe('pricing API', () => {
  it('enforces authentication and configuration', async () => {
    const request = new Request('https://dashboard.example/api/pricing');
    Object.defineProperty(request, 'nextUrl', { value: new URL(request.url) });

    state.userId = null;
    expect((await getPricing(request as never)).status).toBe(401);
    state.userId = 'user-1';
    expect((await getPricing(request as never)).status).toBe(503);
  });

  it('forwards one encoded filter and returns upstream JSON', async () => {
    process.env.PRICING_API_URL = 'https://proxy.example';
    const request = new Request('https://dashboard.example/api/pricing?provider=Open AI&q=ignored');
    Object.defineProperty(request, 'nextUrl', { value: new URL(request.url) });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ model: 'gpt-test' }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await getPricing(request as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [{ model: 'gpt-test' }] });
    expect(fetchMock).toHaveBeenCalledWith('https://proxy.example/api/pricing?provider=Open%20AI', {
      headers: { Accept: 'application/json' },
      next: { revalidate: 3600 },
    });
  });

  it('handles query-only, upstream, and transport failures', async () => {
    process.env.PRICING_API_URL = 'https://proxy.example';
    const queryRequest = new Request('https://dashboard.example/api/pricing?q=claude 4');
    Object.defineProperty(queryRequest, 'nextUrl', { value: new URL(queryRequest.url) });

    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    const upstream = await getPricing(queryRequest as never);
    expect(upstream.status).toBe(502);
    expect(await upstream.json()).toEqual({ error: 'upstream 404' });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://proxy.example/api/pricing?q=claude%204');

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    const unavailable = await getPricing(queryRequest as never);
    expect(unavailable.status).toBe(502);
    expect(await unavailable.json()).toEqual({ error: 'pricing unavailable' });
  });
});

describe('CSV export API', () => {
  it('enforces authentication and user-owned key scope', async () => {
    state.userId = null;
    expect((await getExport(new Request('https://dashboard.example/api/export'))).status).toBe(401);

    state.userId = 'user-1';
    state.apiKeys = [];
    expect((await getExport(new Request('https://dashboard.example/api/export'))).status).toBe(404);
  });

  it('exports detailed operational receipts with stable integrity metadata', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-13T12:00:00Z'));
    state.requests = [
      {
        id: 'req-1', created_at: '2026-08-13T11:00:00Z', user_id: 'user-1', api_key_id: 'key-1',
        customer_id: 'customer,one', workflow_id: 'flow-1', agent_id: 'agent-1', end_user_id: 'end-1',
        model: 'gpt-test', provider: 'openai', input_tokens: 10, output_tokens: 5,
        cache_read_tokens: 2, cache_write_tokens: 1, reserved_cost_cents: 25, cost_cents: 20,
        budget_id: 'budget-1', budget_reservation_id: 'reservation-1', settlement_status: 'settled',
        idempotency_key_hash: 'idem', response_sha256: 'response', latency_ms: 100,
        session_id: 'session-1', status: 'success', error_code: null, source: 'proxy',
      },
      {
        id: 'req-2', created_at: '2026-08-13T11:30:00Z', user_id: 'user-1', api_key_id: 'key-1',
        model: 'claude-test', provider: 'anthropic', input_tokens: 3, output_tokens: 2,
        reserved_cost_cents: null, cost_cents: null, status: 'error', source: 'proxy',
      },
    ];

    const response = await getExport(new Request(
      'https://dashboard.example/api/export?format=article12&days=999&provider=openai&model=gpt-test&session=session-1',
    ));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toContain('llmkit-export-article12-2026-08-13.csv');
    expect(response.headers.get('x-llmkit-export-records')).toBe('2');
    const hash = response.headers.get('x-llmkit-export-hash');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);

    const body = await response.text();
    expect(body).toContain(`# Integrity: sha256:${hash}`);
    expect(body).toContain('# Period: 30d');
    expect(body).toContain('# Total spend: $0.20');
    expect(body).toContain('# Unknown committed cost records: 1');
    expect(body).toContain('"customer,one"');
    expect(body).toContain('2026-08-13T11:30:00Z,req-2,user-1,key-1');
    expect(state.dbCalls).toEqual(expect.arrayContaining([
      { table: 'requests', operation: 'in', args: ['api_key_id', ['key-1']] },
      { table: 'requests', operation: 'eq', args: ['provider', 'openai'] },
      { table: 'requests', operation: 'eq', args: ['model', 'gpt-test'] },
      { table: 'requests', operation: 'eq', args: ['session_id', 'session-1'] },
    ]));
    vi.useRealTimers();
  });

  it('allows admin scope, emits raw format, and reports empty data', async () => {
    state.plan = 'admin';
    state.requests = [{
      id: 'req-1', created_at: '2026-08-13T11:00:00Z', user_id: 'other-user', api_key_id: 'key-2',
      model: 'gpt-test', provider: 'openai', input_tokens: 1, output_tokens: 1,
      cost_cents: 5, source: 'proxy',
    }];
    const response = await getExport(new Request('https://dashboard.example/api/export?format=raw&days=1'));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('id,created_at,user_id,api_key_id');
    expect(state.dbCalls.some((call) => call.operation === 'in')).toBe(false);

    state.requests = [];
    expect((await getExport(new Request('https://dashboard.example/api/export'))).status).toBe(404);
  });
});
