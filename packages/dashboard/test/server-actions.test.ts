import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type DbResult = {
  data?: Record<string, unknown> | Array<Record<string, unknown>> | null;
  error?: { message: string; code?: string } | null;
  count?: number | null;
};

const state = vi.hoisted(() => ({
  userId: null as string | null,
  queues: {} as Record<string, DbResult[]>,
  calls: [] as Array<{ table: string; operation: string; args: unknown[] }>,
  revalidated: [] as string[],
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(async () => ({ userId: state.userId })),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn((path: string) => state.revalidated.push(path)),
}));

function queryFor(table: string) {
  const result = state.queues[table]?.shift() ?? { data: null, error: null, count: null };
  const query: Record<string, unknown> = {};
  for (const operation of ['select', 'eq']) {
    query[operation] = (...args: unknown[]) => {
      state.calls.push({ table, operation, args });
      return query;
    };
  }
  for (const operation of ['insert', 'update', 'delete']) {
    query[operation] = (...args: unknown[]) => {
      state.calls.push({ table, operation, args });
      return query;
    };
  }
  query.single = async () => result;
  // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are awaitable thenables.
  query.then = (
    resolve: (value: DbResult) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return query;
}

vi.mock('@/lib/supabase', () => ({
  createServerClient: vi.fn(() => ({ from: (table: string) => queryFor(table) })),
}));

import { updateAccount } from '@/app/(auth)/dashboard/admin/actions';
import { createApiKey, revokeApiKey, updateKeyBudget } from '@/app/(auth)/dashboard/keys/actions';
import { addProviderKey, revokeProviderKey } from '@/app/(auth)/dashboard/providers/actions';
import { createBudget, deleteBudget } from '@/app/(auth)/dashboard/settings/actions';
import { sendSupportMessage } from '@/app/(auth)/dashboard/support-action';

const ORIGINAL_ENV = { ...process.env };

function queue(table: string, ...results: DbResult[]) {
  state.queues[table] = results;
}

beforeEach(() => {
  state.userId = `user-${crypto.randomUUID()}`;
  state.queues = {};
  state.calls = [];
  state.revalidated = [];
  process.env = { ...ORIGINAL_ENV };
  delete process.env.ENCRYPTION_KEY;
  vi.restoreAllMocks();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('API key actions', () => {
  it('rejects unauthenticated and invalid key creation requests', async () => {
    state.userId = null;
    await expect(createApiKey('valid')).rejects.toThrow('Unauthorized');

    state.userId = `validation-${crypto.randomUUID()}`;
    await expect(createApiKey('')).rejects.toThrow('Key name must be 1-100 characters');
    await expect(createApiKey('x'.repeat(101))).rejects.toThrow('Key name must be 1-100 characters');
    await expect(createApiKey('bad/name')).rejects.toThrow('Key name contains invalid characters');
  });

  it('creates a hashed key only after verifying budget ownership', async () => {
    const userId = state.userId as string;
    queue('budgets', { data: { user_id: userId }, error: null });
    queue('api_keys', { error: null });

    const created = await createApiKey('Production key', 'budget-1');
    expect(created.key).toMatch(/^llmk_[a-f0-9]{64}$/);
    expect(created.prefix).toBe(created.key.slice(0, 13));
    const insert = state.calls.find((call) => call.table === 'api_keys' && call.operation === 'insert');
    expect(insert).toBeDefined();
    const payload = insert?.args[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      user_id: userId,
      name: 'Production key',
      key_prefix: created.prefix,
      budget_id: 'budget-1',
    });
    expect(payload.key_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(payload)).not.toContain(created.key);
    expect(state.revalidated).toContain('/dashboard/keys');

    queue('budgets', { data: { user_id: 'other-user' }, error: null });
    await expect(createApiKey('Wrong budget', 'budget-2')).rejects.toThrow('Budget not found');
  });

  it('classifies insert failures and limits abusive creation attempts', async () => {
    queue('api_keys', { error: { message: 'database detail' } });
    await expect(createApiKey('Failure key')).rejects.toThrow('Failed to create API key');

    state.userId = `rate-key-${crypto.randomUUID()}`;
    for (let index = 0; index < 10; index += 1) {
      await expect(createApiKey('')).rejects.toThrow('Key name must be 1-100 characters');
    }
    await expect(createApiKey('valid')).rejects.toThrow('Rate limit exceeded');
  });

  it('enforces ownership for revoke and budget assignment', async () => {
    const userId = state.userId as string;
    queue('api_keys', { data: { user_id: 'other-user' }, error: null });
    await expect(revokeApiKey('key-1')).rejects.toThrow('Key not found');

    queue('api_keys',
      { data: { user_id: userId }, error: null },
      { error: null },
    );
    await revokeApiKey('key-1');
    expect(state.revalidated).toContain('/dashboard/keys');

    queue('api_keys',
      { data: { user_id: userId }, error: null },
      { error: null },
    );
    queue('budgets', { data: { user_id: userId }, error: null });
    await updateKeyBudget('key-1', 'budget-1');
    expect(state.calls).toContainEqual({
      table: 'api_keys', operation: 'update', args: [{ budget_id: 'budget-1' }],
    });
  });
});

describe('provider key actions', () => {
  it('validates authentication, provider, key length, and encryption configuration', async () => {
    state.userId = null;
    await expect(addProviderKey('openai', 'abcdefgh')).rejects.toThrow('not authenticated');

    state.userId = `provider-${crypto.randomUUID()}`;
    await expect(addProviderKey('unknown', 'abcdefgh')).rejects.toThrow('invalid provider');
    await expect(addProviderKey('openai', 'short')).rejects.toThrow('at least 8 characters');
    await expect(addProviderKey('openai', 'abcdefgh')).rejects.toThrow('encryption not configured');
  });

  it('encrypts provider credentials with user-provider context before storage', async () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    queue('provider_keys', { error: null });

    await addProviderKey('anthropic', 'sk-ant-very-secret', 'primary');
    const insert = state.calls.find((call) => call.operation === 'insert');
    const payload = insert?.args[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      user_id: state.userId,
      provider: 'anthropic',
      key_prefix: 'sk-ant-...cret',
      key_name: 'primary',
    });
    expect(payload.encrypted_key).not.toContain('very-secret');
    expect(payload.iv).toEqual(expect.any(String));

    queue('provider_keys', { error: { message: 'write failed' } });
    await expect(addProviderKey('openai', 'sk-test-secret')).rejects.toThrow('failed to store key');
  });

  it('scopes provider-key revocation to the authenticated user', async () => {
    queue('provider_keys', { error: null });
    await revokeProviderKey('provider-key-1');
    expect(state.calls).toEqual(expect.arrayContaining([
      { table: 'provider_keys', operation: 'eq', args: ['id', 'provider-key-1'] },
      { table: 'provider_keys', operation: 'eq', args: ['user_id', state.userId] },
    ]));

    queue('provider_keys', { error: { message: 'failure' } });
    await expect(revokeProviderKey('provider-key-2')).rejects.toThrow('failed to revoke key');
  });
});

