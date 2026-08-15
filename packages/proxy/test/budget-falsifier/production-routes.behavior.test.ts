import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encrypt } from '../../src/crypto';
import type { Env } from '../../src/env';
import app from '../../src/index';

const API_ORIGIN = 'https://api.llmkit.test';
const DATABASE_ORIGIN = 'https://database.llmkit.test';
const SERVICE_KEY = 'sb_secret_test';
const RAW_API_KEY = 'lk_test_production_route_contract';
const PRIMARY_RECEIPT_ID = '11111111-1111-4111-8111-111111111111';

const AUTH_ROW = {
  id: 'key-1',
  user_id: 'user-1',
  key_hash: 'not-returned-by-production',
  key_prefix: 'lk_test...',
  name: 'contract key',
  budget_id: null,
  budgets: null,
  rpm_limit: 60,
  created_at: '2026-08-01T00:00:00.000Z',
  revoked_at: null,
};

const REQUEST_ROWS = [
  {
    id: PRIMARY_RECEIPT_ID,
    user_id: 'user-1',
    api_key_id: 'key-1',
    customer_id: 'customer-1',
    workflow_id: 'workflow-1',
    agent_id: 'agent-1',
    session_id: 'session-new',
    end_user_id: 'end-user-1',
    budget_id: null,
    budget_reservation_id: null,
    reserved_cost_cents: null,
    settlement_status: 'not_applicable',
    idempotency_key_hash: null,
    response_sha256: 'hash-1',
    provider: 'openai',
    model: 'gpt-4o',
    input_tokens: 100,
    output_tokens: 25,
    cache_read_tokens: 50,
    cost_cents: 125,
    latency_ms: 90,
    status: 'success',
    error_code: null,
    tool_calls: [{ name: 'search' }],
    created_at: '2026-08-12T12:00:00.000Z',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    user_id: 'user-1',
    api_key_id: 'key-2',
    customer_id: 'customer-1',
    workflow_id: null,
    agent_id: null,
    session_id: null,
    end_user_id: null,
    budget_id: null,
    budget_reservation_id: null,
    reserved_cost_cents: null,
    settlement_status: 'not_applicable',
    idempotency_key_hash: null,
    response_sha256: null,
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    input_tokens: 200,
    output_tokens: 50,
    cache_read_tokens: 0,
    cost_cents: null,
    latency_ms: 110,
    status: 'success',
    error_code: null,
    tool_calls: null,
    created_at: '2026-08-11T10:00:00.000Z',
  },
];

const MCP_REQUEST_ROWS = REQUEST_ROWS.map((row) => ({
  api_key_id: row.api_key_id,
  session_id: row.session_id,
  provider: row.provider,
  model: row.model,
  input_tokens: row.input_tokens,
  output_tokens: row.output_tokens,
  cache_read_tokens: row.cache_read_tokens,
  cost_cents: row.cost_cents ?? 0,
  created_at: row.created_at,
}));

type DatabaseHandler = (request: Request, url: URL) => Response | undefined | Promise<Response | undefined>;

function jsonResponse(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(value, { status, headers });
}

