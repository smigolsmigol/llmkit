import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  IDEMPOTENCY_MAX_RESPONSE_BYTES,
  IDEMPOTENCY_PENDING_LEASE_MS,
  type IdempotencyDO,
} from '../../src/do/idempotency-do';
import { MAX_PROVIDER_EXECUTION_MS } from '../../src/providers/request';

const FINGERPRINT = 'a'.repeat(64);

function idempotencyStub(name: string): DurableObjectStub<IdempotencyDO> {
  return env.IDEMPOTENCY_DO.get(env.IDEMPOTENCY_DO.idFromName(name));
}

describe('IdempotencyDO production retry behavior', () => {
  it('keeps a live owner valid for the full maximum fallback execution window', async () => {
    expect(IDEMPOTENCY_PENDING_LEASE_MS).toBeGreaterThan(MAX_PROVIDER_EXECUTION_MS);
    const stub = idempotencyStub(`aggregate-timeout-${crypto.randomUUID()}`);
    const claim = await stub.claim({ fingerprint: FINGERPRINT });
    expect(claim.kind).toBe('started');
    if (claim.kind !== 'started') throw new Error('idempotency owner was not granted');

    await runInDurableObject(stub, async (instance, state) => {
      const stored = await state.storage.get<Record<string, unknown>>('state');
      await state.storage.put('state', {
        ...stored,
        createdAt: Date.now() - MAX_PROVIDER_EXECUTION_MS,
        updatedAt: Date.now() - MAX_PROVIDER_EXECUTION_MS,
      });
      await instance.alarm();
      await expect(state.storage.get<Record<string, unknown>>('state')).resolves.toMatchObject({ status: 'pending' });
    });

    await expect(stub.complete({
      ownerToken: claim.ownerToken,
      response: { status: 200, headers: [], body: new ArrayBuffer(0) },
    })).resolves.toBe('completed');
  });

  it('rejects malformed request fingerprints before creating durable state', async () => {
    const stub = idempotencyStub(`invalid-${crypto.randomUUID()}`);
    const message = await runInDurableObject(stub, async (instance) => {
      try {
        await instance.claim({ fingerprint: 'not-a-sha256' });
        return null;
      } catch (error) {
        return (error as Error).message;
      }
    });
    expect(message).toBe('invalid idempotency fingerprint');
    await runInDurableObject(stub, async (_instance, state) => {
      await expect(state.storage.get('state')).resolves.toBeUndefined();
    });
  });

  it('grants one owner and distinguishes in-progress retries from payload conflicts', async () => {
    const stub = idempotencyStub(`claim-${crypto.randomUUID()}`);
    const first = await stub.claim({ fingerprint: FINGERPRINT });
    const duplicate = await stub.claim({ fingerprint: FINGERPRINT });
    const conflict = await stub.claim({ fingerprint: 'b'.repeat(64) });

    expect(first.kind).toBe('started');
    expect(duplicate).toMatchObject({ kind: 'in_progress' });
    expect(conflict).toEqual({ kind: 'conflict' });
  });

  it('stores chunked response bytes and replays them only after the owning execution completes', async () => {
    const stub = idempotencyStub(`replay-${crypto.randomUUID()}`);
    const claim = await stub.claim({ fingerprint: FINGERPRINT });
    expect(claim.kind).toBe('started');
    if (claim.kind !== 'started') throw new Error('idempotency owner was not granted');

    const body = new Uint8Array(1_500_123);
    for (let index = 0; index < body.length; index += 1) body[index] = index % 251;
    const wrongOwner = await stub.complete({
      ownerToken: 'wrong-owner',
      response: { status: 200, headers: [['content-type', 'application/octet-stream']], body: body.buffer },
    });
    const completed = await stub.complete({
      ownerToken: claim.ownerToken,
      response: { status: 200, headers: [['content-type', 'application/octet-stream']], body: body.buffer },
    });
    const replay = await stub.claim({ fingerprint: FINGERPRINT });

    expect(wrongOwner).toBe('owner_lost');
    expect(completed).toBe('completed');
    expect(replay.kind).toBe('replay');
    if (replay.kind !== 'replay') throw new Error('completed response was not replayed');
    expect(replay.response.status).toBe(200);
    expect(replay.response.headers).toEqual([['content-type', 'application/octet-stream']]);
    expect(new Uint8Array(replay.response.body)).toEqual(body);
  });

  it('round-trips an empty response without inventing a storage chunk', async () => {
    const stub = idempotencyStub(`empty-${crypto.randomUUID()}`);
    const claim = await stub.claim({ fingerprint: FINGERPRINT });
    expect(claim.kind).toBe('started');
    if (claim.kind !== 'started') throw new Error('idempotency owner was not granted');
    await expect(stub.complete({
      ownerToken: claim.ownerToken,
      response: { status: 204, headers: [], body: new ArrayBuffer(0) },
    })).resolves.toBe('completed');
    const replay = await stub.claim({ fingerprint: FINGERPRINT });
    expect(replay.kind).toBe('replay');
    if (replay.kind !== 'replay') throw new Error('empty response was not replayed');
    expect(replay.response.body.byteLength).toBe(0);
    await runInDurableObject(stub, async (_instance, state) => {
      await expect(state.storage.get('body:0')).resolves.toBeUndefined();
    });
  });

  it('retains an unknown outcome as terminal instead of dispatching the retry again', async () => {
    const stub = idempotencyStub(`indeterminate-${crypto.randomUUID()}`);
    const claim = await stub.claim({ fingerprint: FINGERPRINT });
    expect(claim.kind).toBe('started');
    if (claim.kind !== 'started') throw new Error('idempotency owner was not granted');

    await expect(stub.markIndeterminate({ ownerToken: 'wrong-owner', reason: 'wrong' })).resolves.toBe(false);
    await expect(stub.markIndeterminate({ ownerToken: claim.ownerToken, reason: 'provider outcome unknown' })).resolves.toBe(true);
    await expect(stub.claim({ fingerprint: FINGERPRINT })).resolves.toEqual({
      kind: 'indeterminate',
      reason: 'provider outcome unknown',
    });
  });

  it('uses a safe fallback reason and expires an indeterminate record before granting new ownership', async () => {
    const stub = idempotencyStub(`indeterminate-expiry-${crypto.randomUUID()}`);
    const claim = await stub.claim({ fingerprint: FINGERPRINT });
    expect(claim.kind).toBe('started');
    if (claim.kind !== 'started') throw new Error('idempotency owner was not granted');
    await stub.markIndeterminate({ ownerToken: claim.ownerToken, reason: 'temporary reason' });
    await runInDurableObject(stub, async (_instance, state) => {
      const stored = await state.storage.get<Record<string, unknown>>('state');
      expect(stored).toBeDefined();
      const { reason: _reason, ...withoutReason } = stored ?? {};
      await state.storage.put('state', withoutReason);
    });
    await expect(stub.claim({ fingerprint: FINGERPRINT })).resolves.toEqual({
      kind: 'indeterminate',
      reason: 'the original execution outcome is unknown',
    });
    await runInDurableObject(stub, async (_instance, state) => {
      const stored = await state.storage.get<Record<string, unknown>>('state');
      await state.storage.put('state', { ...stored, expiresAt: Date.now() - 1 });
    });
    await expect(stub.claim({ fingerprint: FINGERPRINT })).resolves.toMatchObject({ kind: 'started' });
  });

  it('turns an expired pending lease into an indeterminate outcome', async () => {
    const stub = idempotencyStub(`expired-pending-${crypto.randomUUID()}`);
    await stub.claim({ fingerprint: FINGERPRINT });
    await runInDurableObject(stub, async (_instance, state) => {
      const stored = await state.storage.get<Record<string, unknown>>('state');
      expect(stored).toBeDefined();
      await state.storage.put('state', { ...stored, leaseExpiresAt: Date.now() - 1 });
    });

    const retry = await stub.claim({ fingerprint: FINGERPRINT });
    expect(retry).toMatchObject({ kind: 'indeterminate' });
  });

  it('uses its alarm to close crashed ownership and then delete expired replay state', async () => {
    const stub = idempotencyStub(`alarm-${crypto.randomUUID()}`);
    await stub.claim({ fingerprint: FINGERPRINT });
    await runInDurableObject(stub, async (_instance, state) => {
      const stored = await state.storage.get<Record<string, unknown>>('state');
      await state.storage.put('state', { ...stored, leaseExpiresAt: Date.now() - 1 });
      await state.storage.setAlarm(Date.now() + 60_000);
    });

    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);
    await runInDurableObject(stub, async (_instance, state) => {
      const stored = await state.storage.get<Record<string, unknown>>('state');
      expect(stored?.status).toBe('indeterminate');
      await state.storage.put('state', { ...stored, expiresAt: Date.now() - 1 });
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);
    await runInDurableObject(stub, async (_instance, state) => {
      await expect(state.storage.get('state')).resolves.toBeUndefined();
      await expect(state.storage.getAlarm()).resolves.toBeNull();
    });
  });

  it('makes empty and early alarms harmless while preserving the next deadline', async () => {
    const emptyStub = idempotencyStub(`empty-alarm-${crypto.randomUUID()}`);
    await runInDurableObject(emptyStub, async (instance, state) => {
      await instance.alarm();
      await expect(state.storage.get('state')).resolves.toBeUndefined();
      await expect(state.storage.getAlarm()).resolves.toBeNull();
    });

    const pendingStub = idempotencyStub(`early-pending-alarm-${crypto.randomUUID()}`);
    const pending = await pendingStub.claim({ fingerprint: FINGERPRINT });
    expect(pending.kind).toBe('started');
    if (pending.kind !== 'started') throw new Error('idempotency owner was not granted');
    await runInDurableObject(pendingStub, async (instance, state) => {
      await instance.alarm();
      const stored = await state.storage.get<Record<string, unknown>>('state');
      expect(stored?.status).toBe('pending');
      await expect(state.storage.getAlarm()).resolves.toBe(pending.leaseExpiresAt);
    });

    await pendingStub.markIndeterminate({ ownerToken: pending.ownerToken, reason: 'unknown' });
    await runInDurableObject(pendingStub, async (instance, state) => {
      const before = await state.storage.get<Record<string, unknown>>('state');
      await instance.alarm();
      const after = await state.storage.get<Record<string, unknown>>('state');
      expect(after?.status).toBe('indeterminate');
      await expect(state.storage.getAlarm()).resolves.toBe(before?.expiresAt);
    });
  });

  it('fails closed on corrupt completed metadata and replay chunks', async () => {
    const stub = idempotencyStub(`corrupt-${crypto.randomUUID()}`);
    const claim = await stub.claim({ fingerprint: FINGERPRINT });
    expect(claim.kind).toBe('started');
    if (claim.kind !== 'started') throw new Error('idempotency owner was not granted');
    await stub.complete({
      ownerToken: claim.ownerToken,
      response: { status: 200, headers: [], body: await new Blob(['x']).arrayBuffer() },
    });

    await runInDurableObject(stub, async (instance, state) => {
      const stored = await state.storage.get<Record<string, unknown>>('state');
      const { response: _response, ...withoutResponse } = stored ?? {};
      await state.storage.put('state', withoutResponse);
      await expect(instance.claim({ fingerprint: FINGERPRINT })).rejects.toThrow('missing its response metadata');

      await state.storage.put('state', {
        ...stored,
        response: { status: 200, headers: [], bodyBytes: 1, bodyChunks: 1 },
      });
      await state.storage.delete('body:0');
      await expect(instance.claim({ fingerprint: FINGERPRINT })).rejects.toThrow('response chunk is missing');

      await state.storage.put('state', {
        ...stored,
        response: { status: 200, headers: [], bodyBytes: 2, bodyChunks: 1 },
      });
      await state.storage.put('body:0', new ArrayBuffer(1));
      await expect(instance.claim({ fingerprint: FINGERPRINT })).rejects.toThrow('length does not match');
    });
  });

  it('rejects an oversized replay body without publishing a partial completion', async () => {
    const stub = idempotencyStub(`oversized-${crypto.randomUUID()}`);
    const claim = await stub.claim({ fingerprint: FINGERPRINT });
    expect(claim.kind).toBe('started');
    if (claim.kind !== 'started') throw new Error('idempotency owner was not granted');

    await expect(stub.complete({
      ownerToken: claim.ownerToken,
      response: {
        status: 200,
        headers: [],
        body: new ArrayBuffer(IDEMPOTENCY_MAX_RESPONSE_BYTES + 1),
      },
    })).resolves.toBe('response_too_large');
    await expect(stub.claim({ fingerprint: FINGERPRINT })).resolves.toMatchObject({ kind: 'in_progress' });
  });

  it('releases only the current pending owner and clears its alarm', async () => {
    const stub = idempotencyStub(`release-${crypto.randomUUID()}`);
    const first = await stub.claim({ fingerprint: FINGERPRINT });
    expect(first.kind).toBe('started');
    if (first.kind !== 'started') throw new Error('idempotency owner was not granted');

    await expect(stub.release({ ownerToken: 'not-the-owner' })).resolves.toBe('owner_lost');
    await expect(stub.claim({ fingerprint: FINGERPRINT })).resolves.toMatchObject({ kind: 'in_progress' });
    await expect(stub.release({ ownerToken: first.ownerToken })).resolves.toBe('released');
    await runInDurableObject(stub, async (_instance, state) => {
      await expect(state.storage.get('state')).resolves.toBeUndefined();
      await expect(state.storage.getAlarm()).resolves.toBeNull();
    });

    const second = await stub.claim({ fingerprint: FINGERPRINT });
    expect(second.kind).toBe('started');
    if (second.kind !== 'started') throw new Error('released state did not admit a fresh owner');
    expect(second.ownerToken).not.toBe(first.ownerToken);
  });

  it('allows a fresh owner only after a completed replay record expires', async () => {
    const stub = idempotencyStub(`expired-result-${crypto.randomUUID()}`);
    const first = await stub.claim({ fingerprint: FINGERPRINT });
    expect(first.kind).toBe('started');
    if (first.kind !== 'started') throw new Error('idempotency owner was not granted');
    await stub.complete({
      ownerToken: first.ownerToken,
      response: { status: 200, headers: [], body: await new Blob(['old']).arrayBuffer() },
    });
    await runInDurableObject(stub, async (_instance, state) => {
      const stored = await state.storage.get<Record<string, unknown>>('state');
      await state.storage.put('state', { ...stored, expiresAt: Date.now() - 1 });
    });

    const fresh = await stub.claim({ fingerprint: FINGERPRINT });
    expect(fresh.kind).toBe('started');
    if (fresh.kind !== 'started') throw new Error('expired result did not admit a fresh owner');
    expect(fresh.ownerToken).not.toBe(first.ownerToken);
    await runInDurableObject(stub, async (_instance, state) => {
      await expect(state.storage.get('body:0')).resolves.toBeUndefined();
    });
  });
});