describe('budget actions', () => {
  it('validates the full budget contract', async () => {
    const user = `budget-validation-${crypto.randomUUID()}`;
    state.userId = user;
    await expect(createBudget('', 100, 'monthly')).rejects.toThrow('Invalid budget name');
    await expect(createBudget('Bad_name', 100, 'monthly')).rejects.toThrow('Invalid budget name');
    await expect(createBudget('Valid', 100, 'yearly')).rejects.toThrow('Invalid period');
    await expect(createBudget('Valid', 100, 'monthly', 'account')).rejects.toThrow('Invalid scope');
    await expect(createBudget('Valid', Number.NaN, 'monthly')).rejects.toThrow('Invalid limit');
    await expect(createBudget('Valid', 100, 'monthly', 'key', 'http://insecure.example'))
      .rejects.toThrow('valid https:// URL');
  });

  it('creates budgets and enforces the operation rate limit', async () => {
    queue('budgets', { error: null });
    await createBudget('Monthly prod', 5000, 'monthly', 'session', 'https://hooks.example/budget');
    expect(state.calls).toContainEqual({
      table: 'budgets',
      operation: 'insert',
      args: [{
        user_id: state.userId,
        name: 'Monthly prod',
        limit_cents: 5000,
        period: 'monthly',
        scope: 'session',
        alert_webhook_url: 'https://hooks.example/budget',
      }],
    });
    expect(state.revalidated).toContain('/dashboard/settings');

    state.userId = `rate-budget-${crypto.randomUUID()}`;
    for (let index = 0; index < 10; index += 1) {
      await expect(createBudget('', 100, 'monthly')).rejects.toThrow('Invalid budget name');
    }
    await expect(createBudget('Valid', 100, 'monthly')).rejects.toThrow('Rate limit exceeded');
  });

  it('preserves receipt history and active key assignments before deletion', async () => {
    const userId = state.userId as string;
    queue('budgets', { data: { user_id: userId }, error: null });
    queue('requests', { count: 2, error: null });
    await expect(deleteBudget('budget-1')).resolves.toEqual({ deleted: false, reason: 'receipt_history' });

    queue('budgets', { data: { user_id: userId }, error: null });
    queue('requests', { count: 0, error: null });
    queue('api_keys', { count: 1, error: null });
    await expect(deleteBudget('budget-2')).resolves.toEqual({ deleted: false, reason: 'active_keys' });

    queue('budgets', { data: { user_id: userId }, error: null }, { error: null });
    queue('requests', { count: 0, error: null });
    queue('api_keys', { count: 0, error: null });
    await expect(deleteBudget('budget-3')).resolves.toEqual({ deleted: true });
  });

  it('maps referential conflicts and surfaces verification failures', async () => {
    const userId = state.userId as string;
    queue('budgets', { data: { user_id: userId }, error: null });
    queue('requests', { count: 0, error: { message: 'receipt check failed' } });
    await expect(deleteBudget('budget-1')).rejects.toThrow('Failed to verify budget history');

    queue('budgets',
      { data: { user_id: userId }, error: null },
      { error: { message: 'api_keys_budget_owner_fkey', code: '23503' } },
    );
    queue('requests', { count: 0, error: null });
    queue('api_keys', { count: 0, error: null });
    await expect(deleteBudget('budget-2')).resolves.toEqual({ deleted: false, reason: 'active_keys' });
  });
});

