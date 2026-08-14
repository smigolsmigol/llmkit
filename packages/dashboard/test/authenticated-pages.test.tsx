import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  userId: 'user-1' as string | null,
  values: {} as Record<string, unknown>,
  failures: new Set<string>(),
}));

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
}));

function mockedQuery(name: string) {
  return vi.fn(async () => {
    if (state.failures.has(name)) throw new Error(`${name} unavailable`);
    return state.values[name];
  });
}

vi.mock('server-only', () => ({}));
vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(async () => ({ userId: state.userId })),
}));
vi.mock('@clerk/nextjs', () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SignIn: () => <div>Clerk sign in</div>,
  SignUp: () => <div>Clerk sign up</div>,
  UserButton: () => <div>User menu</div>,
}));
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); },
  usePathname: () => '/dashboard/requests',
  useRouter: () => navigation,
  useSearchParams: () => new URLSearchParams(
    'days=7&provider=openai&model=gpt-4o&status=ok&session_id=session-1&tab=overview',
  ),
}));
vi.mock('echarts-for-react/lib/core', () => ({
  default: ({ option }: { option: unknown }) => (
    <div data-testid="chart" data-option={JSON.stringify(option).slice(0, 200)} />
  ),
}));
vi.mock('@/lib/echarts', () => ({ default: {} }));
vi.mock('@/lib/queries', () => ({
  ensureAccount: mockedQuery('ensureAccount'),
  getAccount: mockedQuery('getAccount'),
  getAccountPlan: mockedQuery('getAccountPlan'),
  getAdminDistinctModels: mockedQuery('getAdminDistinctModels'),
  getAdminDistinctProviders: mockedQuery('getAdminDistinctProviders'),
  getAdminDistinctUsers: mockedQuery('getAdminDistinctUsers'),
  getAdminProviderHealth: mockedQuery('getAdminProviderHealth'),
  getAdminProviderSpend: mockedQuery('getAdminProviderSpend'),
  getAdminRequestsPaginated: mockedQuery('getAdminRequestsPaginated'),
  getAdminRequestTimeseries: mockedQuery('getAdminRequestTimeseries'),
  getAdminStatsTrend: mockedQuery('getAdminStatsTrend'),
  getAdminTopModels: mockedQuery('getAdminTopModels'),
  getAdminUserBreakdown: mockedQuery('getAdminUserBreakdown'),
  getAllAccounts: mockedQuery('getAllAccounts'),
  getApiKeys: mockedQuery('getApiKeys'),
  getBudgets: mockedQuery('getBudgets'),
  getBudgetUsage: mockedQuery('getBudgetUsage'),
  getDistinctModels: mockedQuery('getDistinctModels'),
  getDistinctProviders: mockedQuery('getDistinctProviders'),
  getModelBreakdown: mockedQuery('getModelBreakdown'),
  getProviderActivity: mockedQuery('getProviderActivity'),
  getProviderKeys: mockedQuery('getProviderKeys'),
  getRecentRequests: mockedQuery('getRecentRequests'),
  getRequestById: mockedQuery('getRequestById'),
  getRequestsPaginated: mockedQuery('getRequestsPaginated'),
  getRequestSummary: mockedQuery('getRequestSummary'),
  getRequestTimeseries: mockedQuery('getRequestTimeseries'),
  getSessions: mockedQuery('getSessions'),
  getSpendByProvider: mockedQuery('getSpendByProvider'),
  getTotalSpend: mockedQuery('getTotalSpend'),
  getUserStatsTrend: mockedQuery('getUserStatsTrend'),
}));

import AdminPage from '@/app/(auth)/dashboard/admin/page';
import AdminRequestsPage from '@/app/(auth)/dashboard/admin/requests/page';
import KeysPage from '@/app/(auth)/dashboard/keys/page';
import DashboardLayout from '@/app/(auth)/dashboard/layout';
import OverviewPage from '@/app/(auth)/dashboard/page';
import ProvidersPage from '@/app/(auth)/dashboard/providers/page';
import RequestDetailPage from '@/app/(auth)/dashboard/requests/[id]/page';
import RequestsPage from '@/app/(auth)/dashboard/requests/page';
import SettingsPage from '@/app/(auth)/dashboard/settings/page';
import AuthLayout from '@/app/(auth)/layout';
import SignInPage from '@/app/(auth)/sign-in/[[...sign-in]]/page';
import SignUpPage from '@/app/(auth)/sign-up/[[...sign-up]]/page';