function installDatabaseMock(
  handler: DatabaseHandler = () => undefined,
  authResponse: () => Response = () => jsonResponse([AUTH_ROW]),
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (
      url.origin === DATABASE_ORIGIN
      && url.pathname === '/rest/v1/api_keys'
      && url.searchParams.has('key_hash')
    ) {
      return authResponse();
    }
    const response = await handler(request, url);
    if (response) return response;
    throw new Error(`unhandled external request: ${request.method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function makeBindings(rateResult: {
  allowed: boolean;
  count: number;
  limit: number;
  remaining: number;
  retryAfterSeconds?: number;
} = { allowed: true, count: 1, limit: 60, remaining: 59 }): Env['Bindings'] {
  const rateLimitNamespace = {
    idFromName: (name: string) => name,
    get: () => ({ hit: async () => rateResult }),
  };
  return {
    BUDGET_DO: {},
    IDEMPOTENCY_DO: {},
    RATE_LIMIT_DO: rateLimitNamespace,
    CF_VERSION_METADATA: { id: 'worker-version-test' },
    SUPABASE_URL: DATABASE_ORIGIN,
    SUPABASE_KEY: SERVICE_KEY,
  } as unknown as Env['Bindings'];
}

interface AppRequestOptions extends RequestInit {
  authenticated?: boolean;
  bindings?: Env['Bindings'];
}

async function requestApp(path: string, options: AppRequestOptions = {}): Promise<Response> {
  const {
    authenticated = true,
    bindings = makeBindings(),
    ...init
  } = options;
  const headers = new Headers(init.headers);
  if (authenticated) headers.set('Authorization', `Bearer ${RAW_API_KEY}`);
  const ctx = createExecutionContext();
  const response = await app.fetch(
    new Request(`${API_ORIGIN}${path}`, { ...init, headers }),
    bindings,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

async function postJson(path: string, payload: unknown, bindings = makeBindings()): Promise<Response> {
  return requestApp(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    bindings,
  });
}

async function body<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('production app entry, authentication, and rate limiting', () => {
  it('serves public discovery without authentication', async () => {
    const health = await requestApp('/health', { authenticated: false });
    const card = await requestApp('/.well-known/mcp/server-card.json', { authenticated: false });

    expect(health.status).toBe(200);
    expect(await body(health)).toEqual({ status: 'ok', version: '0.0.1' });
    expect(health.headers.get('x-llmkit-worker-version')).toBe('worker-version-test');
    expect(health.headers.get('access-control-expose-headers')).toContain('X-LLMKit-Worker-Version');
    expect(card.status).toBe(200);
    expect(await body<{ capabilities: { tools: boolean } }>(card)).toMatchObject({
      capabilities: { tools: true },
    });
  });

  it('fails closed for absent, unknown, and unavailable API-key identity', async () => {
    const absent = await requestApp('/v1/provider-keys', { authenticated: false });
    expect(absent.status).toBe(401);
    expect(await body(absent)).toMatchObject({ error: { code: 'AUTH_ERROR' } });

    installDatabaseMock(() => undefined, () => jsonResponse([]));
    const unknown = await requestApp('/v1/provider-keys');
    expect(unknown.status).toBe(401);

    installDatabaseMock(() => undefined, () => new Response('offline', { status: 503 }));
    const unavailable = await requestApp('/v1/provider-keys');
    expect(unavailable.status).toBe(500);
    expect(await body(unavailable)).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
  });

  it('permits an explicit development bypass only without a configured database', async () => {
    const withoutBypass = await requestApp('/v1/provider-keys', {
      bindings: makeBindingsWith({ SUPABASE_URL: undefined, SUPABASE_KEY: undefined }),
    });
    expect(withoutBypass.status).toBe(500);

    const withBypass = await requestApp('/v1/provider-keys', {
      bindings: makeBindingsWith({
        DEV_MODE: 'true',
        SUPABASE_URL: undefined,
        SUPABASE_KEY: undefined,
      }),
    });
    expect(withBypass.status).toBe(400);
    expect(await body(withBypass)).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
  });

  it('returns the durable rate-limit decision and retry contract', async () => {
    installDatabaseMock();
    const blocked = await requestApp('/v1/provider-keys', {
      bindings: makeBindings({
        allowed: false,
        count: 61,
        limit: 60,
        remaining: 0,
        retryAfterSeconds: 7,
      }),
    });

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('x-ratelimit-limit')).toBe('60');
    expect(blocked.headers.get('x-ratelimit-remaining')).toBe('0');
    expect(blocked.headers.get('retry-after')).toBe('7');
  });
});

function makeBindingsWith(overrides: Partial<Env['Bindings']>): Env['Bindings'] {
  return { ...makeBindings(), ...overrides };
}

describe('production provider-key routes', () => {
  it('lists, stores, and revokes keys without returning plaintext', async () => {
    const storedRows: Record<string, unknown>[] = [];
    installDatabaseMock(async (request, url) => {
      if (url.pathname !== '/rest/v1/provider_keys') return undefined;
      if (request.method === 'GET') {
        return jsonResponse([{
          id: 'provider-key-1',
          provider: 'openai',
          key_prefix: 'sk-proj...last',
          key_name: 'primary',
          created_at: '2026-08-01T00:00:00.000Z',
        }]);
      }
      if (request.method === 'POST') {
        storedRows.push(await request.json() as Record<string, unknown>);
        return new Response(null, { status: 201 });
      }
      if (request.method === 'PATCH') return new Response(null, { status: 204 });
      return undefined;
    });

    const encryptionKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
    const bindings = makeBindingsWith({ ENCRYPTION_KEY: encryptionKey });
    const listed = await requestApp('/v1/provider-keys', { bindings });
    expect(listed.status).toBe(200);
    expect(await body(listed)).toMatchObject({
      keys: [{ id: 'provider-key-1', provider: 'openai' }],
    });

    const created = await postJson('/v1/provider-keys', {
      provider: 'openai',
      key: 'provider-key-synthetic-value-last',
      name: 'primary',
    }, bindings);
    const createdBody = await body<Record<string, unknown>>(created);
    expect(created.status).toBe(201);
    expect(createdBody).toMatchObject({
      provider: 'openai',
      key_prefix: 'provide...last',
      key_name: 'primary',
    });
    expect(createdBody.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(createdBody)).not.toContain('synthetic-value');
    expect(storedRows).toHaveLength(1);
    expect(storedRows[0]).toMatchObject({
      user_id: 'user-1',
      provider: 'openai',
      key_prefix: 'provide...last',
      key_name: 'primary',
    });
    expect(storedRows[0]?.encrypted_key).not.toBe('provider-key-synthetic-value-last');

    const revoked = await requestApp('/v1/provider-keys/provider-key-1', {
      method: 'DELETE',
      bindings,
    });
    expect(revoked.status).toBe(200);
    expect(await body(revoked)).toEqual({ revoked: true });
  });

  it('rejects an unavailable vault and malformed key inputs', async () => {
    installDatabaseMock();
    const unavailable = await postJson('/v1/provider-keys', {
      provider: 'openai',
      key: 'long-enough',
    });
    expect(unavailable.status).toBe(503);

    const bindings = makeBindingsWith({
      ENCRYPTION_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(9))),
    });
    const invalidJson = await requestApp('/v1/provider-keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
      bindings,
    });
    expect(invalidJson.status).toBe(400);

    const invalidProvider = await postJson('/v1/provider-keys', {
      provider: 'unknown',
      key: 'long-enough',
    }, bindings);
    expect(invalidProvider.status).toBe(400);

    const shortKey = await postJson('/v1/provider-keys', {
      provider: 'openai',
      key: 'short',
    }, bindings);
    expect(shortKey.status).toBe(400);
  });
});

describe('production inference routes', () => {
  it('reports valid chat margin and rejects negative or non-finite revenue', async () => {
    installDatabaseMock((_request, url) => {
      if (url.origin === 'https://api.openai.com' && url.pathname === '/v1/chat/completions') {
        return jsonResponse({
          id: 'chatcmpl-1',
          model: 'gpt-4o',
          choices: [{ index: 0, message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        });
      }
      if (url.origin === DATABASE_ORIGIN && url.pathname === '/rest/v1/requests') {
        return new Response(null, { status: 201 });
      }
      return undefined;
    });

    const run = (revenue: string) => requestApp('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-llmkit-provider-key': 'direct-openai-secret',
        'x-llmkit-format': 'llmkit',
        'x-llmkit-revenue': revenue,
        'x-llmkit-revenue-token': 'revenue-1',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    const valid = await run('1.5');
    expect(valid.status).toBe(200);
    expect(await body(valid)).toMatchObject({
      content: 'done',
      margin: { revenueUsd: 1.5, revenueToken: 'revenue-1' },
    });

    const negative = await run('-1');
    expect(negative.status).toBe(200);
    expect(await body<Record<string, unknown>>(negative)).not.toHaveProperty('margin');

    const nonFinite = await run('Infinity');
    expect(nonFinite.status).toBe(200);
    expect(await body<Record<string, unknown>>(nonFinite)).not.toHaveProperty('margin');
  });

  it('decrypts a stored provider key for the Responses API without exposing it', async () => {
    const encryptionKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(11)));
    const stored = await encrypt('stored-openai-secret', encryptionKey, 'user-1:openai');
    const providerAuthorizations: string[] = [];
    installDatabaseMock((request, url) => {
      if (url.origin === DATABASE_ORIGIN && url.pathname === '/rest/v1/provider_keys') {
        return jsonResponse([{
          id: 'provider-key-1',
          user_id: 'user-1',
          provider: 'openai',
          encrypted_key: stored.ciphertext,
          iv: stored.iv,
          key_prefix: 'stored...',
          key_name: 'default',
          created_at: '2026-08-01T00:00:00.000Z',
        }]);
      }
      if (url.origin === 'https://api.openai.com' && url.pathname === '/v1/responses') {
        providerAuthorizations.push(request.headers.get('authorization') || '');
        return jsonResponse({
          id: 'response-1',
          model: 'gpt-4o',
          output: [{ type: 'message', id: 'message-1' }],
          usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
        });
      }
      if (url.origin === DATABASE_ORIGIN && url.pathname === '/rest/v1/requests') {
        return new Response(null, { status: 201 });
      }
      return undefined;
    });

    const response = await postJson('/v1/responses', {
      model: 'gpt-4o',
      input: 'hello',
    }, makeBindingsWith({ ENCRYPTION_KEY: encryptionKey }));

    expect(response.status).toBe(200);
    const responseBody = await body(response);
    expect(responseBody).toMatchObject({ id: 'response-1', model: 'gpt-4o' });
    expect(providerAuthorizations).toEqual(['Bearer stored-openai-secret']);
    expect(JSON.stringify(responseBody)).not.toContain('stored-openai-secret');
  });

  it('rejects an unsupported Responses provider before sending its direct credential', async () => {
    installDatabaseMock((request, url) => {
      if (url.origin === DATABASE_ORIGIN && url.pathname === '/rest/v1/requests') {
        return new Response(null, { status: 201 });
      }
      if (request.headers.get('authorization') === 'Bearer provider-secret-canary') {
        throw new Error(`credential reached unexpected provider URL ${url}`);
      }
      return undefined;
    });

    const response = await requestApp('/v1/responses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-llmkit-provider': 'unsupported-provider',
        'x-llmkit-provider-key': 'provider-secret-canary',
      },
      body: JSON.stringify({ model: 'gpt-4o', input: 'hello' }),
    });

    expect(response.status).toBe(400);
    expect(await body(response)).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
  });
});

function analyticsKeysResponse(url: URL): Response {
  if (url.searchParams.get('select') === 'id') {
    return jsonResponse([{ id: 'key-1' }, { id: 'key-2' }]);
  }
  return jsonResponse([{
    id: 'key-1',
    name: 'primary',
    key_prefix: 'lk_test',
    budget_id: 'budget-1',
    created_at: '2026-08-01T00:00:00.000Z',
    revoked_at: null,
  }]);
}

function analyticsRequestsResponse(url: URL): Response {
  if (url.searchParams.get('limit') === '0') {
    return jsonResponse([], 200, { 'content-range': '0-1/2' });
  }
  if (url.searchParams.get('limit') === '1') return jsonResponse([REQUEST_ROWS[0]]);
  return jsonResponse(REQUEST_ROWS);
}

function analyticsDatabaseResponse(url: URL): Response | undefined {
  if (url.pathname === '/rest/v1/api_keys') return analyticsKeysResponse(url);
  if (url.pathname === '/rest/v1/rpc/usage_aggregate') {
    return jsonResponse({
      requests: 2,
      pricedRequests: 1,
      unknownCostRequests: 1,
      totalCostCents: 125,
      totalInputTokens: 100,
      totalOutputTokens: 25,
      totalCacheReadTokens: 50,
      topModels: [{ model: 'gpt-4o', requests: 2 }],
    });
  }
  if (url.pathname === '/rest/v1/requests') return analyticsRequestsResponse(url);
  if (url.pathname === '/rest/v1/budgets') {
    return jsonResponse([{
      id: 'budget-1',
      name: 'monthly',
      limit_cents: 1000,
      period: 'monthly',
      created_at: '2026-08-01T00:00:00.000Z',
    }]);
  }
  return undefined;
}

function installAnalyticsDatabaseMock() {
  return installDatabaseMock((_request, url) => analyticsDatabaseResponse(url));
}

describe('production analytics routes', () => {
  it('returns receipts, aggregate usage, keys, and budgets for the authenticated owner', async () => {
    installAnalyticsDatabaseMock();

    const receipt = await requestApp(`/v1/analytics/receipts/${PRIMARY_RECEIPT_ID}`);
    expect(receipt.status).toBe(200);
    expect(await body(receipt)).toMatchObject({ receipt: { id: PRIMARY_RECEIPT_ID } });

    const usage = await requestApp('/v1/analytics/usage?period=week');
    expect(usage.status).toBe(200);
    expect(await body(usage)).toMatchObject({
      period: 'week',
      requests: 4,
      pricedRequests: 2,
      unknownCostRequests: 2,
      costComplete: false,
      totalCostCents: 250,
      cacheHitRate: 33.3,
      topModels: [{ model: 'gpt-4o', requests: 4 }],
    });

    const keys = await requestApp('/v1/analytics/keys');
    expect(keys.status).toBe(200);
    expect(await body(keys)).toMatchObject({ keys: [{ id: 'key-1' }] });

    const budgets = await requestApp('/v1/analytics/budgets');
    expect(budgets.status).toBe(200);
    expect(await body(budgets)).toMatchObject({ budgets: [{ id: 'budget-1' }] });
  });

  it('preserves unknown-cost semantics in cost and session breakdowns', async () => {
    installAnalyticsDatabaseMock();

    const costs = await requestApp('/v1/analytics/costs?groupBy=session&days=7');
    expect(costs.status).toBe(200);
    expect(await body(costs)).toMatchObject({
      groupBy: 'session',
      pricedRequests: 1,
      unknownCostRequests: 1,
      costComplete: false,
      breakdown: [
        { key: 'session-new', pricedRequests: 1, unknownCostRequests: 0, costCents: 125 },
        { key: 'no-session', pricedRequests: 0, unknownCostRequests: 1, costCents: 0 },
      ],
    });

    const sessions = await requestApp('/v1/analytics/sessions?limit=1');
    expect(sessions.status).toBe(200);
    expect(await body(sessions)).toMatchObject({
      pricedRequests: 1,
      unknownCostRequests: 0,
      costComplete: true,
      sessions: [{ sessionId: 'session-new', costCents: 125 }],
    });

    const selected = await requestApp('/v1/analytics/sessions?sessionId=no-session');
    expect(selected.status).toBe(200);
    expect(await body(selected)).toMatchObject({
      pricedRequests: 0,
      unknownCostRequests: 1,
      costComplete: false,
      sessions: [{ sessionId: 'no-session', costCents: 0 }],
    });
  });

  it('rejects malformed receipt identity and returns an empty usage contract without keys', async () => {
    installDatabaseMock((_request, url) => {
      if (url.pathname === '/rest/v1/api_keys') return jsonResponse([]);
      return undefined;
    });

    const invalid = await requestApp('/v1/analytics/receipts/not-a-uuid');
    expect(invalid.status).toBe(400);

    const usage = await requestApp('/v1/analytics/usage?period=today');
    expect(usage.status).toBe(200);
    expect(await body(usage)).toMatchObject({
      period: 'today',
      requests: 0,
      costComplete: true,
      totalCostCents: 0,
      cacheHitRate: 0,
    });
  });
});

function installMcpDatabaseMock() {
  return installDatabaseMock((_request, url) => {
    if (url.pathname === '/rest/v1/api_keys') {
      if (url.searchParams.get('select') === 'id') {
        return jsonResponse([{ id: 'key-1' }, { id: 'key-2' }]);
      }
      return jsonResponse([{
        id: 'key-1',
        name: 'primary',
        key_prefix: 'lk_test',
        budget_id: 'budget-1',
        created_at: '2026-08-01T00:00:00.000Z',
        revoked_at: null,
      }]);
    }
    if (url.pathname === '/rest/v1/requests') return jsonResponse(MCP_REQUEST_ROWS);
    if (url.pathname === '/rest/v1/budgets') {
      return jsonResponse([{
        id: 'budget-1',
        name: 'monthly',
        limit_cents: 1000,
        period: 'monthly',
      }]);
    }
    return undefined;
  });
}

async function mcpCall(payload: unknown): Promise<Response> {
  return postJson('/mcp', payload);
}

async function mcpText(response: Response): Promise<string> {
  const value = await body<{
    result: { content: [{ type: string; text: string }] };
  }>(response);
  return value.result.content[0].text;
}

describe('production MCP JSON-RPC endpoint', () => {
  it('negotiates capabilities and handles notifications and bounded batches', async () => {
    installMcpDatabaseMock();

    const initialized = await mcpCall({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect(initialized.status).toBe(200);
    expect(await body(initialized)).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: { protocolVersion: '2024-11-05', capabilities: { tools: {} } },
    });

    const tools = await mcpCall({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect((await body<{ result: { tools: unknown[] } }>(tools)).result.tools).toHaveLength(6);

    const notification = await mcpCall({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(notification.status).toBe(204);

    const batch = await mcpCall([
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'llmkit_health' } },
    ]);
    const batchBody = await body<unknown[]>(batch);
    expect(batchBody).toHaveLength(1);
    expect(JSON.stringify(batchBody[0])).toContain('Proxy is running');

    const tooLarge = await mcpCall(Array.from({ length: 21 }, (_, index) => ({
      jsonrpc: '2.0', id: index, method: 'tools/list',
    })));
    expect(tooLarge.status).toBe(400);
    expect(await body(tooLarge)).toMatchObject({ error: { code: -32600 } });
  });

  it('queries usage, costs, keys, budgets, and sessions through authenticated storage', async () => {
    installMcpDatabaseMock();

    const usage = await mcpCall({
      jsonrpc: '2.0', id: 10, method: 'tools/call',
      params: { name: 'llmkit_usage_stats', arguments: { period: 'week' } },
    });
    expect(await mcpText(usage)).toContain('Usage (week)');
    expect(await mcpText(await mcpCall({
      jsonrpc: '2.0', id: 11, method: 'tools/call',
      params: {
        name: 'llmkit_cost_query',
        arguments: { groupBy: 'session', provider: 'openai', model: 'gpt-4o', days: 7 },
      },
    }))).toContain('session-new: $1.25');

    expect(await mcpText(await mcpCall({
      jsonrpc: '2.0', id: 12, method: 'tools/call',
      params: { name: 'llmkit_list_keys' },
    }))).toContain('primary (lk_test...) ACTIVE');

    expect(await mcpText(await mcpCall({
      jsonrpc: '2.0', id: 13, method: 'tools/call',
      params: { name: 'llmkit_budget_status', arguments: { budgetId: 'budget-1' } },
    }))).toContain('monthly: $1.25/$10.00');

    expect(await mcpText(await mcpCall({
      jsonrpc: '2.0', id: 14, method: 'tools/call',
      params: { name: 'llmkit_session_summary', arguments: { limit: 1 } },
    }))).toContain('session-new: 1 reqs');

    expect(await mcpText(await mcpCall({
      jsonrpc: '2.0', id: 15, method: 'tools/call',
      params: { name: 'llmkit_session_summary', arguments: { sessionId: 'missing' } },
    }))).toContain('Session missing not found.');
  });

  it('returns protocol errors for malformed JSON, unknown tools, and unknown methods', async () => {
    installMcpDatabaseMock();

    const malformed = await requestApp('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    expect(malformed.status).toBe(400);
    expect(await body(malformed)).toMatchObject({ error: { code: -32700 } });

    const unknownTool = await mcpCall({
      jsonrpc: '2.0', id: 20, method: 'tools/call', params: { name: 'missing' },
    });
    expect(await body(unknownTool)).toMatchObject({ error: { code: -32601 } });

    const unknownMethod = await mcpCall({ jsonrpc: '2.0', id: 21, method: 'missing' });
    expect(await body(unknownMethod)).toMatchObject({ error: { code: -32601 } });
  });
});
