// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('echarts-for-react/lib/core', () => ({
  default: () => <div data-testid="chart" />,
}));
vi.mock('@/lib/echarts', () => ({ default: {} }));

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

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('calculator and navigation controls', () => {
  it('requires an explicit model search and recalculates verified matching rows', () => {
    render(<Calculator
      models={[
        { provider: 'openai', model: 'gpt-test', input: 5, output: 15 },
        { provider: 'anthropic', model: 'claude-test', input: 3, output: 12 },
      ]}
      providers={['openai', 'anthropic']}
      pricingSnapshotDate="2026-03-25"
    />);

    expect(screen.getByText(/Search for a specific model/)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/Search a verified/), { target: { value: 'test' } });
    expect(screen.getByText('gpt-test')).toBeTruthy();
    expect(screen.getByText('claude-test')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'openai' }));
    expect(screen.queryByText('gpt-test')).toBeNull();
    fireEvent.click(screen.getByText('Code review'));
    expect((screen.getByLabelText('Input tokens per request') as HTMLInputElement).value).toBe('4000');
    fireEvent.change(screen.getByLabelText('Requests per month'), { target: { value: '-5' } });
    expect((screen.getByLabelText('Requests per month') as HTMLInputElement).value).toBe('0');
    fireEvent.click(screen.getByRole('columnheader', { name: 'Output' }));
    expect(screen.getByText('Output ^')).toBeTruthy();
  });

  it('updates time range, request filters, and pagination without preserving stale pages', () => {
    const { unmount } = render(<TimeRangeSelector />);
    fireEvent.click(screen.getByRole('button', { name: '30d' }));
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(router.push).toHaveBeenCalledWith('/dashboard/requests?provider=openai&model=gpt-4o&status=ok&session_id=session-1');
    expect(router.push).toHaveBeenCalledWith(expect.stringContaining('days=1'));
    unmount();

    render(<RequestFilters providers={['openai', 'anthropic']} models={['gpt-4o']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear session filter' }));
    fireEvent.change(screen.getByLabelText('Filter by provider'), { target: { value: 'anthropic' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(router.push).toHaveBeenCalledWith(expect.stringContaining('provider=anthropic'));
    expect(router.push).toHaveBeenCalledWith('/dashboard/requests');
    cleanup();

    render(<Pagination page={2} totalPages={4} total={88} />);
    fireEvent.click(screen.getByRole('button', { name: 'Prev' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
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

    fireEvent.click(screen.getByRole('button', { name: 'Create Key' }));
    fireEvent.change(screen.getByLabelText('Key Name'), { target: { value: 'Production key' } });
    fireEvent.change(screen.getByLabelText('Budget (optional)'), { target: { value: 'budget-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(actions.createApiKey).toHaveBeenCalledWith('Production key', 'budget-1'));
    expect(screen.getByText('Key Created')).toBeTruthy();
    expect(screen.getAllByText(/llmk_one_time_secret/).length).toBeGreaterThan(0);
    expect(screen.getByText('Local only (no proxy, no dashboard)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy Key' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('llmk_one_time_secret');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: 'Create Key' })).toBeTruthy();
  });

  it('surfaces create-key errors and key assignment/revocation failures', async () => {
    actions.createApiKey.mockRejectedValue(new Error('quota reached'));
    const { unmount } = render(<CreateKeyForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Create Key' }));
    fireEvent.change(screen.getByLabelText('Key Name'), { target: { value: 'Failure' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await screen.findByText('quota reached');
    unmount();

    actions.updateKeyBudget.mockRejectedValue(new Error('failed'));
    render(<KeyBudgetSelector
      keyId="key-1"
      currentBudgetId={null}
      budgets={[{ id: 'budget-1', name: 'Production', limit_cents: 5000, period: 'monthly' }]}
    />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'budget-1' } });
    await screen.findByText('Failed');
    cleanup();

    actions.revokeApiKey.mockRejectedValue(new Error('failed'));
    render(<RevokeKeyButton keyId="key-1" keyName="Production" />);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    await screen.findByText('Failed.');
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
  });

  it('creates scoped budgets and preserves audit history on delete', async () => {
    actions.createBudget.mockResolvedValue(undefined);
    actions.deleteBudget.mockResolvedValue({ deleted: false, reason: 'receipt_history' });
    render(<BudgetManager budgets={[{
      id: 'budget-1', user_id: 'user-1', name: 'Existing', limit_cents: 5000,
      period: 'monthly', scope: 'key', alert_webhook_url: null,
      reset_at: null, created_at: '2026-08-01T00:00:00Z',
    }]} />);

    fireEvent.click(screen.getByRole('button', { name: '+ Add Budget' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Production' } });
    fireEvent.change(screen.getByLabelText('Limit ($)'), { target: { value: '100.50' } });
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'weekly' } });
    fireEvent.click(screen.getByRole('button', { name: 'Per Session' }));
    fireEvent.change(screen.getByLabelText('Alert webhook (optional)'), {
      target: { value: 'https://hooks.example/budget' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(actions.createBudget).toHaveBeenCalledWith(
      'Production', 10050, 'weekly', 'session', 'https://hooks.example/budget',
    ));

    await screen.findByRole('button', { name: '+ Add Budget' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(actions.deleteBudget).toHaveBeenCalledWith('budget-1'));
    await screen.findByText(/durable request receipts/);
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

    fireEvent.click(screen.getByRole('button', { name: 'remove' }));
    await waitFor(() => expect(actions.revokeProviderKey).toHaveBeenCalledWith('provider-key-1'));
    expect(router.refresh).toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole('button', { name: '+ Add key' })[0]);
    fireEvent.change(screen.getByPlaceholderText('Paste API key'), { target: { value: 'sk-test-secret' } });
    fireEvent.change(screen.getByPlaceholderText('Label (optional)'), { target: { value: 'backup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(actions.addProviderKey).toHaveBeenCalledWith('openai', 'sk-test-secret', 'backup'));
  });
});

describe('live status and support controls', () => {
  it('renders analytics status, ecosystem data, and grouped alerts from the API', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
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

    const { unmount } = render(<AnalyticsStatus />);
    expect(await screen.findByText(/STALE/)).toBeTruthy();
    expect(screen.getByText('Proxy degraded')).toBeTruthy();
    unmount();

    render(<EcosystemPanel accountCount={4} activeUserCount={2} />);
    expect(await screen.findByText('GitHub')).toBeTruthy();
    expect(screen.getByText('llmkit-mcp-server')).toBeTruthy();
    expect(screen.getByText('dashboard')).toBeTruthy();
    cleanup();

    render(<AlertsPanel />);
    expect(await screen.findByText('Proxy degraded')).toBeTruthy();
    expect(screen.getByText('Aug 13')).toBeTruthy();
  });

  it('opens support, validates content, sends, and closes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    actions.sendSupportMessage.mockResolvedValue(undefined);
    render(<SupportWidget />);
    fireEvent.click(screen.getByRole('button', { name: 'Open support' }));
    const textarea = screen.getByPlaceholderText('Describe your issue or question...');
    fireEvent.change(textarea, { target: { value: '  Need help  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(actions.sendSupportMessage).toHaveBeenCalledWith('Need help'));
    expect(await screen.findByText('Message sent')).toBeTruthy();
  });
});
