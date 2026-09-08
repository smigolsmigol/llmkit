import { DurableObject } from 'cloudflare:workers';
import type { RequestInsert } from '../db';
import { upsertRequestReceipt } from '../db';
import { MAX_COORDINATED_REQUEST_LIFETIME_MS } from '../providers/request';

export interface BudgetDOEnv extends Cloudflare.Env {
  SUPABASE_URL?: string;
  SUPABASE_KEY?: string;
}

export interface BudgetState {
  limitCents: number;
  usedCents: number;
  reservedCents: number;
  period: 'daily' | 'weekly' | 'monthly' | 'total';
  resetAt: number;
  scope?: 'key' | 'session';
  alertThreshold?: number;
  alertWebhookUrl?: string;
  lastAlertAt?: number;
}

export interface CheckInput {
  sessionId?: string;
  estimatedCents: number;
  budgetConfig?: { limitCents: number; period: string };
  dispatching?: boolean;
  receipt?: RequestInsert;
}

export interface CheckResult {
  allowed: boolean;
  remaining: number;
  reservationId: string;
  scope: 'key' | 'session';
  limitCents: number;
  usedCents: number;
}

export interface RecordInput {
  reservationId: string;
  sessionId?: string;
  costCents: number;
  receipt?: RequestInsert;
}

export interface RecordResult {
  usedCents: number;
  limitCents: number;
  settlementAccepted?: boolean;
  alert?: {
    webhookUrl: string;
    budgetId: string;
    usedCents: number;
    limitCents: number;
    percentage: number;
    period: string;
    anomaly?: { costCents: number; medianCents: number; multiplier: number };
  };
}

export interface FailureFinalizationResult {
  disposition: 'committed' | 'released' | 'missing';
  committedCents: number;
  usedCents: number;
  limitCents: number;
}

export interface StagingBudgetProofSnapshot {
  root?: BudgetState;
  reservations: number;
  settlements: number;
  evidence: number;
  outbox: number;
}

interface ReservationState {
  amount: number;
  sessionId?: string;
  createdAt: number;
  dispatchedAt?: number;
  requestId?: string;
}

interface SettlementTombstone {
  costCents: number;
  createdAt: number;
  sessionId?: string;
  reservationFound: boolean;
  settlementStatus?: 'settled_actual' | 'committed_ceiling' | 'released';
}

interface EvidenceEnvelope {
  row: RequestInsert;
  revision: number;
  updatedAt: number;
  persistedAt?: number;
}

interface EvidenceOutboxJob {
  revision: number;
  attempts: number;
  nextAttemptAt: number;
}

const DAY_MS = 86_400_000;
const SESSION_TTL = 7 * DAY_MS;
export const RESERVATION_TTL_MS = MAX_COORDINATED_REQUEST_LIFETIME_MS;
const SETTLEMENT_DEDUP_TTL = DAY_MS;
const ANOMALY_MULTIPLIER = 3;
const ANOMALY_HISTORY_SIZE = 20;
const ANOMALY_MIN_SAMPLES = 5;
const ANOMALY_COOLDOWN_MS = 3_600_000;
const DEFAULT_ALERT_THRESHOLD = 0.8;
const MIN_ALARM_DELAY = 1_000;
const EVIDENCE_RETENTION_MS = 7 * DAY_MS;
const OUTBOX_BATCH_SIZE = 25;
const OUTBOX_MAX_BACKOFF_MS = 60_000;

export class BudgetDO extends DurableObject<BudgetDOEnv> {
  private flushPromise?: Promise<void>;

  // --- check: can this request proceed? ---

  async check(input: CheckInput): Promise<CheckResult> {
    const result: CheckResult = await this.ctx.storage.transaction(async (storage) => {
      const root = await this.initOrSyncRoot(storage, input.budgetConfig);
      if (!root) return { allowed: true, remaining: Infinity, reservationId: '', scope: 'key', limitCents: 0, usedCents: 0 };

      await this.resetPeriodIfDue(storage, root);

      const active = await this.resolveTarget(storage, root, input.sessionId);
      const remaining = this.computeRemaining(active, root);

      if (remaining <= 0 || (input.estimatedCents > 0 && remaining < input.estimatedCents)) {
        return { allowed: false, remaining: Math.max(0, remaining), reservationId: '', scope: root.scope || 'key', limitCents: active.limitCents, usedCents: active.usedCents };
      }

      const reservationId = await this.createReservation(storage, root, active, input);
      if (input.receipt) {
        await this.queueEvidence(storage, {
          ...input.receipt,
          budget_reservation_id: reservationId,
          reserved_cost_cents: Math.max(input.estimatedCents, 1),
          settlement_status: 'pending',
          cost_cents: null,
          status: 'pending',
        });
      }
      return { allowed: true, remaining: remaining - Math.max(input.estimatedCents, 1), reservationId, scope: root.scope || 'key', limitCents: active.limitCents, usedCents: active.usedCents };
    });
    if (result.allowed && input.receipt) this.kickOutbox();
    return result;
  }

