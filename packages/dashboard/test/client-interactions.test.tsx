import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

const actions = vi.hoisted(() => ({
  addProviderKey: vi.fn(),
  createApiKey: vi.fn(),
  createBudget: vi.fn(),
  deleteBudget: vi.fn(),
  revokeApiKey: vi.fn(),
  revokeProviderKey: vi.fn(),
  sendSupportMessage: vi.fn(),
  updateKeyBudget: vi.fn(),
}));

const router = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/requests',
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(
    'days=7&provider=openai&model=gpt-4o&status=ok&session_id=session-1',
  ),
}));
vi.mock('@/app/(auth)/dashboard/keys/actions', () => ({
  createApiKey: actions.createApiKey,
  revokeApiKey: actions.revokeApiKey,
  updateKeyBudget: actions.updateKeyBudget,
}));
vi.mock('@/app/(auth)/dashboard/providers/actions', () => ({
  addProviderKey: actions.addProviderKey,
  revokeProviderKey: actions.revokeProviderKey,
}));
vi.mock('@/app/(auth)/dashboard/settings/actions', () => ({
  createBudget: actions.createBudget,
  deleteBudget: actions.deleteBudget,
}));
vi.mock('@/app/(auth)/dashboard/support-action', () => ({
  sendSupportMessage: actions.sendSupportMessage,
}));
vi.mock('@/components/charts/package-downloads', () => ({
  PackageDownloadsChart: () => <div data-testid="package-downloads-chart" />,
}));
vi.mock('@/components/charts/sparkline', () => ({
  Sparkline: () => <div data-testid="sparkline" />,
}));

import { AlertsPanel } from '@/app/(auth)/dashboard/admin/alerts-panel';
import { CreateKeyForm } from '@/app/(auth)/dashboard/keys/create-key-form';
import { ProviderGrid } from '@/app/(auth)/dashboard/providers/provider-grid';
import { Calculator } from '@/app/(public)/compare/calculator';
import { AnalyticsStatus } from '@/components/analytics-status';
import { BudgetManager } from '@/components/budget-manager';
import { EcosystemPanel } from '@/components/ecosystem-panel';
import { KeyBudgetSelector } from '@/components/key-budget-selector';
import { Pagination } from '@/components/pagination';
import { RequestFilters } from '@/components/request-filters';
import { RevokeKeyButton } from '@/components/revoke-key-button';
import { SupportWidget } from '@/components/support-widget';
import { TimeRangeSelector } from '@/components/time-range-selector';

type MountedRoot = {
  container: HTMLDivElement;
  root: Root;
};

const mounted = new Set<MountedRoot>();
const clipboardWrite = vi.fn();

function render(element: ReactElement): MountedRoot {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const result = { container, root };
  mounted.add(result);
  root.render(element);
  return result;
}

function unmount(mount: MountedRoot): void {
  mount.root.unmount();
  mount.container.remove();
  mounted.delete(mount);
}

beforeEach(() => {
  vi.clearAllMocks();
  clipboardWrite.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboardWrite },
  });
});

