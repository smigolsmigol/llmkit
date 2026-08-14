import { DurableObject } from 'cloudflare:workers';
import { MAX_COORDINATED_REQUEST_LIFETIME_MS } from '../providers/request';
import { MAX_BUFFERED_PROVIDER_RESPONSE_BYTES } from '../response-body';

export const IDEMPOTENCY_PENDING_LEASE_MS = MAX_COORDINATED_REQUEST_LIFETIME_MS;
export const IDEMPOTENCY_RESULT_TTL_MS = 24 * 60 * 60_000;
export const IDEMPOTENCY_MAX_RESPONSE_BYTES = MAX_BUFFERED_PROVIDER_RESPONSE_BYTES;

const RESPONSE_CHUNK_BYTES = 1_000_000;
const STATE_KEY = 'state';

export interface IdempotencyResponse {
  status: number;
  headers: Array<[string, string]>;
  body: ArrayBuffer;
}

interface StoredResponse {
  status: number;
  headers: Array<[string, string]>;
  bodyBytes: number;
  bodyChunks: number;
}

interface IdempotencyState {
  fingerprint: string;
  status: 'pending' | 'completed' | 'indeterminate';
  ownerToken: string;
  createdAt: number;
  updatedAt: number;
  leaseExpiresAt: number;
  expiresAt?: number;
  reason?: string;
  response?: StoredResponse;
}

export type IdempotencyClaimResult =
  | { kind: 'started'; ownerToken: string; leaseExpiresAt: number }
  | { kind: 'in_progress'; retryAfterMs: number }
  | { kind: 'replay'; response: IdempotencyResponse }
  | { kind: 'conflict' }
  | { kind: 'indeterminate'; reason: string };

export type IdempotencyCompleteResult = 'completed' | 'owner_lost' | 'response_too_large';
export type IdempotencyReleaseResult = 'released' | 'owner_lost';

export class IdempotencyDO extends DurableObject {
  async claim(input: { fingerprint: string }): Promise<IdempotencyClaimResult> {
    if (!/^[a-f0-9]{64}$/.test(input.fingerprint)) throw new TypeError('invalid idempotency fingerprint');

    return this.ctx.storage.transaction(async (storage) => {
      const now = Date.now();
      let state = await storage.get<IdempotencyState>(STATE_KEY);

      if (state?.status !== 'pending' && state?.expiresAt !== undefined && state.expiresAt <= now) {
        await this.deleteStoredState(storage, state);
        state = undefined;
      }

      if (!state) {
        const ownerToken = crypto.randomUUID();
        const leaseExpiresAt = now + IDEMPOTENCY_PENDING_LEASE_MS;
        await storage.put(STATE_KEY, {
          fingerprint: input.fingerprint,
          status: 'pending',
          ownerToken,
          createdAt: now,
          updatedAt: now,
          leaseExpiresAt,
        } satisfies IdempotencyState);
        await storage.setAlarm(leaseExpiresAt);
        return { kind: 'started', ownerToken, leaseExpiresAt };
      }

      if (state.fingerprint !== input.fingerprint) return { kind: 'conflict' };

      if (state.status === 'pending') {
        if (state.leaseExpiresAt <= now) {
          state.status = 'indeterminate';
          state.reason = 'the original execution did not publish a terminal result before its crash lease expired';
          state.updatedAt = now;
          state.expiresAt = now + IDEMPOTENCY_RESULT_TTL_MS;
          await storage.put(STATE_KEY, state);
          await storage.setAlarm(state.expiresAt);
          return { kind: 'indeterminate', reason: state.reason };
        }
        return { kind: 'in_progress', retryAfterMs: state.leaseExpiresAt - now };
      }

      if (state.status === 'indeterminate') {
        return { kind: 'indeterminate', reason: state.reason || 'the original execution outcome is unknown' };
      }

      if (!state.response) throw new Error('completed idempotency state is missing its response metadata');
      return { kind: 'replay', response: await this.loadResponse(storage, state.response) };
    });
  }