  // --- record: settle actual cost after response ---

  async record(input: RecordInput): Promise<RecordResult> {
    const result: RecordResult = await this.ctx.storage.transaction(async (storage) => {
      const root = await storage.get<BudgetState>('root');
      if (!root) {
        if (input.receipt) await this.queueEvidence(storage, {
          ...input.receipt,
          cost_cents: null,
          settlement_status: 'unknown',
        });
        return { usedCents: 0, limitCents: 0, settlementAccepted: true };
      }

      await this.resetPeriodIfDue(storage, root);

      const settlement = await this.settleReservation(storage, input.reservationId, input.costCents, input.sessionId);
      const targetSessionId = settlement.reservationFound ? settlement.sessionId : input.sessionId;
      const { key, target } = await this.resolveRecordTarget(storage, root, targetSessionId);
      if (settlement.duplicate) {
        if (input.receipt) {
          await this.preserveTerminalEvidence(storage, input.receipt, {
            cost_cents: settlement.costCents,
            settlement_status: settlement.settlementStatus,
          });
        }
        return { usedCents: target.usedCents, limitCents: target.limitCents, settlementAccepted: true };
      }

      this.applyCostSettlement(target, settlement.reservedAmount, input.costCents);
      await storage.put(key, target);

      if (key !== 'root') {
        this.applyCostSettlement(root, settlement.reservedAmount, input.costCents);
        await storage.put('root', root);
      }

      if (input.costCents <= 0) {
        if (input.receipt) await this.queueEvidence(storage, input.receipt);
        return { usedCents: target.usedCents, limitCents: target.limitCents, settlementAccepted: true };
      }

      const alert = await this.checkAlerts(storage, target, root, key, input.costCents);
      if (input.receipt) await this.queueEvidence(storage, input.receipt);
      return { usedCents: target.usedCents, limitCents: target.limitCents, settlementAccepted: true, alert };
    });
    if (input.receipt) this.kickOutbox();
    return result;
  }

  // --- release: free reservation without recording cost ---

  async release(reservationId: string): Promise<void> {
    if (!reservationId) return;
    await this.ctx.storage.transaction(async (storage) => {
      const reservation = await storage.get<ReservationState>(`r:${reservationId}`);
      if (!reservation) return;

      await storage.delete(`r:${reservationId}`);
      await storage.put(`t:${reservationId}`, {
        costCents: 0,
        createdAt: Date.now(),
        reservationFound: true,
        sessionId: reservation.sessionId,
        settlementStatus: 'released',
      } satisfies SettlementTombstone);

      const root = await storage.get<BudgetState>('root');
      if (!root) return;

      root.reservedCents = Math.max(0, (root.reservedCents || 0) - reservation.amount);
      await storage.put('root', root);

      if (root.scope === 'session' && reservation.sessionId) {
        const session = await storage.get<BudgetState>(`s:${reservation.sessionId}`);
        if (session) {
          session.reservedCents = Math.max(0, (session.reservedCents || 0) - reservation.amount);
          await storage.put(`s:${reservation.sessionId}`, session);
        }
      }
      if (reservation.requestId) {
        await this.updateEvidence(storage, reservation.requestId, {
          cost_cents: 0,
          settlement_status: 'released',
          status: 'error',
        });
      }
    });
    this.kickOutbox();
  }

  async markDispatched(
    reservationId: string,
    evidence?: { provider: string; model: string },
  ): Promise<boolean> {
    if (!reservationId) return false;
    const marked = await this.ctx.storage.transaction(async (storage) => {
      const reservation = await storage.get<ReservationState>(`r:${reservationId}`);
      if (!reservation) return false;
      if (evidence) {
        if (!reservation.requestId) return false;
        const recorded = await this.updateEvidence(storage, reservation.requestId, {
          last_dispatched_provider: evidence.provider,
          last_dispatched_model: evidence.model,
          dispatch_status: 'dispatched',
        });
        if (!recorded) return false;
      }
      if (reservation.dispatchedAt === undefined) {
        reservation.dispatchedAt = Date.now();
        await storage.put(`r:${reservationId}`, reservation);
      }
      return true;
    });
    if (marked && evidence) this.kickOutbox();
    return marked;
  }