const request = {
  id: 'req-1',
  api_key_id: 'key-1',
  customer_id: 'customer-1',
  workflow_id: 'workflow-1',
  agent_id: 'agent-1',
  session_id: 'session-1',
  end_user_id: 'end-user-1',
  budget_id: 'budget-1',
  budget_reservation_id: 'reservation-1',
  reserved_cost_cents: 30,
  idempotency_key_hash: 'idem-hash',
  response_sha256: 'response-hash',
  settlement_status: 'settled',
  provider: 'openai',
  model: 'gpt-4o',
  input_tokens: 1000,
  output_tokens: 200,
  cache_read_tokens: 50,
  cache_write_tokens: 25,
  cost_cents: 20,
  latency_ms: 321,
  status: 'success',
  error_code: null,
  tool_calls: [{ name: 'search' }, { name: 'search' }, { name: 'read' }],
  created_at: '2026-08-13T12:00:00Z',
};

const unknownRequest = {
  ...request,
  id: 'req-2',
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  cost_cents: null,
  status: 'pending',
  tool_calls: null,
};

const account = {
  user_id: 'user-1',
  plan: 'admin',
  plan_expires_at: '2027-01-01T00:00:00Z',
  stripe_customer_id: null,
  stripe_subscription_id: null,
  granted_by: 'owner',
  note: 'Early operator',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-08-13T00:00:00Z',
};

