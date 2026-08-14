import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabase = vi.hoisted(() => {
  interface Result {
    data: unknown;
    error: { message: string } | null;
    count?: number | null;
  }

  const state = {
    defaults: new Map<string, Result>(),
    queues: new Map<string, Result[]>(),
    calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
  };

  const client = {
    from(table: string) {
      let singular = false;
      const query = new Proxy({}, {
        get(_target, property) {
          if (property === 'then') {
            return (
              resolve: (value: Result) => unknown,
              reject: (reason: unknown) => unknown,
            ) => {
              const queued = state.queues.get(table);
              const result = queued?.shift() ?? state.defaults.get(table) ?? {
                data: [],
                error: null,
                count: 0,
              };
              const resolved = singular && Array.isArray(result.data)
                ? { ...result, data: result.data[0] ?? null }
                : result;
              return Promise.resolve(resolved).then(resolve, reject);
            };
          }
          return (...args: unknown[]) => {
            state.calls.push({ table, method: String(property), args });
            if (property === 'single' || property === 'maybeSingle') singular = true;
            return query;
          };
        },
      });
      state.calls.push({ table, method: 'from', args: [] });
      return query;
    },
  };

  return { state, client };
});

vi.mock('../src/lib/supabase', () => ({
  createServerClient: () => supabase.client,
}));

import * as queries from '../src/lib/queries';

const NOW = '2026-08-13T12:00:00.000Z';
const PREVIOUS = '2026-08-05T12:00:00.000Z';

const requestRows = [
  {
    id: 'request-1',
    api_key_id: 'key-1',
    customer_id: 'customer-1',
    workflow_id: 'workflow-1',
    agent_id: 'agent-1',
    session_id: 'session-1',
    end_user_id: 'end-user-1',
    budget_id: 'budget-1',
    budget_reservation_id: 'reservation-1',
    reserved_cost_cents: 130,
    idempotency_key_hash: 'idem-1',
    response_sha256: 'hash-1',
    settlement_status: 'settled_actual',
    provider: 'openai',
    model: 'gpt-4o',
    input_tokens: 100,
    output_tokens: 20,
    cache_read_tokens: 50,
    cache_write_tokens: 0,
    cost_cents: 125,
    latency_ms: 80,
    status: 'success',
    error_code: null,
    tool_calls: [{ name: 'search' }],
    created_at: NOW,
  },
  {
    id: 'request-2',
    api_key_id: 'key-2',
    customer_id: null,
    workflow_id: null,
    agent_id: null,
    session_id: null,
    end_user_id: null,
    budget_id: 'budget-2',
    budget_reservation_id: null,
    reserved_cost_cents: null,
    idempotency_key_hash: null,
    response_sha256: null,
    settlement_status: 'unknown',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    input_tokens: 200,
    output_tokens: 40,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cost_cents: null,
    latency_ms: 120,
    status: 'error',
    error_code: 'PROVIDER_ERROR',
    tool_calls: null,
    created_at: PREVIOUS,
  },
];

const accounts = [
  {
    user_id: 'user-1',
    plan: 'admin',
    plan_expires_at: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    granted_by: 'system',
    note: 'operator',
    created_at: NOW,
    updated_at: NOW,
  },
  {
    user_id: 'user-3',
    plan: 'free',
    plan_expires_at: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    granted_by: null,
    note: null,
    created_at: PREVIOUS,
    updated_at: PREVIOUS,
  },
];

const apiKeys = [
  {
    id: 'key-1', user_id: 'user-1', key_prefix: 'lk_one', name: 'primary',
    budget_id: 'budget-1', created_at: NOW, revoked_at: null,
  },
  {
    id: 'key-2', user_id: 'user-2', key_prefix: 'lk_two', name: 'secondary',
    budget_id: null, created_at: PREVIOUS, revoked_at: null,
  },
];

const budgets = [
  {
    id: 'budget-1', user_id: 'user-1', name: 'daily', limit_cents: 1000,
    period: 'daily', scope: 'key', alert_webhook_url: null,
    reset_at: '2026-08-14T00:00:00.000Z', created_at: NOW,
  },
  {
    id: 'budget-2', user_id: 'user-1', name: 'total', limit_cents: 2000,
    period: 'total', scope: 'key', alert_webhook_url: null,
    reset_at: null, created_at: PREVIOUS,
  },
];

beforeEach(() => {
  supabase.state.calls.length = 0;
  supabase.state.queues.clear();
  supabase.state.defaults.clear();
  supabase.state.defaults.set('accounts', { data: accounts, error: null, count: accounts.length });
  supabase.state.defaults.set('api_keys', { data: apiKeys, error: null, count: apiKeys.length });
  supabase.state.defaults.set('requests', { data: requestRows, error: null, count: requestRows.length });
  supabase.state.defaults.set('budgets', { data: budgets, error: null, count: budgets.length });
  supabase.state.defaults.set('provider_keys', {
    data: [{
      id: 'provider-key-1', provider: 'openai', key_prefix: 'sk-proj', key_name: 'default',
      created_at: NOW, revoked_at: null,
    }],
    error: null,
    count: 1,
  });
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});