  async finalizeFailure(reservationId: string, receipt?: RequestInsert): Promise<FailureFinalizationResult> {
    if (!reservationId) return { disposition: 'missing', committedCents: 0, usedCents: 0, limitCents: 0 };
    const result: FailureFinalizationResult = await this.ctx.storage.transaction(async (storage) => {
      const root = await storage.get<BudgetState>('root');
      if (!root) {
        await storage.delete(`r:${reservationId}`);
        if (receipt) await this.queueEvidence(storage, {
          ...receipt,
          cost_cents: null,
          settlement_status: 'unknown',
        });
        return { disposition: 'missing', committedCents: 0, usedCents: 0, limitCents: 0 };
      }
      await this.resetPeriodIfDue(storage, root);

      const reservation = await storage.get<ReservationState>(`r:${reservationId}`);
      if (!reservation) {
        const tombstone = await storage.get<SettlementTombstone>(`t:${reservationId}`);
        if (tombstone?.reservationFound) {
          const settlementStatus = tombstone.settlementStatus ?? 'committed_ceiling';
          if (receipt) {
            await this.preserveTerminalEvidence(storage, receipt, {
              cost_cents: tombstone.costCents,
              settlement_status: settlementStatus,
            });
          }
          return {
            disposition: settlementStatus === 'released' ? 'released' : 'committed',
            committedCents: settlementStatus === 'released' ? 0 : tombstone.costCents,
            usedCents: root.usedCents,
            limitCents: root.limitCents,
          };
        }
        if (receipt) await this.queueEvidence(storage, {
          ...receipt,
          cost_cents: null,
          settlement_status: 'unknown',
        });
        return {
          disposition: 'missing',
          committedCents: 0,
          usedCents: root.usedCents,
          limitCents: root.limitCents,
        };
      }

      if (reservation.dispatchedAt === undefined) {
        await storage.delete(`r:${reservationId}`);
        await storage.put(`t:${reservationId}`, {
          costCents: 0,
          createdAt: Date.now(),
          reservationFound: true,
          sessionId: reservation.sessionId,
          settlementStatus: 'released',
        } satisfies SettlementTombstone);
        this.applyCostSettlement(root, reservation.amount, 0);
        await storage.put('root', root);
        if (root.scope === 'session' && reservation.sessionId) {
          const session = await storage.get<BudgetState>(`s:${reservation.sessionId}`);
          if (session) {
            this.applyCostSettlement(session, reservation.amount, 0);
            await storage.put(`s:${reservation.sessionId}`, session);
          }
        }
        if (receipt) {
          await this.queueEvidence(storage, {
            ...receipt,
            cost_cents: 0,
            settlement_status: 'released',
          });
        } else if (reservation.requestId) {
          await this.updateEvidence(storage, reservation.requestId, {
            cost_cents: 0,
            settlement_status: 'released',
            status: 'error',
          });
        }
        return {
          disposition: 'released',
          committedCents: 0,
          usedCents: root.usedCents,
          limitCents: root.limitCents,
        };
      }

      const settlement = await this.settleReservation(
        storage,
        reservationId,
        reservation.amount,
        reservation.sessionId,
        'committed_ceiling',
      );
      const { key, target } = await this.resolveRecordTarget(storage, root, reservation.sessionId);
      this.applyCostSettlement(target, settlement.reservedAmount, reservation.amount);
      await storage.put(key, target);
      if (key !== 'root') {
        this.applyCostSettlement(root, settlement.reservedAmount, reservation.amount);
        await storage.put('root', root);
      }
      if (receipt) {
        await this.queueEvidence(storage, {
          ...receipt,
          cost_cents: reservation.amount,
          settlement_status: 'committed_ceiling',
        });
      } else if (reservation.requestId) {
        await this.updateEvidence(storage, reservation.requestId, {
          cost_cents: reservation.amount,
          settlement_status: 'committed_ceiling',
          status: 'error',
        });
      }
      return {
        disposition: 'committed',
        committedCents: reservation.amount,
        usedCents: target.usedCents,
        limitCents: target.limitCents,
      };
    });
    this.kickOutbox();
    return result;
  }

  async configure(state: Omit<BudgetState, 'reservedCents'> & { reservedCents?: number }): Promise<void> {
    await this.ctx.storage.put('root', { ...state, reservedCents: state.reservedCents ?? 0 });
  }