beforeEach(() => {
  state.userId = 'user-1';
  state.failures = new Set();
  navigation.push.mockReset();
  navigation.refresh.mockReset();
  state.values = {
    ensureAccount: account,
    getAccount: account,
    getAccountPlan: 'admin',
    getAllAccounts: [account, { ...account, user_id: 'user-2', plan: 'free', note: null }],
    getApiKeys: [{
      id: 'key-1', user_id: 'user-1', key_prefix: 'llmk_abcd1234', name: 'Production',
      budget_id: 'budget-1', created_at: '2026-08-01T00:00:00Z', revoked_at: null,
    }],
    getBudgets: [{
      id: 'budget-1', user_id: 'user-1', name: 'Production', limit_cents: 10000,
      period: 'monthly', scope: 'key', alert_webhook_url: null,
      reset_at: '2026-09-01T00:00:00Z', created_at: '2026-08-01T00:00:00Z',
    }],
    getBudgetUsage: [{
      budgetId: 'budget-1', name: 'Production', limitCents: 10000, usedCents: 8500,
      period: 'monthly', resetAt: '2026-09-01T00:00:00Z', pricedRequests: 1,
      unknownCostRequests: 1, costComplete: false,
    }],
    getTotalSpend: { today: 50, week: 175, range: 250 },
    getSpendByProvider: [{
      provider: 'openai', count: 2, totalCostCents: 250,
      pricedRequests: 1, unknownCostRequests: 1, costComplete: false,
    }],
    getRequestTimeseries: [
      { t: '2026-08-13T10:00:00Z', costCents: 20, inputTokens: 1000, outputTokens: 200 },
      { t: '2026-08-13T11:00:00Z', costCents: null, inputTokens: 300, outputTokens: 100 },
      { t: '2026-08-13T12:00:00Z', costCents: 30, inputTokens: 800, outputTokens: 400 },
    ],
    getRecentRequests: [request, unknownRequest],
    getModelBreakdown: [{
      model: 'gpt-4o', provider: 'openai', requests: 2, spendCents: 250,
      avgLatencyMs: 321, totalInputTokens: 1800, totalOutputTokens: 600,
      costPer1kTokens: 104.2, pricedRequests: 1, unknownCostRequests: 1, costComplete: false,
    }],
    getRequestSummary: {
      totalRequests: 2, pricedRequests: 1, unknownCostRequests: 1, costComplete: false,
      totalSpendCents: 250, totalInputTokens: 1800, totalOutputTokens: 600,
      avgCostCents: 250, avgLatencyMs: 321, projectedMonthlyCents: 7500,
    },
    getSessions: [{
      sessionId: 'session-1', requestCount: 2, totalCostCents: 250,
      pricedRequests: 1, unknownCostRequests: 1, costComplete: false,
      providers: ['openai', 'anthropic'], lastRequest: '2026-08-13T12:00:00Z',
    }],
    getUserStatsTrend: { deltas: { spend: 10, requests: -5, avgCost: 0, avgLatency: 2 } },
    getProviderKeys: [{
      id: 'provider-key-1', provider: 'openai', key_prefix: 'sk-proj...cret',
      key_name: 'primary', created_at: '2026-08-01T00:00:00Z', revoked_at: null,
    }],
    getProviderActivity: [{
      provider: 'openai', requests: 3, spendCents: 250, pricedRequests: 2,
      unknownCostRequests: 1, costComplete: false, lastUsed: '2026-08-13T12:00:00Z',
      lastError: 'rate_limit', lastErrorTime: '2026-08-13T11:59:00Z',
      models: [
        { model: 'gpt-4o', count: 2 }, { model: 'gpt-4.1', count: 1 },
        { model: 'o3', count: 1 }, { model: 'o4-mini', count: 1 }, { model: 'gpt-5', count: 1 },
      ],
    }],
    getRequestsPaginated: { data: [request, unknownRequest], total: 51, page: 2, pageSize: 25 },
    getDistinctProviders: ['anthropic', 'openai'],
    getDistinctModels: ['claude-sonnet-4-5', 'gpt-4o'],
    getRequestById: request,
    getAdminStatsTrend: {
      current: {
        totalRequests: 3, totalSpendCents: 500, pricedRequests: 2, unknownCostRequests: 1,
        costComplete: false, totalAccounts: 2, totalInputTokens: 3000,
        totalOutputTokens: 1200, activeKeysToday: 1, activeKeysWeek: 2,
        activeKeysMonth: 3, errorRate: 33.3, avgLatencyMs: 400,
        p95LatencyMs: 900, avgTokensPerReq: 1400,
      },
      previous: {},
      deltas: { spend: 10, requests: 20, tokens: 30, errorRate: -2, avgLatency: 5, p95Latency: 7 },
    },
    getAdminRequestTimeseries: [
      { t: '2026-08-13T10:00:00Z', costCents: 50, inputTokens: 2000, outputTokens: 500 },
      { t: '2026-08-13T11:00:00Z', costCents: 75, inputTokens: 1000, outputTokens: 700 },
    ],
    getAdminUserBreakdown: [{
      userId: 'user-1', plan: 'admin', note: 'Owner', requests: 3, spendCents: 500,
      errors: 1, avgLatencyMs: 400, lastActive: '2026-08-13T12:00:00Z',
      pricedRequests: 2, unknownCostRequests: 1, costComplete: false,
    }],
    getAdminTopModels: [{
      model: 'gpt-4o', provider: 'openai', requests: 3, spendCents: 500,
      avgLatencyMs: 400, avgTokensPerReq: 1400, costPer1kTokens: 119,
      pricedRequests: 2, unknownCostRequests: 1, costComplete: false,
    }],
    getAdminProviderHealth: [{
      provider: 'openai', requests: 3, successRate: 66.7, lastErrorAt: '2026-08-13T11:00:00Z',
      avgLatencyMs: 400, p95LatencyMs: 900, spendCents: 500,
      pricedRequests: 2, unknownCostRequests: 1, costComplete: false,
    }],
    getAdminProviderSpend: [{
      provider: 'openai', cost: 5, count: 3,
      pricedRequests: 2, unknownCostRequests: 1, costComplete: false,
    }],
    getAdminRequestsPaginated: {
      data: [{ ...request, user_id: 'user-1' }, { ...unknownRequest, user_id: 'user-2' }],
      total: 101, page: 2, pageSize: 50,
    },
    getAdminDistinctProviders: ['anthropic', 'openai'],
    getAdminDistinctModels: ['claude-sonnet-4-5', 'gpt-4o'],
    getAdminDistinctUsers: [{ userId: 'user-1', keyCount: 2 }, { userId: 'user-2', keyCount: 1 }],
  };
});

