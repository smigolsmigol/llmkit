import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BudgetDO, BudgetState } from '../../src/do/budget-do';
import type { IdempotencyDO } from '../../src/do/idempotency-do';
import type { RateLimitDO } from '../../src/do/ratelimit-do';
import type { Env } from '../../src/env';
import stagingApp from '../../src/staging';

const PROJECT_REF = 'abcdefghijklmnopqrst';
const PROOF_TOKEN = 'local-proof-token';
const PROOF_PREFIX = '/__llmkit_staging_proof';
const SOURCE_COMMIT = 'a'.repeat(40);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

afterEach(() => vi.restoreAllMocks());

function bindings(overrides: Partial<Env['Bindings']> = {}): Env['Bindings'] {
  return {
    ...env,
    STAGING_PROOF_ENABLED: 'true',
    STAGING_PROOF_TOKEN: PROOF_TOKEN,
    STAGING_SOURCE_COMMIT: SOURCE_COMMIT,
    STAGING_SUPABASE_PROJECT_REF: PROJECT_REF,
    SUPABASE_URL: `https://${PROJECT_REF}.supabase.co`,
    ...overrides,
  } as Env['Bindings'];
}

function proofRequest(path: string, init: RequestInit = {}, overrides: Partial<Env['Bindings']> = {}) {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${PROOF_TOKEN}`);
  return stagingApp.request(path, { ...init, headers }, bindings(overrides));
}

describe('isolated staging proof surface', () => {
  it('fails closed on disabled proof mode, database drift, and bad authorization', async () => {
    const budgetId = crypto.randomUUID();
    const disabled = await proofRequest(`${PROOF_PREFIX}/budget/${budgetId}`, {}, {
      STAGING_PROOF_ENABLED: 'false',
    });
    expect(disabled.status).toBe(404);

    const invalidRef = await proofRequest(`${PROOF_PREFIX}/budget/${budgetId}`, {}, {
      STAGING_SUPABASE_PROJECT_REF: 'not-a-project-ref',
    });
    expect(invalidRef.status).toBe(503);

    const mismatchedUrl = await proofRequest(`${PROOF_PREFIX}/budget/${budgetId}`, {}, {
      SUPABASE_URL: 'https://wrong-project.supabase.co',
    });
    expect(mismatchedUrl.status).toBe(503);

    const missingCommit = await proofRequest(`${PROOF_PREFIX}/budget/${budgetId}`, {}, {
      STAGING_SOURCE_COMMIT: undefined,
    });
    expect(missingCommit.status).toBe(503);

    const unauthorized = await stagingApp.request(
      `${PROOF_PREFIX}/budget/${budgetId}`,
      { headers: { authorization: 'Bearer wrong-token' } },
      bindings(),
    );
    expect(unauthorized.status).toBe(401);

    const missingProofToken = await proofRequest(`${PROOF_PREFIX}/budget/${budgetId}`, {}, {
      STAGING_PROOF_TOKEN: undefined,
    });
    expect(missingProofToken.status).toBe(401);
  });

  it('rejects identities that cannot map to the intended Durable Object', async () => {
    const badBudget = await proofRequest(`${PROOF_PREFIX}/budget/not-a-uuid`);
    expect(badBudget.status).toBe(400);
    const badBudgetPurge = await proofRequest(`${PROOF_PREFIX}/budget/not-a-uuid`, {
      method: 'DELETE',
    });
    expect(badBudgetPurge.status).toBe(400);
    const badIdempotency = await proofRequest(`${PROOF_PREFIX}/idempotency/not-a-sha256`, {
      method: 'DELETE',
    });
    expect(badIdempotency.status).toBe(400);
    const badIdempotencyRead = await proofRequest(`${PROOF_PREFIX}/idempotency/not-a-sha256`);
    expect(badIdempotencyRead.status).toBe(400);
    const badRateLimit = await proofRequest(`${PROOF_PREFIX}/ratelimit/not-a-uuid`, {
      method: 'DELETE',
    });
    expect(badRateLimit.status).toBe(400);
    const badRateLimitRead = await proofRequest(`${PROOF_PREFIX}/ratelimit/not-a-uuid`);
    expect(badRateLimitRead.status).toBe(400);
  });

  it('inspects and fully purges a named budget ledger', async () => {
    const budgetId = crypto.randomUUID();
    const stub = env.BUDGET_DO.get(env.BUDGET_DO.idFromName(budgetId)) as DurableObjectStub<BudgetDO>;
    await stub.configure({ limitCents: 10, usedCents: 0, period: 'total', resetAt: 0 });
    await stub.check({ estimatedCents: 3, dispatching: true });

    const snapshot = await proofRequest(`${PROOF_PREFIX}/budget/${budgetId}`);
    expect(snapshot.status).toBe(200);
    await expect(snapshot.json()).resolves.toMatchObject({
      root: { limitCents: 10, usedCents: 0, reservedCents: 3 },
      reservations: 1,
      settlements: 0,
    });

    const purged = await proofRequest(`${PROOF_PREFIX}/budget/${budgetId}`, { method: 'DELETE' });
    expect(purged.status).toBe(200);
    await expect(purged.json()).resolves.toEqual({ purged: true });
    await runInDurableObject(stub, async (_instance, state) => {
      await expect(state.storage.get<BudgetState>('root')).resolves.toBeUndefined();
      await expect(state.storage.list()).resolves.toHaveProperty('size', 0);
      await expect(state.storage.getAlarm()).resolves.toBeNull();
    });
  });

  it('measures real admission and release coordination through the staging Worker', async () => {
    const budgetId = crypto.randomUUID();
    const response = await proofRequest(`${PROOF_PREFIX}/budget/${budgetId}/latency`, {
      method: 'POST',
    });
    expect(response.status).toBe(200);
    const body = await response.json<{ coordinationMs: number }>();
    expect(body.coordinationMs).toBeGreaterThanOrEqual(0);

    const snapshot = await proofRequest(`${PROOF_PREFIX}/budget/${budgetId}`);
    await expect(snapshot.json()).resolves.toMatchObject({
      root: { limitCents: 1_000, usedCents: 0, reservedCents: 0 },
      reservations: 0,
      settlements: 1,
    });
  });

  it('runs a dispatched crash timeout through the real alarm and retains failed outbox work', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('captured staging database outage', { status: 503 }),
    );
    const budgetId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const response = await proofRequest(`${PROOF_PREFIX}/budget/${budgetId}/crash-timeout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId,
        userId: 'staging-proof-user',
        apiKeyId: crypto.randomUUID(),
        customerId: 'staging-proof-customer',
        workflowId: crypto.randomUUID(),
        agentId: crypto.randomUUID(),
        sessionId: 'staging-proof-session',
        endUserId: 'staging-proof-end-user',
        provider: 'openai',
        model: 'gpt-5-mini',
      }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      reservationId: expect.stringMatching(UUID_PATTERN),
      snapshot: {
        root: { limitCents: 1, usedCents: 1, reservedCents: 0 },
        reservations: 0,
        settlements: 1,
        evidence: 1,
        outbox: 1,
      },
    });

    const malformed = await proofRequest(`${PROOF_PREFIX}/budget/${crypto.randomUUID()}/crash-timeout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId }),
    });
    expect(malformed.status).toBe(400);
  });

  it('fully purges a named idempotency ledger', async () => {
    const objectName = 'a'.repeat(64);
    const stub = env.IDEMPOTENCY_DO.get(
      env.IDEMPOTENCY_DO.idFromName(objectName),
    ) as DurableObjectStub<IdempotencyDO>;
    await stub.claim({ fingerprint: 'b'.repeat(64) });

    const purged = await proofRequest(`${PROOF_PREFIX}/idempotency/${objectName}`, { method: 'DELETE' });
    expect(purged.status).toBe(200);
    await runInDurableObject(stub, async (_instance, state) => {
      await expect(state.storage.get('state')).resolves.toBeUndefined();
      await expect(state.storage.list()).resolves.toHaveProperty('size', 0);
      await expect(state.storage.getAlarm()).resolves.toBeNull();
    });
  });

  it('inspects and fully purges a named rate-limit ledger', async () => {
    const objectName = crypto.randomUUID();
    const stub = env.RATE_LIMIT_DO.get(
      env.RATE_LIMIT_DO.idFromName(objectName),
    ) as DurableObjectStub<RateLimitDO>;
    await stub.hit({ limit: 10 });

    const snapshot = await proofRequest(`${PROOF_PREFIX}/ratelimit/${objectName}`);
    expect(snapshot.status).toBe(200);
    await expect(snapshot.json()).resolves.toMatchObject({ count: 1, storedEntries: 2 });

    const purged = await proofRequest(`${PROOF_PREFIX}/ratelimit/${objectName}`, { method: 'DELETE' });
    expect(purged.status).toBe(200);
    await runInDurableObject(stub, async (_instance, state) => {
      await expect(state.storage.list()).resolves.toHaveProperty('size', 0);
    });
  });

  it('keeps the production health route reachable through the staging wrapper', async () => {
    const meta = await proofRequest(`${PROOF_PREFIX}/meta`);
    expect(meta.status).toBe(200);
    await expect(meta.json()).resolves.toEqual({
      sourceCommit: SOURCE_COMMIT,
      databaseProjectRef: PROJECT_REF,
    });

    const response = await stagingApp.request('/health', {}, bindings());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok', version: '0.0.1' });
  });
});