  async attachResponseHash(requestId: string, responseSha256: string): Promise<boolean> {
    if (!requestId || !/^[a-f0-9]{64}$/.test(responseSha256)) return false;
    const updated = await this.ctx.storage.transaction((storage) => (
      this.updateEvidence(storage, requestId, { response_sha256: responseSha256 })
    ));
    if (updated) this.kickOutbox();
    return updated;
  }

  async stagingProofSnapshot(): Promise<StagingBudgetProofSnapshot> {
    return {
      root: await this.ctx.storage.get<BudgetState>('root'),
      reservations: (await this.ctx.storage.list({ prefix: 'r:' })).size,
      settlements: (await this.ctx.storage.list({ prefix: 't:' })).size,
      evidence: (await this.ctx.storage.list({ prefix: 'e:' })).size,
      outbox: (await this.ctx.storage.list({ prefix: 'o:' })).size,
    };
  }

  async stagingProofPurge(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  async stagingProofExpireDispatchedReservations(): Promise<number> {
    const expiredAt = Date.now() - RESERVATION_TTL_MS - 1;
    const expired = await this.ctx.storage.transaction(async (storage) => {
      const reservations = await storage.list<ReservationState>({ prefix: 'r:' });
      let count = 0;
      for (const [key, reservation] of reservations) {
        if (reservation.dispatchedAt === undefined) continue;
        await storage.put(key, {
          ...reservation,
          createdAt: expiredAt,
          dispatchedAt: expiredAt,
        } satisfies ReservationState);
        count += 1;
      }
      return count;
    });
    if (expired > 0) await this.alarm();
    return expired;
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.transaction(async (storage) => {
      const cutoff = Date.now() - SESSION_TTL;
      const reservationCutoff = Date.now() - RESERVATION_TTL_MS;
      const settlementCutoff = Date.now() - SETTLEMENT_DEDUP_TTL;
      const entries = await storage.list({ prefix: 's:' });
      const reservations = await storage.list<ReservationState>({ prefix: 'r:' });
      const settlements = await storage.list<SettlementTombstone>({ prefix: 't:' });
      const evidence = await storage.list<EvidenceEnvelope>({ prefix: 'e:' });
      const outbox = await storage.list<EvidenceOutboxJob>({ prefix: 'o:' });

      const toDelete: string[] = [];
      let nextAlarmAt = Infinity;

      for (const [key, val] of entries) {
        if (!key.endsWith(':ts')) continue;
        if (typeof val === 'number' && val < cutoff) {
          toDelete.push(key, key.slice(0, -3));
        } else if (typeof val === 'number') {
          nextAlarmAt = Math.min(nextAlarmAt, val + SESSION_TTL);
        }
      }

      let staleReserved = 0;
      let staleCommitted = 0;
      const staleBySession: Record<string, number> = {};
      const staleCommittedBySession: Record<string, number> = {};
      for (const [key, val] of reservations) {
        if (val && typeof val === 'object' && val.createdAt < reservationCutoff) {
          staleReserved += val.amount;
          toDelete.push(key);
          if (val.sessionId) {
            staleBySession[val.sessionId] = (staleBySession[val.sessionId] || 0) + val.amount;
          }
          if (val.dispatchedAt !== undefined) {
            staleCommitted += val.amount;
            if (val.sessionId) {
              staleCommittedBySession[val.sessionId] = (staleCommittedBySession[val.sessionId] || 0) + val.amount;
            }
            const reservationId = key.slice(2);
            await storage.put(`t:${reservationId}`, {
              costCents: val.amount,
              createdAt: Date.now(),
              reservationFound: true,
              sessionId: val.sessionId,
              settlementStatus: 'committed_ceiling',
            } satisfies SettlementTombstone);
            if (val.requestId) {
              await this.updateEvidence(storage, val.requestId, {
                cost_cents: val.amount,
                settlement_status: 'committed_ceiling',
                status: 'error',
                error_code: 'RESERVATION_TIMEOUT',
              });
            }
          } else {
            const reservationId = key.slice(2);
            await storage.put(`t:${reservationId}`, {
              costCents: 0,
              createdAt: Date.now(),
              reservationFound: true,
              sessionId: val.sessionId,
              settlementStatus: 'released',
            } satisfies SettlementTombstone);
            if (val.requestId) {
              await this.updateEvidence(storage, val.requestId, {
                cost_cents: 0,
                settlement_status: 'released',
                status: 'error',
                error_code: 'RESERVATION_TIMEOUT',
              });
            }
          }
        } else if (val && typeof val === 'object') {
          nextAlarmAt = Math.min(nextAlarmAt, val.createdAt + RESERVATION_TTL_MS);
        }
      }

      for (const [key, val] of settlements) {
        if (val && typeof val === 'object' && val.createdAt < settlementCutoff) {
          toDelete.push(key);
        } else if (val && typeof val === 'object') {
          nextAlarmAt = Math.min(nextAlarmAt, val.createdAt + SETTLEMENT_DEDUP_TTL);
        }
      }

      for (const [key, val] of evidence) {
        const requestId = key.slice(2);
        if (
          val?.persistedAt
          && val.persistedAt < Date.now() - EVIDENCE_RETENTION_MS
          && !outbox.has(`o:${requestId}`)
        ) {
          toDelete.push(key);
        } else if (val?.persistedAt) {
          nextAlarmAt = Math.min(nextAlarmAt, val.persistedAt + EVIDENCE_RETENTION_MS);
        }
      }

      for (const job of outbox.values()) {
        nextAlarmAt = Math.min(nextAlarmAt, job.nextAttemptAt);
      }

      if (toDelete.length > 0) await storage.delete(toDelete);

      if (staleReserved > 0) {
        const root = await storage.get<BudgetState>('root');
        if (root) {
          root.reservedCents = Math.max(0, (root.reservedCents || 0) - staleReserved);
          root.usedCents += staleCommitted;
          await storage.put('root', root);
        }

        for (const [sessionId, amount] of Object.entries(staleBySession)) {
          const session = await storage.get<BudgetState>(`s:${sessionId}`);
          if (session) {
            session.reservedCents = Math.max(0, (session.reservedCents || 0) - amount);
            session.usedCents += staleCommittedBySession[sessionId] || 0;
            await storage.put(`s:${sessionId}`, session);
          }
        }
      }

      if (Number.isFinite(nextAlarmAt)) {
        await storage.setAlarm(Math.max(Date.now() + MIN_ALARM_DELAY, nextAlarmAt));
      }
    });
    await this.flushEvidenceOutbox();
  }

  // --- private: check sub-methods ---

  private async initOrSyncRoot(storage: DurableObjectTransaction, budgetConfig?: { limitCents: number; period: string }): Promise<BudgetState | null> {
    let root = await storage.get<BudgetState>('root');

    if (!root && budgetConfig) {
      const period = budgetConfig.period as BudgetState['period'];
      root = { limitCents: budgetConfig.limitCents, usedCents: 0, reservedCents: 0, period, resetAt: period !== 'total' ? nextReset(period) : 0 };
      await storage.put('root', root);
    }

    if (root && budgetConfig && (root.limitCents !== budgetConfig.limitCents || root.period !== budgetConfig.period)) {
      root.limitCents = budgetConfig.limitCents;
      const newPeriod = budgetConfig.period as BudgetState['period'];
      if (root.period !== newPeriod) {
        root.period = newPeriod;
        root.resetAt = newPeriod !== 'total' ? nextReset(newPeriod) : 0;
      }
      await storage.put('root', root);
    }

    return root ?? null;
  }

  private async resetPeriodIfDue(storage: DurableObjectTransaction, root: BudgetState): Promise<void> {
    if (root.period !== 'total' && root.resetAt > 0 && Date.now() >= root.resetAt) {
      root.usedCents = 0;
      root.resetAt = nextReset(root.period);
      root.lastAlertAt = undefined;
      await storage.put('root', root);
      // In-flight reservations cross the clock boundary conservatively. They
      // remain reserved and must still reach a terminal receipt state.
      await this.clearSessions(storage);
    }
  }

  private async resolveTarget(storage: DurableObjectTransaction, root: BudgetState, sessionId?: string): Promise<BudgetState> {
    if (root.scope !== 'session' || !sessionId) return root;

    const sKey = `s:${sessionId}`;
    let session = await storage.get<BudgetState>(sKey);

    if (!session) {
      session = { limitCents: root.limitCents, usedCents: 0, reservedCents: 0, period: root.period, resetAt: root.resetAt, alertThreshold: root.alertThreshold, alertWebhookUrl: root.alertWebhookUrl };
    }

    await storage.put(sKey, session);
    await storage.put(`${sKey}:ts`, Date.now());

    await this.scheduleAlarmNoLaterThan(storage, Date.now() + SESSION_TTL);

    return session;
  }

  private computeRemaining(active: BudgetState, root: BudgetState): number {
    const sessionRemaining = active.limitCents - active.usedCents - (active.reservedCents || 0);
    const rootRemaining = root.limitCents - root.usedCents - (root.reservedCents || 0);
    return Math.min(sessionRemaining, rootRemaining);
  }

  private async createReservation(storage: DurableObjectTransaction, root: BudgetState, active: BudgetState, input: CheckInput): Promise<string> {
    const reservationId = crypto.randomUUID();
    const amount = Math.max(input.estimatedCents, 1);
    const createdAt = Date.now();

    root.reservedCents = (root.reservedCents || 0) + amount;
    await storage.put('root', root);

    if (active !== root && input.sessionId) {
      active.reservedCents = (active.reservedCents || 0) + amount;
      await storage.put(`s:${input.sessionId}`, active);
    }

    await storage.put(`r:${reservationId}`, {
      amount,
      sessionId: input.sessionId,
      createdAt,
      ...(input.dispatching ? { dispatchedAt: createdAt } : {}),
      requestId: input.receipt?.id,
    } satisfies ReservationState);

    // arm alarm for stale reservation cleanup (covers key-scoped budgets too, not just sessions)
    await this.scheduleAlarmNoLaterThan(storage, Date.now() + RESERVATION_TTL_MS);

    return reservationId;
  }

  private async scheduleAlarmNoLaterThan(
    storage: { getAlarm(): Promise<number | null>; setAlarm(scheduledTime: number | Date): Promise<void> },
    deadline: number,
  ): Promise<void> {
    const current = await storage.getAlarm();
    if (current === null || current > deadline) await storage.setAlarm(deadline);
  }

  private async queueEvidence(storage: DurableObjectTransaction, incoming: RequestInsert): Promise<void> {
    const key = `e:${incoming.id}`;
    const current = await storage.get<EvidenceEnvelope>(key);
    const revision = (current?.revision ?? 0) + 1;
    const row: RequestInsert = {
      ...(current?.row ?? incoming),
      ...incoming,
      budget_reservation_id: incoming.budget_reservation_id ?? current?.row.budget_reservation_id ?? null,
      reserved_cost_cents: incoming.reserved_cost_cents ?? current?.row.reserved_cost_cents ?? null,
      idempotency_key_hash: incoming.idempotency_key_hash ?? current?.row.idempotency_key_hash ?? null,
      response_sha256: incoming.response_sha256 ?? current?.row.response_sha256 ?? null,
      requested_provider: incoming.requested_provider ?? current?.row.requested_provider ?? null,
      requested_model: incoming.requested_model ?? current?.row.requested_model ?? null,
      last_dispatched_provider: incoming.last_dispatched_provider ?? current?.row.last_dispatched_provider ?? null,
      last_dispatched_model: incoming.last_dispatched_model ?? current?.row.last_dispatched_model ?? null,
      provider_response_id: incoming.provider_response_id ?? current?.row.provider_response_id ?? null,
      dispatch_status: incoming.dispatch_status ?? current?.row.dispatch_status ?? null,
    };
    await storage.put(key, {
      row,
      revision,
      updatedAt: Date.now(),
    } satisfies EvidenceEnvelope);
    await storage.put(`o:${incoming.id}`, {
      revision,
      attempts: 0,
      nextAttemptAt: Date.now(),
    } satisfies EvidenceOutboxJob);
    await this.scheduleAlarmNoLaterThan(storage, Date.now() + MIN_ALARM_DELAY);
  }

  private async updateEvidence(
    storage: DurableObjectTransaction,
    requestId: string,
    patch: Partial<RequestInsert>,
  ): Promise<boolean> {
    const current = await storage.get<EvidenceEnvelope>(`e:${requestId}`);
    if (!current) return false;
    await this.queueEvidence(storage, { ...current.row, ...patch, id: requestId });
    return true;
  }

  private async preserveTerminalEvidence(
    storage: DurableObjectTransaction,
    receipt: RequestInsert,
    terminal: Pick<RequestInsert, 'cost_cents' | 'settlement_status'>,
  ): Promise<void> {
    const updated = await this.updateEvidence(storage, receipt.id, terminal);
    if (!updated) await this.queueEvidence(storage, { ...receipt, ...terminal });
  }

  private kickOutbox(): void {
    this.ctx.waitUntil(this.flushEvidenceOutbox());
  }

  private flushEvidenceOutbox(): Promise<void> {
    if (!this.flushPromise) {
      this.flushPromise = this.flushEvidenceOutboxOnce().finally(() => {
        this.flushPromise = undefined;
      });
    }
    return this.flushPromise;
  }

  private async flushEvidenceOutboxOnce(): Promise<void> {
    const now = Date.now();
    const jobs = [...(await this.ctx.storage.list<EvidenceOutboxJob>({ prefix: 'o:' })).entries()]
      .filter(([, job]) => job.nextAttemptAt <= now)
      .slice(0, OUTBOX_BATCH_SIZE);

    for (const [jobKey, job] of jobs) {
      const requestId = jobKey.slice(2);
      const evidence = await this.ctx.storage.get<EvidenceEnvelope>(`e:${requestId}`);
      if (!evidence || evidence.revision !== job.revision) continue;

      try {
        if (!this.env.SUPABASE_URL || !this.env.SUPABASE_KEY) {
          throw new Error('request receipt outbox requires SUPABASE_URL and SUPABASE_KEY');
        }
        await upsertRequestReceipt(this.env.SUPABASE_URL, this.env.SUPABASE_KEY, evidence.row);
        await this.ctx.storage.transaction(async (storage) => {
          const currentJob = await storage.get<EvidenceOutboxJob>(jobKey);
          const currentEvidence = await storage.get<EvidenceEnvelope>(`e:${requestId}`);
          if (currentJob?.revision !== job.revision || currentEvidence?.revision !== job.revision) return;
          await storage.delete(jobKey);
          await storage.put(`e:${requestId}`, {
            ...currentEvidence,
            persistedAt: Date.now(),
          } satisfies EvidenceEnvelope);
          await this.scheduleAlarmNoLaterThan(storage, Date.now() + EVIDENCE_RETENTION_MS);
        });
      } catch (error) {
        console.error('request receipt outbox delivery failed:', error);
        await this.deferOutboxJob(jobKey, job);
      }
    }

    const remaining = await this.ctx.storage.list<EvidenceOutboxJob>({ prefix: 'o:' });
    if (remaining.size > 0) {
      const nextAttemptAt = Math.min(...[...remaining.values()].map((job) => job.nextAttemptAt));
      await this.scheduleAlarmNoLaterThan(this.ctx.storage, Math.max(Date.now() + MIN_ALARM_DELAY, nextAttemptAt));
    }
  }

  private async deferOutboxJob(jobKey: string, attempted: EvidenceOutboxJob): Promise<void> {
    await this.ctx.storage.transaction(async (storage) => {
      const current = await storage.get<EvidenceOutboxJob>(jobKey);
      if (current?.revision !== attempted.revision) return;
      const attempts = current.attempts + 1;
      const backoff = Math.min(OUTBOX_MAX_BACKOFF_MS, 1_000 * (2 ** Math.min(attempts, 6)));
      const nextAttemptAt = Date.now() + backoff;
      await storage.put(jobKey, { ...current, attempts, nextAttemptAt });
      await this.scheduleAlarmNoLaterThan(storage, nextAttemptAt);
    });
  }

  // --- private: record sub-methods ---

  private async settleReservation(
    storage: DurableObjectTransaction,
    reservationId: string,
    costCents: number,
    sessionId?: string,
    settlementStatus: RequestInsert['settlement_status'] = 'settled_actual',
  ): Promise<{
    duplicate: boolean;
    reservedAmount: number;
    reservationFound: boolean;
    costCents: number;
    settlementStatus: RequestInsert['settlement_status'];
    sessionId?: string;
  }> {
    if (!reservationId) {
      return {
        duplicate: false,
        reservedAmount: 0,
        reservationFound: false,
        costCents,
        settlementStatus,
        sessionId,
      };
    }
    const tombstone = await storage.get<SettlementTombstone>(`t:${reservationId}`);
    if (tombstone) {
      return {
        duplicate: true,
        reservedAmount: 0,
        reservationFound: tombstone.reservationFound ?? true,
        costCents: tombstone.costCents,
        settlementStatus: tombstone.settlementStatus ?? 'unknown',
        sessionId: tombstone.sessionId,
      };
    }
    const reservation = await storage.get<ReservationState>(`r:${reservationId}`);
    if (reservation) await storage.delete(`r:${reservationId}`);
    await storage.put(`t:${reservationId}`, {
      costCents,
      createdAt: Date.now(),
      reservationFound: !!reservation,
      sessionId: reservation ? reservation.sessionId : sessionId,
      settlementStatus: settlementStatus === 'settled_actual' ? 'settled_actual' : 'committed_ceiling',
    } satisfies SettlementTombstone);
    return {
      duplicate: false,
      reservedAmount: reservation?.amount ?? 0,
      reservationFound: !!reservation,
      costCents,
      settlementStatus,
      sessionId: reservation ? reservation.sessionId : sessionId,
    };
  }

  private async resolveRecordTarget(storage: DurableObjectTransaction, root: BudgetState, sessionId?: string): Promise<{ key: string; target: BudgetState }> {
    if (root.scope === 'session' && sessionId) {
      const sKey = `s:${sessionId}`;
      const session = await storage.get<BudgetState>(sKey);
      if (session) return { key: sKey, target: session };
    }
    return { key: 'root', target: root };
  }

  private applyCostSettlement(state: BudgetState, reservedAmount: number, costCents: number): void {
    state.reservedCents = Math.max(0, (state.reservedCents || 0) - reservedAmount);
    if (costCents > 0) state.usedCents += costCents;
  }

  private async checkAlerts(storage: DurableObjectTransaction, target: BudgetState, root: BudgetState, key: string, costCents: number): Promise<RecordResult['alert']> {
    const threshold = target.alertThreshold ?? root.alertThreshold ?? DEFAULT_ALERT_THRESHOLD;
    const webhookUrl = target.alertWebhookUrl ?? root.alertWebhookUrl;
    const pct = target.usedCents / target.limitCents;

    let alert: RecordResult['alert'];

    if (webhookUrl?.startsWith('https://') && pct >= threshold) {
      const alreadyAlerted = target.period === 'total'
        ? !!target.lastAlertAt
        : target.lastAlertAt && target.resetAt > 0 && target.lastAlertAt > (target.resetAt - periodMs(target.period));
      if (!alreadyAlerted) {
        target.lastAlertAt = Date.now();
        await storage.put(key, target);
        alert = { webhookUrl, budgetId: this.ctx.id.name ?? this.ctx.id.toString(), usedCents: target.usedCents, limitCents: target.limitCents, percentage: Math.round(pct * 100), period: target.period };
      }
    }

    if (webhookUrl) {
      const anomaly = await this.checkAnomaly(storage, costCents);
      if (anomaly && !alert) {
        alert = { webhookUrl, budgetId: this.ctx.id.name ?? this.ctx.id.toString(), usedCents: target.usedCents, limitCents: target.limitCents, percentage: Math.round(pct * 100), period: target.period, anomaly };
      }
    }

    return alert;
  }

  private async checkAnomaly(storage: DurableObjectTransaction, costCents: number): Promise<{ costCents: number; medianCents: number; multiplier: number } | undefined> {
    const recentCosts = (await storage.get<number[]>('recent_costs')) ?? [];
    recentCosts.push(costCents);
    if (recentCosts.length > ANOMALY_HISTORY_SIZE) recentCosts.shift();
    await storage.put('recent_costs', recentCosts);

    if (recentCosts.length < ANOMALY_MIN_SAMPLES) return undefined;

    const sorted = [...recentCosts].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    if (median <= 0 || costCents <= median * ANOMALY_MULTIPLIER) return undefined;

    const lastAnomaly = await storage.get<number>('anomaly_last_alert');
    if (lastAnomaly && Date.now() - lastAnomaly < ANOMALY_COOLDOWN_MS) return undefined;

    await storage.put('anomaly_last_alert', Date.now());
    return { costCents, medianCents: median, multiplier: +(costCents / median).toFixed(1) };
  }

  private async clearSessions(storage: DurableObjectTransaction): Promise<void> {
    const sessions = await storage.list({ prefix: 's:' });
    if (sessions.size > 0) await storage.delete([...sessions.keys()]);
  }
}

export function nextReset(period: 'daily' | 'weekly' | 'monthly'): number {
  const now = new Date();
  if (period === 'daily') {
    const next = new Date(now);
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(0, 0, 0, 0);
    return next.getTime();
  }
  if (period === 'weekly') {
    const next = new Date(now);
    const daysUntilMonday = (8 - next.getUTCDay()) % 7 || 7;
    next.setUTCDate(next.getUTCDate() + daysUntilMonday);
    next.setUTCHours(0, 0, 0, 0);
    return next.getTime();
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).getTime();
}

export function periodMs(period: string): number {
  if (period === 'daily') return DAY_MS;
  if (period === 'weekly') return 7 * DAY_MS;
  return 30 * DAY_MS;
}