function render(component: React.ReactNode): string {
  return renderToStaticMarkup(component);
}

describe('authenticated page render contracts', () => {
  it('renders the auth shell, dashboard shell, and Clerk entry surfaces', async () => {
    expect(render(<AuthLayout><span>auth child</span></AuthLayout>)).toContain('auth child');
    expect(render(<SignInPage />)).toContain('Clerk sign in');
    expect(render(<SignUpPage />)).toContain('Clerk sign up');

    const layout = render(await DashboardLayout({ children: <span>dashboard child</span> }));
    expect(layout).toContain('dashboard child');
    expect(layout).toContain('Admin');
    expect(layout).toContain('User menu');
  });

  it('renders representative overview, key, provider, settings, and request surfaces', async () => {
    const overview = render(await OverviewPage({ searchParams: Promise.resolve({ days: '7' }) }));
    expect(overview).toContain('Spend is incomplete');
    expect(overview).toContain('Recent Sessions');
    expect(overview).toContain('gpt-4o');

    const keys = render(await KeysPage());
    expect(keys).toContain('Production');
    expect(keys).toContain('llmk_abcd1234');

    const providers = render(await ProvidersPage());
    expect(providers).toContain('Stored keys (1)');
    expect(providers).toContain('+1 cost unknown');
    expect(providers).toContain('Available (10)');

    const settings = render(await SettingsPage());
    expect(settings).toContain('Early operator');
    expect(settings).toContain('$100.00');

    const requests = render(await RequestsPage({
      searchParams: Promise.resolve({
        page: '2', provider: 'openai', model: 'gpt-4o', status: 'ok', session_id: 'session-1',
      }),
    }));
    expect(requests).toContain('Spend is incomplete');
    expect(requests).toContain('Unknown');
    expect(requests).toContain('51 total requests');

    const detail = render(await RequestDetailPage({ params: Promise.resolve({ id: 'req-1' }) }));
    expect(detail).toContain('Receipt / Attribution');
    expect(detail).toContain('Tool Calls (3)');
    expect(detail).toContain('reservation-1');
  });

  it('renders administrator overview and request explorer contracts', async () => {
    const admin = render(await AdminPage({
      searchParams: Promise.resolve({ days: '30', tab: 'overview' }),
    }));
    expect(admin).toContain('Platform spend is incomplete');
    expect(admin).toContain('Known Platform Spend');
    expect(admin).toContain('Loading alerts');

    const explorer = render(await AdminRequestsPage({
      searchParams: Promise.resolve({ page: '2', user: 'user-1', session_id: 'session-1' }),
    }));
    expect(explorer).toContain('Request Explorer');
    expect(explorer).toContain('User:');
    expect(explorer).toContain('101 total requests');
  });

  it('keeps unauthenticated and failed data paths bounded', async () => {
    state.userId = null;
    expect(await OverviewPage({ searchParams: Promise.resolve({}) })).toBeNull();
    expect(await KeysPage()).toBeNull();
    await expect(AdminPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_REDIRECT:/dashboard',
    );

    state.userId = 'user-1';
    state.failures.add('getProviderKeys');
    expect(render(await ProvidersPage())).toContain('Unable to load data');
    state.failures.add('getBudgets');
    expect(render(await SettingsPage())).toContain('Unable to load data');
    state.failures.add('getRequestsPaginated');
    expect(render(await RequestsPage({ searchParams: Promise.resolve({}) }))).toContain(
      'Unable to load data',
    );
    state.failures.add('getRequestById');
    expect(render(await RequestDetailPage({ params: Promise.resolve({ id: 'req-1' }) }))).toContain(
      'Unable to load data',
    );
  });

  it('uses not-found for inaccessible request receipts', async () => {
    state.values.getRequestById = null;
    await expect(RequestDetailPage({ params: Promise.resolve({ id: 'missing' }) }))
      .rejects.toThrow('NEXT_NOT_FOUND');
  });
});
