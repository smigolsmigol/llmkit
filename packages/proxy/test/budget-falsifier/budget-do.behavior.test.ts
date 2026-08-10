import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import type { RequestInsert } from '../../src/db';
import {
  type BudgetDO,
  type BudgetState,
  nextReset,
  periodMs,
  RESERVATION_TTL_MS,
} from '../../src/do/budget-do';
import { MAX_PROVIDER_EXECUTION_MS } from '../../src/providers/request';

const DAY_MS = 86_400_000;

function budgetStub(name: string): DurableObjectStub<BudgetDO> {
  return env.BUDGET_DO.get(env.BUDGET_DO.idFromName(name));
}

function uniqueName(label: string): string {
  return `${label}-${crypto.randomUUID()}`;
}

function receipt(id: string, budgetId: string): RequestInsert {
  return {
    id,
    user_id: 'receipt-user',
    api_key_id: 'receipt-api-key',
    customer_id: 'receipt-customer',
    workflow_id: null,
    agent_id: null,
    session_id: null,
    end_user_id: null,
    budget_id: budgetId,
    budget_reservation_id: null,
    reserved_cost_cents: 5,
    settlement_status: 'pending',
    idempotency_key_hash: null,
    response_sha256: null,
    provider: 'openai',
    model: 'gpt-4o-mini',
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cost_cents: null,
    latency_ms: 0,
    status: 'pending',
    error_code: null,
    source: 'proxy',
    tool_calls: null,
  };
}