describe('admin and support actions', () => {
  it('requires an admin plan and validates account updates', async () => {
    queue('accounts', { data: { plan: 'free' }, error: null });
    await expect(updateAccount('target', 'pro', null, '')).rejects.toThrow('Unauthorized');

    queue('accounts', { data: { plan: 'admin' }, error: null });
    await expect(updateAccount('target', 'unknown', null, '')).rejects.toThrow('Invalid plan');

    queue('accounts', { data: { plan: 'admin' }, error: null }, { error: null });
    await updateAccount('target', 'enterprise', '2027-01-01T00:00:00Z', 'approved');
    expect(state.calls).toEqual(expect.arrayContaining([
      { table: 'accounts', operation: 'eq', args: ['user_id', 'target'] },
    ]));
    expect(state.revalidated).toContain('/dashboard/admin');
  });

  it('validates, persists, and rate-limits support messages', async () => {
    state.userId = null;
    await expect(sendSupportMessage('hello')).rejects.toThrow('Not authenticated');

    state.userId = `support-${crypto.randomUUID()}`;
    await expect(sendSupportMessage('')).rejects.toThrow('Invalid message');
    await expect(sendSupportMessage('x'.repeat(2001))).rejects.toThrow('Invalid message');

    queue('support_messages', { error: null }, { error: null }, { error: null });
    await sendSupportMessage('<hello & goodbye>');
    await sendSupportMessage('second');
    await sendSupportMessage('third');
    await expect(sendSupportMessage('fourth')).rejects.toThrow('Too many messages');
    expect(state.calls).toContainEqual({
      table: 'support_messages',
      operation: 'insert',
      args: [{ user_id: state.userId, message: '<hello & goodbye>' }],
    });
  });
});