afterEach(() => {
  for (const mount of [...mounted]) unmount(mount);
  vi.clearAllTimers();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('calculator and navigation controls', () => {
  it('requires an explicit model search and recalculates verified matching rows', async () => {
    render(<Calculator
      models={[
        { provider: 'openai', model: 'gpt-test', input: 5, output: 15 },
        { provider: 'anthropic', model: 'claude-test', input: 3, output: 12 },
      ]}
      providers={['openai', 'anthropic']}
      pricingSnapshotDate="2026-03-25"
    />);

    await expect.element(page.getByText(/Search for a specific model/)).toBeInTheDocument();
    await page.getByPlaceholder(/Search a verified/).fill('test');
    await expect.element(page.getByText('gpt-test', { exact: true })).toBeInTheDocument();
    await expect.element(page.getByText('claude-test', { exact: true })).toBeInTheDocument();

    await page.getByRole('button', { name: 'openai', exact: true }).click();
    await expect.element(page.getByText('gpt-test', { exact: true })).not.toBeInTheDocument();
    await page.getByRole('button', { name: 'Code review', exact: true }).click();
    await expect.element(page.getByLabelText('Input tokens per request')).toHaveValue(4000);
    await page.getByLabelText('Requests per month').fill('-5');
    await expect.element(page.getByLabelText('Requests per month')).toHaveValue(0);
    const outputHeader = page.getByRole('columnheader', { name: 'Output', exact: true });
    await outputHeader.click();
    await expect.element(page.getByText('Output ^', { exact: true })).toBeInTheDocument();
  });

  it('updates time range, request filters, and pagination without preserving stale pages', async () => {
    const timeRange = render(<TimeRangeSelector />);
    await page.getByRole('button', { name: '30d', exact: true }).click();
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    expect(router.push).toHaveBeenCalledWith('/dashboard/requests?provider=openai&model=gpt-4o&status=ok&session_id=session-1');
    expect(router.push).toHaveBeenCalledWith(expect.stringContaining('days=1'));
    unmount(timeRange);

    const filters = render(<RequestFilters providers={['openai', 'anthropic']} models={['gpt-4o']} />);
    await page.getByRole('button', { name: 'Clear session filter', exact: true }).click();
    await page.getByLabelText('Filter by provider').selectOptions('anthropic');
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    expect(router.push).toHaveBeenCalledWith(expect.stringContaining('provider=anthropic'));
    expect(router.push).toHaveBeenCalledWith('/dashboard/requests');
    unmount(filters);

    render(<Pagination page={2} totalPages={4} total={88} />);
    await page.getByRole('button', { name: 'Prev', exact: true }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    expect(router.push).toHaveBeenCalledWith(expect.stringContaining('page=1'));
    expect(router.push).toHaveBeenCalledWith(expect.stringContaining('page=3'));
  });
});

describe('credential and budget controls', () => {
  it('creates a key, exposes one-time setup snippets, copies, and closes', async () => {
    actions.createApiKey.mockResolvedValue({ key: 'llmk_one_time_secret', prefix: 'llmk_one' });
    render(<CreateKeyForm budgets={[
      { id: 'budget-1', name: 'Production', limit_cents: 5000, period: 'monthly' },
    ]} />);

    await page.getByRole('button', { name: 'Create Key', exact: true }).click();
    await page.getByLabelText('Key Name').fill('Production key');
    await page.getByLabelText('Budget (optional)').selectOptions('budget-1');
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    await vi.waitFor(() => expect(actions.createApiKey).toHaveBeenCalledWith('Production key', 'budget-1'));
    await expect.element(page.getByText('Key Created', { exact: true })).toBeInTheDocument();
    await expect.element(page.getByText(/llmk_one_time_secret/).first()).toBeInTheDocument();
    await expect.element(page.getByText('Local only (no proxy, no dashboard)', { exact: true }))
      .toBeInTheDocument();
    await page.getByRole('button', { name: 'Copy Key', exact: true }).click();
    expect(clipboardWrite).toHaveBeenCalledWith('llmk_one_time_secret');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect.element(page.getByRole('button', { name: 'Create Key', exact: true }))
      .toBeInTheDocument();
  });

  it('surfaces create-key errors and key assignment/revocation failures', async () => {
    actions.createApiKey.mockRejectedValue(new Error('quota reached'));
    const createKey = render(<CreateKeyForm />);
    await page.getByRole('button', { name: 'Create Key', exact: true }).click();
    await page.getByLabelText('Key Name').fill('Failure');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect.element(page.getByText('quota reached', { exact: true })).toBeInTheDocument();
    unmount(createKey);

    actions.updateKeyBudget.mockRejectedValue(new Error('failed'));
    const budgetSelector = render(<KeyBudgetSelector
      keyId="key-1"
      currentBudgetId={null}
      budgets={[{ id: 'budget-1', name: 'Production', limit_cents: 5000, period: 'monthly' }]}
    />);
    await page.getByRole('combobox').selectOptions('budget-1');
    await expect.element(page.getByText('Failed', { exact: true })).toBeInTheDocument();
    unmount(budgetSelector);

    actions.revokeApiKey.mockRejectedValue(new Error('failed'));
    render(<RevokeKeyButton keyId="key-1" keyName="Production" />);
    await page.getByRole('button', { name: 'Revoke', exact: true }).click();
    await page.getByRole('button', { name: 'Yes', exact: true }).click();
    await expect.element(page.getByText('Failed.', { exact: true })).toBeInTheDocument();
    await page.getByRole('button', { name: 'No', exact: true }).click();
  });

  it('creates scoped budgets and preserves audit history on delete', async () => {
    actions.createBudget.mockResolvedValue(undefined);
    actions.deleteBudget.mockResolvedValue({ deleted: false, reason: 'receipt_history' });
    render(<BudgetManager budgets={[{
      id: 'budget-1', user_id: 'user-1', name: 'Existing', limit_cents: 5000,
      period: 'monthly', scope: 'key', alert_webhook_url: null,
      reset_at: null, created_at: '2026-08-01T00:00:00Z',
    }]} />);

    await page.getByRole('button', { name: '+ Add Budget', exact: true }).click();
    await page.getByLabelText('Name').fill('Production');
    await page.getByLabelText('Limit ($)').fill('100.50');
    await page.getByLabelText('Period').selectOptions('weekly');
    await page.getByRole('button', { name: 'Per Session', exact: true }).click();
    await page.getByLabelText('Alert webhook (optional)').fill('https://hooks.example/budget');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await vi.waitFor(() => expect(actions.createBudget).toHaveBeenCalledWith(
      'Production', 10050, 'weekly', 'session', 'https://hooks.example/budget',
    ));

    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await vi.waitFor(() => expect(actions.deleteBudget).toHaveBeenCalledWith('budget-1'));
    await expect.element(page.getByText(/durable request receipts/)).toBeInTheDocument();
  });

  it('adds and revokes encrypted-provider references through the grid', async () => {
    actions.addProviderKey.mockResolvedValue(undefined);
    actions.revokeProviderKey.mockResolvedValue(undefined);
    render(<ProviderGrid
      storedKeys={[{
        id: 'provider-key-1', provider: 'openai', key_prefix: 'sk-proj...cret',
        key_name: 'primary', created_at: '2026-08-01T00:00:00Z', revoked_at: null,
      }]}
      activity={[{
        provider: 'openai', requests: 2, spendCents: 25, pricedRequests: 1,
        unknownCostRequests: 1, costComplete: false, lastUsed: new Date().toISOString(),
        lastError: 'rate_limit', lastErrorTime: new Date().toISOString(),
        models: [{ model: 'gpt-4o', count: 2 }],
      }]}
    />);

    await page.getByRole('button', { name: 'remove', exact: true }).click();
    await vi.waitFor(() => expect(actions.revokeProviderKey).toHaveBeenCalledWith('provider-key-1'));
    expect(router.refresh).toHaveBeenCalled();

    await page.getByRole('button', { name: '+ Add key', exact: true }).first().click();
    await page.getByPlaceholder('Paste API key').fill('sk-test-secret');
    await page.getByPlaceholder('Label (optional)').fill('backup');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await vi.waitFor(() => expect(actions.addProviderKey).toHaveBeenCalledWith('openai', 'sk-test-secret', 'backup'));
  });
});

describe('live status and support controls', () => {
  it('renders analytics status, ecosystem data, and grouped alerts from the API', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-13T12:00:00Z'));
    const payload = {
      freshness: { lastCollection: '2026-08-13T09:00:00Z', version: '2.0' },
      accounts: { total: 4 },
      alerts: [{ type: 'health', message: 'Proxy degraded', created_at: '2026-08-13T11:00:00Z' }],
      npm: [{
        name: '@f3d1/llmkit-mcp-server', weekly: 1200, weeklyRaw: 1500,
        total: 5000, recent: 100, recentDay: '2026-08-13',
        daily: [{ day: '2026-08-13', count: 100, raw: 120, ci_noise: 20 }],
      }],
      pypi: { name: 'llmkit-sdk', weekly: 200, total: 800 },
      github: { stars: 42, forks: 5, openIssues: 3, watchers: 7 },
      health: [
        { service: 'proxy', status: 'up', latencyMs: 20, lastCheck: '2026-08-13T11:59:00Z' },
        { service: 'dashboard', status: 'degraded', latencyMs: 80, lastCheck: '2026-08-13T10:00:00Z' },
        { service: 'collector', status: 'down', latencyMs: 0, lastCheck: '2026-08-11T10:00:00Z' },
      ],
      updatedAt: '2026-08-13T11:59:00Z',
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })));

    const analytics = render(<AnalyticsStatus />);
    await expect.element(page.getByText(/STALE/)).toBeInTheDocument();
    await expect.element(page.getByText('Proxy degraded', { exact: true })).toBeInTheDocument();
    unmount(analytics);

    const ecosystem = render(<EcosystemPanel accountCount={4} activeUserCount={2} />);
    await expect.element(page.getByText('GitHub', { exact: true }).first()).toBeInTheDocument();
    await expect.element(page.getByText('llmkit-mcp-server', { exact: true })).toBeInTheDocument();
    await expect.element(page.getByText('dashboard', { exact: true }).first()).toBeInTheDocument();
    unmount(ecosystem);

    render(<AlertsPanel />);
    await expect.element(page.getByText('Proxy degraded', { exact: true })).toBeInTheDocument();
    await expect.element(page.getByText('Aug 13', { exact: true })).toBeInTheDocument();
  });

  it('opens support, validates content, sends, and closes', async () => {
    actions.sendSupportMessage.mockResolvedValue(undefined);
    render(<SupportWidget />);
    await page.getByRole('button', { name: 'Open support', exact: true }).click();
    await page.getByPlaceholder('Describe your issue or question...').fill('  Need help  ');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await vi.waitFor(() => expect(actions.sendSupportMessage).toHaveBeenCalledWith('Need help'));
    await expect.element(page.getByText('Message sent', { exact: true })).toBeInTheDocument();
  });
});