describe('BudgetDO production ledger behavior', () => {
  it('derives daily, weekly, and monthly reset boundaries from the production clock helpers', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-31T23:00:00.000Z'));
    try {
      expect(nextReset('daily')).toBe(Date.parse('2024-02-01T00:00:00.000Z'));
      expect(nextReset('weekly')).toBe(Date.parse('2024-02-05T00:00:00.000Z'));
      expect(nextReset('monthly')).toBe(Date.parse('2024-02-01T00:00:00.000Z'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps alert windows explicit for every persisted period shape', () => {
    expect(periodMs('daily')).toBe(DAY_MS);
    expect(periodMs('weekly')).toBe(7 * DAY_MS);
    expect(periodMs('monthly')).toBe(30 * DAY_MS);
    expect(periodMs('total')).toBe(30 * DAY_MS);
  });

  it('keeps a dispatched reservation live through the maximum fallback execution window', async () => {
    expect(RESERVATION_TTL_MS).toBeGreaterThan(MAX_PROVIDER_EXECUTION_MS);
    const stub = budgetStub(uniqueName('aggregate-timeout'));
    const admitted = await stub.check({
      estimatedCents: 10,
      budgetConfig: { limitCents: 100, period: 'total' },
      dispatching: true,
    });
    await runInDurableObject(stub, async (instance, state) => {
      const key = `r:${admitted.reservationId}`;
      const reservation = await state.storage.get<Record<string, unknown>>(key);
      await state.storage.put(key, { ...reservation, createdAt: Date.now() - MAX_PROVIDER_EXECUTION_MS });
      await instance.alarm();
      await expect(state.storage.get(key)).resolves.toBeDefined();
    });

    await stub.record({ reservationId: admitted.reservationId, costCents: 3 });
    await runInDurableObject(stub, async (_instance, state) => {
      await expect(state.storage.get<BudgetState>('root')).resolves.toMatchObject({ usedCents: 3, reservedCents: 0 });
    });
  });

  it('keeps the backwards-compatible no-budget and no-root paths explicit', async () => {
    const stub = budgetStub(uniqueName('unconfigured'));
    const check = await stub.check({ estimatedCents: 5 });

    expect(check).toMatchObject({
      allowed: true,
      remaining: Infinity,
      reservationId: '',
      limitCents: 0,
      usedCents: 0,
    });
    await expect(stub.record({ reservationId: '', costCents: 5 })).resolves.toEqual({
      usedCents: 0,
      limitCents: 0,
      settlementAccepted: true,
    });
    await expect(stub.release('')).resolves.toBeUndefined();
    await expect(stub.release('missing')).resolves.toBeUndefined();
    await expect(stub.markDispatched('')).resolves.toBe(false);
    await expect(stub.finalizeFailure('')).resolves.toMatchObject({ disposition: 'missing' });
    await expect(stub.finalizeFailure('missing')).resolves.toMatchObject({ disposition: 'missing' });

    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.put('r:orphan', { amount: 5, createdAt: Date.now() });
    });
    await stub.release('orphan');
    await runInDurableObject(stub, async (_instance, state) => {
      await expect(state.storage.get('r:orphan')).resolves.toBeUndefined();
    });

    const legacyStub = budgetStub(uniqueName('legacy-reserved'));
    await runInDurableObject(legacyStub, async (_instance, state) => {
      await state.storage.put('root', {
        limitCents: 100,
        usedCents: 0,
        period: 'total',
        resetAt: 0,
      } as BudgetState);
      await state.storage.put('r:legacy', { amount: 5, createdAt: Date.now() });
    });
    await legacyStub.release('legacy');
    await runInDurableObject(legacyStub, async (_instance, state) => {
      await expect(state.storage.get<BudgetState>('root')).resolves.toMatchObject({ reservedCents: 0 });
    });

    const legacySessionStub = budgetStub(uniqueName('legacy-session-reserved'));
    await runInDurableObject(legacySessionStub, async (_instance, state) => {
      await state.storage.put('root', {
        limitCents: 100,
        usedCents: 0,
        reservedCents: 5,
        period: 'total',
        resetAt: 0,
        scope: 'session',
      } satisfies BudgetState);
      await state.storage.put('s:legacy', {
        limitCents: 100,
        usedCents: 0,
        period: 'total',
        resetAt: 0,
      } as BudgetState);
      await state.storage.put('r:legacy-session', {
        amount: 5,
        sessionId: 'legacy',
        createdAt: Date.now(),
      });
    });
    await legacySessionStub.release('legacy-session');
    await runInDurableObject(legacySessionStub, async (_instance, state) => {
      await expect(state.storage.get<BudgetState>('s:legacy')).resolves.toMatchObject({ reservedCents: 0 });
    });
  });

  it('initializes and synchronizes inline budget configuration', async () => {
    const stub = budgetStub(uniqueName('config-sync'));
    const first = await stub.check({
      estimatedCents: 5,
      budgetConfig: { limitCents: 100, period: 'total' },
    });
    await stub.record({ reservationId: first.reservationId, costCents: 5 });

    const synced = await stub.check({
      estimatedCents: 10,
      budgetConfig: { limitCents: 200, period: 'daily' },
    });
    expect(synced).toMatchObject({ allowed: true, limitCents: 200, usedCents: 5 });

    const denied = await stub.check({
      estimatedCents: 300,
      budgetConfig: { limitCents: 200, period: 'daily' },
    });
    expect(denied).toMatchObject({ allowed: false, limitCents: 200, usedCents: 5 });
    await stub.release(synced.reservationId);
  });

  it('tracks session and root reservations atomically', async () => {
    const name = uniqueName('session');
    const stub = budgetStub(name);
    await stub.configure({
      limitCents: 100,
      usedCents: 0,
      period: 'total',
      resetAt: 0,
      scope: 'session',
    });

    const first = await stub.check({ estimatedCents: 60, sessionId: 'a' });
    const rootBlocked = await stub.check({ estimatedCents: 50, sessionId: 'b' });
    expect(first.allowed).toBe(true);
    expect(rootBlocked.allowed).toBe(false);

    await stub.record({ reservationId: first.reservationId, sessionId: 'a', costCents: 30 });
    const replacement = await stub.check({ estimatedCents: 70, sessionId: 'b' });
    expect(replacement.allowed).toBe(true);
    await stub.release(replacement.reservationId);
    await stub.release(replacement.reservationId);

    const snapshot = await runInDurableObject(stub, async (_instance, state) => ({
      root: await state.storage.get<BudgetState>('root'),
      sessionA: await state.storage.get<BudgetState>('s:a'),
      sessionB: await state.storage.get<BudgetState>('s:b'),
    }));
    expect(snapshot.root).toMatchObject({ usedCents: 30, reservedCents: 0 });
    expect(snapshot.sessionA).toMatchObject({ usedCents: 30, reservedCents: 0 });
    expect(snapshot.sessionB).toMatchObject({ usedCents: 0, reservedCents: 0 });
  });

  it('settles against the session identity stored on the reservation', async () => {
    const stub = budgetStub(uniqueName('session-binding'));
    await stub.configure({
      limitCents: 100,
      usedCents: 0,
      period: 'total',
      resetAt: 0,
      scope: 'session',
    });

    const reservation = await stub.check({ estimatedCents: 25, sessionId: 'session-a' });
    await stub.record({
      reservationId: reservation.reservationId,
      sessionId: 'session-b',
      costCents: 15,
    });

    const snapshot = await runInDurableObject(stub, async (_instance, state) => ({
      root: await state.storage.get<BudgetState>('root'),
      sessionA: await state.storage.get<BudgetState>('s:session-a'),
      sessionB: await state.storage.get<BudgetState>('s:session-b'),
      reservations: (await state.storage.list({ prefix: 'r:' })).size,
    }));
    expect(snapshot.root).toMatchObject({ usedCents: 15, reservedCents: 0 });
    expect(snapshot.sessionA).toMatchObject({ usedCents: 15, reservedCents: 0 });
    expect(snapshot.sessionB).toBeUndefined();
    expect(snapshot.reservations).toBe(0);
  });

  it('releases pre-dispatch failures and commits post-dispatch unknown outcomes exactly once', async () => {
    const stub = budgetStub(uniqueName('failure-finalization'));
    await stub.configure({
      limitCents: 100,
      usedCents: 0,
      period: 'total',
      resetAt: 0,
      scope: 'session',
    });

    const preDispatch = await stub.check({ estimatedCents: 25, sessionId: 'session-a' });
    await expect(stub.finalizeFailure(preDispatch.reservationId)).resolves.toMatchObject({
      disposition: 'released',
      committedCents: 0,
    });

    const explicitlyDispatched = await stub.check({ estimatedCents: 25, sessionId: 'session-a' });
    await expect(stub.markDispatched(explicitlyDispatched.reservationId)).resolves.toBe(true);
    await stub.release(explicitlyDispatched.reservationId);

    const postDispatch = await stub.check({ estimatedCents: 25, sessionId: 'session-a', dispatching: true });
    await expect(stub.markDispatched(postDispatch.reservationId)).resolves.toBe(true);
    await expect(stub.markDispatched(postDispatch.reservationId)).resolves.toBe(true);
    await expect(stub.finalizeFailure(postDispatch.reservationId)).resolves.toMatchObject({
      disposition: 'committed',
      committedCents: 25,
      usedCents: 25,
    });
    await expect(stub.finalizeFailure(postDispatch.reservationId)).resolves.toMatchObject({
      disposition: 'committed',
      committedCents: 25,
      usedCents: 25,
    });
    await expect(stub.markDispatched('missing')).resolves.toBe(false);
    await stub.record({ reservationId: postDispatch.reservationId, sessionId: 'wrong-session', costCents: 1 });

    const snapshot = await runInDurableObject(stub, async (_instance, state) => ({
      root: await state.storage.get<BudgetState>('root'),
      session: await state.storage.get<BudgetState>('s:session-a'),
      reservations: (await state.storage.list({ prefix: 'r:' })).size,
      tombstones: (await state.storage.list({ prefix: 't:' })).size,
    }));
    expect(snapshot.root).toMatchObject({ usedCents: 25, reservedCents: 0 });
    expect(snapshot.session).toMatchObject({ usedCents: 25, reservedCents: 0 });
    expect(snapshot.reservations).toBe(0);
    expect(snapshot.tombstones).toBe(3);
  });

  it('keeps one durable receipt identity through every terminal ledger path', async () => {
    const database = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 201 }));
    const stubs: Array<DurableObjectStub<BudgetDO>> = [];
    const makeStub = (label: string) => {
      const stub = budgetStub(uniqueName(label));
      stubs.push(stub);
      return stub;
    };

    const noRoot = makeStub('receipt-no-root');
    await noRoot.record({
      reservationId: '',
      costCents: 1,
      receipt: receipt(crypto.randomUUID(), 'receipt-no-root'),
    });
    await noRoot.finalizeFailure(
      'missing',
      receipt(crypto.randomUUID(), 'receipt-no-root'),
    );

    const configured = makeStub('receipt-terminal-paths');
    await configured.configure({ limitCents: 100, usedCents: 0, period: 'total', resetAt: 0 });

    const released = await configured.check({
      estimatedCents: 5,
      receipt: receipt(crypto.randomUUID(), 'receipt-terminal-paths'),
    });
    await configured.release(released.reservationId);

    const preDispatch = await configured.check({
      estimatedCents: 5,
      receipt: receipt(crypto.randomUUID(), 'receipt-terminal-paths'),
    });
    await configured.finalizeFailure(preDispatch.reservationId);

    const preDispatchReceipt = receipt(crypto.randomUUID(), 'receipt-terminal-paths');
    const preDispatchWithReceipt = await configured.check({
      estimatedCents: 5,
      receipt: preDispatchReceipt,
    });
    await configured.finalizeFailure(
      preDispatchWithReceipt.reservationId,
      preDispatchReceipt,
    );
    const conflictingReleasedReceipt: RequestInsert = {
      ...preDispatchReceipt,
      cost_cents: 5,
      settlement_status: 'committed_ceiling',
      status: 'error',
      error_code: 'LATE_RELEASE_FAILURE',
    };
    await expect(configured.finalizeFailure(
      preDispatchWithReceipt.reservationId,
      conflictingReleasedReceipt,
    )).resolves.toMatchObject({ disposition: 'released', committedCents: 0 });
    const preservedRelease = await runInDurableObject(configured, async (_instance, state) => (
      state.storage.get<{ row: RequestInsert }>(`e:${preDispatchReceipt.id}`)
    ));
    expect(preservedRelease?.row).toMatchObject({
      cost_cents: 0,
      settlement_status: 'released',
    });

    const legacyReceipt = receipt(crypto.randomUUID(), 'receipt-terminal-paths');
    await runInDurableObject(configured, async (_instance, state) => {
      await state.storage.put('t:legacy-finalization', {
        costCents: 4,
        createdAt: Date.now(),
        reservationFound: true,
      });
    });
    await expect(configured.finalizeFailure(
      'legacy-finalization',
      legacyReceipt,
    )).resolves.toMatchObject({ disposition: 'committed', committedCents: 4 });
    const preservedLegacy = await runInDurableObject(configured, async (_instance, state) => (
      state.storage.get<{ row: RequestInsert }>(`e:${legacyReceipt.id}`)
    ));
    expect(preservedLegacy?.row).toMatchObject({
      cost_cents: 4,
      settlement_status: 'committed_ceiling',
    });

    const committed = await configured.check({
      estimatedCents: 5,
      dispatching: true,
      receipt: receipt(crypto.randomUUID(), 'receipt-terminal-paths'),
    });
    await configured.finalizeFailure(committed.reservationId);

    const committedReceipt = receipt(crypto.randomUUID(), 'receipt-terminal-paths');
    const committedWithReceipt = await configured.check({
      estimatedCents: 5,
      dispatching: true,
      receipt: committedReceipt,
    });
    await configured.finalizeFailure(
      committedWithReceipt.reservationId,
      committedReceipt,
    );

    const settledReceipt = receipt(crypto.randomUUID(), 'receipt-terminal-paths');
    const settled = await configured.check({ estimatedCents: 5, receipt: settledReceipt });
    const exactSettlement: RequestInsert = {
      ...settledReceipt,
      budget_reservation_id: settled.reservationId,
      settlement_status: 'settled_actual',
      cost_cents: 3,
      status: 'success',
    };
    await configured.record({ reservationId: settled.reservationId, costCents: 3, receipt: exactSettlement });
    const conflictingLateFailure: RequestInsert = {
      ...exactSettlement,
      settlement_status: 'committed_ceiling',
      cost_cents: 5,
      status: 'error',
      error_code: 'LATE_FAILURE',
    };
    await configured.record({
      reservationId: settled.reservationId,
      costCents: 5,
      receipt: conflictingLateFailure,
    });
    await configured.finalizeFailure(settled.reservationId, conflictingLateFailure);
    const preservedSettlement = await runInDurableObject(configured, async (_instance, state) => (
      state.storage.get<{ row: RequestInsert }>(`e:${settledReceipt.id}`)
    ));
    expect(preservedSettlement?.row).toMatchObject({
      cost_cents: 3,
      settlement_status: 'settled_actual',
      status: 'success',
      error_code: null,
    });
    await configured.finalizeFailure('never-created', receipt(crypto.randomUUID(), 'receipt-terminal-paths'));

    const zeroReceipt = receipt(crypto.randomUUID(), 'receipt-terminal-paths');
    const zero = await configured.check({ estimatedCents: 5, receipt: zeroReceipt });
    await configured.record({ reservationId: zero.reservationId, costCents: 0, receipt: zeroReceipt });
    await expect(configured.attachResponseHash(zeroReceipt.id, 'invalid')).resolves.toBe(false);

    const timeout = makeStub('receipt-timeout');
    await timeout.configure({ limitCents: 100, usedCents: 0, period: 'total', resetAt: 0 });
    const dispatchedReceipt = receipt(crypto.randomUUID(), 'receipt-timeout');
    const dispatched = await timeout.check({
      estimatedCents: 5,
      dispatching: true,
      receipt: dispatchedReceipt,
    });
    const undispatchedReceipt = receipt(crypto.randomUUID(), 'receipt-timeout');
    const undispatched = await timeout.check({ estimatedCents: 5, receipt: undispatchedReceipt });
    const timeoutEvidence = await runInDurableObject(timeout, async (instance, state) => {
      for (const reservationId of [dispatched.reservationId, undispatched.reservationId]) {
        const key = `r:${reservationId}`;
        const value = await state.storage.get<Record<string, unknown>>(key);
        await state.storage.put(key, { ...value, createdAt: Date.now() - RESERVATION_TTL_MS - 1 });
      }
      await instance.alarm();
      return {
        dispatched: await state.storage.get<{ row: RequestInsert }>(`e:${dispatchedReceipt.id}`),
        undispatched: await state.storage.get<{ row: RequestInsert }>(`e:${undispatchedReceipt.id}`),
      };
    });
    expect(timeoutEvidence.dispatched?.row).toMatchObject({
      settlement_status: 'committed_ceiling',
      error_code: 'RESERVATION_TIMEOUT',
    });
    expect(timeoutEvidence.undispatched?.row).toMatchObject({
      settlement_status: 'released',
      error_code: 'RESERVATION_TIMEOUT',
    });

    for (const stub of stubs) {
      await vi.waitFor(async () => {
        await expect(stub.stagingProofSnapshot()).resolves.toMatchObject({ outbox: 0 });
      }, { timeout: 60_000, interval: 10 });
    }
    expect(database).toHaveBeenCalled();
    database.mockRestore();
  });

  it('resets an expired period without orphaning an in-flight reservation', async () => {
    const stub = budgetStub(uniqueName('period-reset'));
    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.put('root', {
        limitCents: 100,
        usedCents: 80,
        reservedCents: 20,
        period: 'daily',
        resetAt: Date.now() - 1,
      } satisfies BudgetState);
      await state.storage.put('r:old', { amount: 20, createdAt: Date.now() });
      await state.storage.put('s:old', {
        limitCents: 100,
        usedCents: 20,
        reservedCents: 0,
        period: 'daily',
        resetAt: Date.now() - 1,
      } satisfies BudgetState);
      await state.storage.put('s:old:ts', Date.now());
    });

    const check = await stub.check({
      estimatedCents: 25,
      budgetConfig: { limitCents: 100, period: 'daily' },
    });
    expect(check).toMatchObject({ allowed: true, usedCents: 0, remaining: 55 });

    const snapshot = await runInDurableObject(stub, async (_instance, state) => ({
      root: await state.storage.get<BudgetState>('root'),
      oldReservation: await state.storage.get('r:old'),
      oldSession: await state.storage.get('s:old'),
      reservations: (await state.storage.list({ prefix: 'r:' })).size,
    }));
    expect(snapshot.root).toMatchObject({ usedCents: 0, reservedCents: 45 });
    expect(snapshot.oldReservation).toBeDefined();
    expect(snapshot.oldSession).toBeUndefined();
    expect(snapshot.reservations).toBe(2);
    await stub.release(check.reservationId);
    await stub.release('old');
  });

  it('emits threshold and anomaly evidence without duplicate alerts', async () => {
    const thresholdStub = budgetStub(uniqueName('threshold'));
    await thresholdStub.configure({
      limitCents: 100,
      usedCents: 0,
      period: 'total',
      resetAt: 0,
      alertThreshold: 0.8,
      alertWebhookUrl: 'https://alerts.invalid/budget',
    });
    const thresholdReservation = await thresholdStub.check({ estimatedCents: 85 });
    const threshold = await thresholdStub.record({
      reservationId: thresholdReservation.reservationId,
      costCents: 85,
    });
    expect(threshold.alert).toMatchObject({ percentage: 85, period: 'total' });
    const once = await thresholdStub.record({ reservationId: 'late-threshold', costCents: 1 });
    expect(once.alert).toBeUndefined();

    const anomalyStub = budgetStub(uniqueName('anomaly'));
    await anomalyStub.configure({
      limitCents: 10_000,
      usedCents: 0,
      period: 'total',
      resetAt: 0,
      alertThreshold: 2,
      alertWebhookUrl: 'https://alerts.invalid/anomaly',
    });
    for (let index = 0; index < 5; index += 1) {
      const normal = await anomalyStub.record({ reservationId: `normal-${index}`, costCents: 10 });
      expect(normal.alert).toBeUndefined();
    }
    const anomalous = await anomalyStub.record({ reservationId: 'anomalous', costCents: 40 });
    expect(anomalous.alert?.anomaly).toEqual({ costCents: 40, medianCents: 10, multiplier: 4 });
    const cooldown = await anomalyStub.record({ reservationId: 'cooldown', costCents: 50 });
    expect(cooldown.alert).toBeUndefined();
  });

  it('settles concurrent duplicate deliveries once and documents reservationless compatibility', async () => {
    const name = uniqueName('replay');
    const stub = budgetStub(name);
    await stub.configure({ limitCents: 100, usedCents: 0, period: 'total', resetAt: 0 });
    const check = await stub.check({ estimatedCents: 25 });

    await Promise.all(Array.from({ length: 20 }, () => stub.record({
      reservationId: check.reservationId,
      costCents: 25,
    })));
    await stub.record({ reservationId: 'unknown-reservation', costCents: 5 });
    await stub.record({ reservationId: 'unknown-reservation', costCents: 5 });
    await stub.record({ reservationId: '', costCents: 5 });
    await stub.record({ reservationId: '', costCents: 5 });
    const zeroCost = await stub.check({ estimatedCents: 10 });
    await stub.record({ reservationId: zeroCost.reservationId, costCents: 0 });

    const root = await runInDurableObject(stub, async (_instance, state) => (
      state.storage.get<BudgetState>('root')
    ));
    expect(root).toMatchObject({ usedCents: 40, reservedCents: 0 });
  });

  it('reclaims stale state atomically while retaining live reservations and tombstones', async () => {
    const stub = budgetStub(uniqueName('alarm'));
    const now = Date.now();
    const result = await runInDurableObject(stub, async (instance, state) => {
      await state.storage.put('root', {
        limitCents: 100,
        usedCents: 0,
        reservedCents: 60,
        period: 'total',
        resetAt: 0,
        scope: 'session',
      } satisfies BudgetState);
      await state.storage.put('s:expired', {
        limitCents: 100,
        usedCents: 0,
        reservedCents: 20,
        period: 'total',
        resetAt: 0,
      } satisfies BudgetState);
      await state.storage.put('s:expired:ts', now - (8 * DAY_MS));
      await state.storage.put('s:live', {
        limitCents: 100,
        usedCents: 0,
        reservedCents: 40,
        period: 'total',
        resetAt: 0,
      } satisfies BudgetState);
      await state.storage.put('s:live:ts', now);
      const expiredReservationAt = now - RESERVATION_TTL_MS - 60_000;
      await state.storage.put('r:expired-session', { amount: 20, sessionId: 'expired', createdAt: expiredReservationAt });
      await state.storage.put('r:expired-live', { amount: 10, sessionId: 'live', createdAt: expiredReservationAt });
      await state.storage.put('r:expired-dispatched', {
        amount: 10,
        sessionId: 'live',
        createdAt: expiredReservationAt,
        dispatchedAt: expiredReservationAt + 10_000,
      });
      await state.storage.put('r:live', { amount: 20, sessionId: 'live', createdAt: now });
      await state.storage.put('t:expired', { costCents: 10, createdAt: now - (2 * DAY_MS) });
      await state.storage.put('t:live', { costCents: 10, createdAt: now });

      await instance.alarm();
      return {
        root: await state.storage.get<BudgetState>('root'),
        expiredSession: await state.storage.get('s:expired'),
        liveSession: await state.storage.get<BudgetState>('s:live'),
        expiredReservation: await state.storage.get('r:expired-live'),
        dispatchedTombstone: await state.storage.get('t:expired-dispatched'),
        liveReservation: await state.storage.get('r:live'),
        expiredTombstone: await state.storage.get('t:expired'),
        liveTombstone: await state.storage.get('t:live'),
        alarm: await state.storage.getAlarm(),
      };
    });

    expect(result.root).toMatchObject({ usedCents: 10, reservedCents: 20 });
    expect(result.expiredSession).toBeUndefined();
    expect(result.liveSession).toMatchObject({ usedCents: 10, reservedCents: 20 });
    expect(result.expiredReservation).toBeUndefined();
    expect(result.dispatchedTombstone).toBeDefined();
    expect(result.liveReservation).toBeDefined();
    expect(result.expiredTombstone).toBeUndefined();
    expect(result.liveTombstone).toBeDefined();
    expect(result.alarm).toBeTypeOf('number');
  });

});