  async complete(input: { ownerToken: string; response: IdempotencyResponse }): Promise<IdempotencyCompleteResult> {
    if (input.response.body.byteLength > IDEMPOTENCY_MAX_RESPONSE_BYTES) {
      return 'response_too_large';
    }

    return this.ctx.storage.transaction(async (storage) => {
      const state = await storage.get<IdempotencyState>(STATE_KEY);
      if (state?.status !== 'pending' || state.ownerToken !== input.ownerToken) return 'owner_lost';

      const bodyChunks = Math.ceil(input.response.body.byteLength / RESPONSE_CHUNK_BYTES);
      for (let index = 0; index < bodyChunks; index += 1) {
        const start = index * RESPONSE_CHUNK_BYTES;
        const end = Math.min(start + RESPONSE_CHUNK_BYTES, input.response.body.byteLength);
        await storage.put(`body:${index}`, input.response.body.slice(start, end));
      }

      const now = Date.now();
      const expiresAt = now + IDEMPOTENCY_RESULT_TTL_MS;
      await storage.put(STATE_KEY, {
        ...state,
        status: 'completed',
        updatedAt: now,
        expiresAt,
        response: {
          status: input.response.status,
          headers: input.response.headers,
          bodyBytes: input.response.body.byteLength,
          bodyChunks,
        },
      } satisfies IdempotencyState);
      await storage.setAlarm(expiresAt);
      return 'completed';
    });
  }

  async release(input: { ownerToken: string }): Promise<IdempotencyReleaseResult> {
    return this.ctx.storage.transaction(async (storage) => {
      const state = await storage.get<IdempotencyState>(STATE_KEY);
      if (state?.status !== 'pending' || state.ownerToken !== input.ownerToken) return 'owner_lost';
      await storage.delete(STATE_KEY);
      await storage.deleteAlarm();
      return 'released';
    });
  }

  async markIndeterminate(input: { ownerToken: string; reason: string }): Promise<boolean> {
    return this.ctx.storage.transaction(async (storage) => {
      const state = await storage.get<IdempotencyState>(STATE_KEY);
      if (state?.status !== 'pending' || state.ownerToken !== input.ownerToken) return false;

      const now = Date.now();
      state.status = 'indeterminate';
      state.reason = input.reason;
      state.updatedAt = now;
      state.expiresAt = now + IDEMPOTENCY_RESULT_TTL_MS;
      await storage.put(STATE_KEY, state);
      await storage.setAlarm(state.expiresAt);
      return true;
    });
  }

  async stagingProofSnapshot(): Promise<{ entries: number; alarmScheduled: boolean }> {
    return {
      entries: (await this.ctx.storage.list()).size,
      alarmScheduled: (await this.ctx.storage.getAlarm()) !== null,
    };
  }

  async stagingProofPurge(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  async alarm(): Promise<void> {
    const deleteAll = await this.ctx.storage.transaction(async (storage) => {
      const state = await storage.get<IdempotencyState>(STATE_KEY);
      if (!state) return true;

      const now = Date.now();
      if (state.status === 'pending') {
        if (state.leaseExpiresAt > now) {
          await storage.setAlarm(state.leaseExpiresAt);
          return false;
        }
        state.status = 'indeterminate';
        state.reason = 'the original execution did not publish a terminal result before its crash lease expired';
        state.updatedAt = now;
        state.expiresAt = now + IDEMPOTENCY_RESULT_TTL_MS;
        await storage.put(STATE_KEY, state);
        await storage.setAlarm(state.expiresAt);
        return false;
      }

      if ((state.expiresAt ?? 0) > now) {
        await storage.setAlarm(state.expiresAt as number);
        return false;
      }
      return true;
    });

    if (deleteAll) {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
    }
  }

  private async loadResponse(
    storage: DurableObjectTransaction,
    response: StoredResponse,
  ): Promise<IdempotencyResponse> {
    const keys = Array.from({ length: response.bodyChunks }, (_, index) => `body:${index}`);
    const chunks = keys.length > 0
      ? await storage.get<ArrayBuffer>(keys)
      : new Map<string, ArrayBuffer>();
    const body = new Uint8Array(response.bodyBytes);
    let offset = 0;
    for (const key of keys) {
      const chunk = chunks.get(key);
      if (!chunk) throw new Error(`idempotency response chunk is missing: ${key}`);
      body.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }
    if (offset !== response.bodyBytes) throw new Error('idempotency response length does not match stored metadata');
    return { status: response.status, headers: response.headers, body: body.buffer };
  }

  private async deleteStoredState(
    storage: DurableObjectTransaction,
    state: IdempotencyState,
  ): Promise<void> {
    const keys = [STATE_KEY];
    for (let index = 0; index < (state.response?.bodyChunks ?? 0); index += 1) keys.push(`body:${index}`);
    await storage.delete(keys);
  }
}