describe('dashboard query contracts', () => {
  it('preserves user receipt ownership, pagination, distinct values, and unknown costs', async () => {
    expect(await queries.getAccountPlan('user-1')).toBe('admin');
    expect(await queries.getRecentRequests('user-1', 10)).toHaveLength(2);

    expect(await queries.getSpendByProvider('user-1', 30)).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'openai', totalCostCents: 125, costComplete: true }),
      expect.objectContaining({ provider: 'anthropic', unknownCostRequests: 1, costComplete: false }),
    ]));
    expect(await queries.getTotalSpend('user-1', 30)).toMatchObject({
      range: 125,
      pricedRequests: 1,
      unknownCostRequests: 1,
      costComplete: false,
    });

    const page = await queries.getRequestsPaginated('user-1', 2, 1, {
      provider: 'openai',
      model: 'gpt-4o',
      sessionId: 'session-1',
      status: 'ok',
      sortBy: 'cost_cents',
      sortOrder: 'asc',
    });
    expect(page).toMatchObject({ total: 2, page: 2, pageSize: 1 });
    expect(await queries.getRequestById('user-1', 'request-1')).toMatchObject({ id: 'request-1' });
    expect(await queries.getDistinctProviders('user-1')).toEqual(['anthropic', 'openai']);
    expect(await queries.getDistinctModels('user-1')).toEqual(['claude-sonnet-4-6', 'gpt-4o']);
    expect(await queries.getRequestTimeseries('user-1', 30)).toHaveLength(2);
    expect(await queries.getSessions('user-1', 10, 30)).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: 'session-1', totalCostCents: 125 }),
      expect.objectContaining({ sessionId: 'no-session', unknownCostRequests: 1 }),
    ]));
  });

  it('computes account and admin analytics from complete and unknown-cost receipts', async () => {
    expect(await queries.ensureAccount('user-1')).toMatchObject({ user_id: 'user-1' });
    expect(await queries.getAccount('user-1')).toMatchObject({ plan: 'admin' });
    expect(await queries.getAllAccounts()).toHaveLength(2);
    expect(await queries.getAdminRequestTimeseries(30)).toHaveLength(2);

    expect(await queries.getAdminUserBreakdown(30)).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: 'user-1', spendCents: 125 }),
      expect.objectContaining({ userId: 'user-3', requests: 0 }),
    ]));
    expect(await queries.getAdminTopModels(30)).toEqual(expect.arrayContaining([
      expect.objectContaining({ model: 'gpt-4o', spendCents: 125 }),
      expect.objectContaining({ model: 'claude-sonnet-4-6', unknownCostRequests: 1 }),
    ]));
    expect(await queries.getAdminStatsTrend(7)).toHaveProperty('current');
    expect(await queries.getAdminProviderHealth(30)).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'anthropic', successRate: 0, lastErrorAt: PREVIOUS }),
    ]));
    expect(await queries.getAdminProviderSpend(30)).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'openai', cost: 1.25, costComplete: true }),
    ]));

    const page = await queries.getAdminRequestsPaginated(1, 25, {
      userId: 'user-1', provider: 'openai', model: 'gpt-4o', sessionId: 'session-1',
      status: 'error', sortBy: 'latency_ms', sortOrder: 'desc',
    });
    expect(page.data[0]).toMatchObject({ id: 'request-1', user_id: 'user-1' });
    expect(await queries.getAdminDistinctProviders()).toEqual(['anthropic', 'openai']);
    expect(await queries.getAdminDistinctModels()).toEqual(['claude-sonnet-4-6', 'gpt-4o']);
    expect(await queries.getAdminDistinctUsers()).toEqual(expect.arrayContaining([
      { userId: 'user-1', keyCount: 1 },
      { userId: 'user-2', keyCount: 1 },
    ]));
  });

  it('computes provider, model, budget, trend, and summary contracts', async () => {
    expect(await queries.getProviderKeys('user-1')).toHaveLength(1);
    expect(await queries.getProviderActivity('user-1')).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'anthropic', lastError: 'PROVIDER_ERROR' }),
    ]));
    expect(await queries.getModelBreakdown('user-1', 30)).toEqual(expect.arrayContaining([
      expect.objectContaining({ model: 'gpt-4o', costPer1kTokens: expect.any(Number) }),
    ]));
    expect(await queries.getRequestSummary('user-1', 30)).toMatchObject({
      totalRequests: 2,
      pricedRequests: 1,
      unknownCostRequests: 1,
      totalSpendCents: 125,
    });
    expect(await queries.getBudgets('user-1')).toHaveLength(2);
    expect(await queries.getApiKeys('user-1')).toHaveLength(2);
    expect(await queries.getUserStatsTrend('user-1', 7)).toHaveProperty('deltas');
    expect(await queries.getUserStatsTrend('user-1', 0)).toEqual({
      deltas: { spend: null, requests: null, avgCost: null, avgLatency: null },
    });
    expect(await queries.getBudgetUsage('user-1')).toEqual(expect.arrayContaining([
      expect.objectContaining({ budgetId: 'budget-1', usedCents: 125 }),
      expect.objectContaining({ budgetId: 'budget-2', unknownCostRequests: 1 }),
    ]));
  });

  it('fails closed on database errors and missing exact pagination counts', async () => {
    supabase.state.queues.set('api_keys', [
      { data: null, error: { message: 'offline' }, count: null },
      { data: apiKeys, error: null, count: apiKeys.length },
    ]);
    await expect(queries.getRecentRequests('error-user')).rejects.toThrow('Failed to load analytics keys');
    supabase.state.queues.set('requests', [{ data: requestRows, error: null, count: null }]);
    await expect(queries.getSpendByProvider('count-user', 13)).rejects.toThrow('omitted an exact row count');
  });
});
