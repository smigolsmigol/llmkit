import { DurableObject } from 'cloudflare:workers';

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
}

export interface RecordResult {
  usedCents: number;
  limitCents: number;
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

const DAY_MS = 86_400_000;
const SESSION_TTL = 7 * DAY_MS;
const RESERVATION_TTL = 5 * 60_000; // 5 min - stale reservations auto-expire

export class BudgetDO extends DurableObject {

  async check(input: CheckInput): Promise<CheckResult> {
    let root = await this.ctx.storage.get<BudgetState>('root');

    // lazy-init from DB config on first request
    if (!root && input.budgetConfig) {
      const period = input.budgetConfig.period as BudgetState['period'];
      root = {
        limitCents: input.budgetConfig.limitCents,
        usedCents: 0,
        reservedCents: 0,
        period,
        resetAt: period !== 'total' ? nextReset(period) : 0,
      };
      await this.ctx.storage.put('root', root);
    }

    if (!root) {
      return { allowed: true, remaining: Infinity, reservationId: '', scope: 'key', limitCents: 0, usedCents: 0 };
    }

    // sync config changes from DB (limit or period updated in dashboard)
    if (input.budgetConfig &&
      (root.limitCents !== input.budgetConfig.limitCents || root.period !== input.budgetConfig.period)) {
      root.limitCents = input.budgetConfig.limitCents;
      const newPeriod = input.budgetConfig.period as BudgetState['period'];
      if (root.period !== newPeriod) {
        root.period = newPeriod;
        root.resetAt = newPeriod !== 'total' ? nextReset(newPeriod) : 0;
      }
      await this.ctx.storage.put('root', root);
    }

    // period reset
    if (root.period !== 'total' && root.resetAt > 0 && Date.now() >= root.resetAt) {
      root.usedCents = 0;
      root.reservedCents = 0;
      root.resetAt = nextReset(root.period);
      root.lastAlertAt = undefined;
      await this.ctx.storage.put('root', root);
      await this.clearReservations();
    }

    let active = root;

    if (root.scope === 'session' && input.sessionId) {
      const sKey = `s:${input.sessionId}`;
      let session = await this.ctx.storage.get<BudgetState>(sKey);

      if (!session) {
        session = {
          limitCents: root.limitCents,
          usedCents: 0,
          reservedCents: 0,
          period: root.period,
          resetAt: root.resetAt,
          alertThreshold: root.alertThreshold,
          alertWebhookUrl: root.alertWebhookUrl,
        };
      }

      await this.ctx.storage.put(sKey, session);
      await this.ctx.storage.put(`${sKey}:ts`, Date.now());
      active = session;

      const existing = await this.ctx.storage.getAlarm();
      if (!existing) {
        await this.ctx.storage.setAlarm(Date.now() + DAY_MS);
      }
    }

    // committed = spent + reserved (in-flight requests)
    const sessionCommitted = active.usedCents + (active.reservedCents || 0);
    const rootCommitted = root.usedCents + (root.reservedCents || 0);
    const sessionRemaining = active.limitCents - sessionCommitted;
    const rootRemaining = root.limitCents - rootCommitted;
    const remaining = Math.min(sessionRemaining, rootRemaining);

    if (remaining <= 0 || (input.estimatedCents > 0 && remaining < input.estimatedCents)) {
      return { allowed: false, remaining: Math.max(0, remaining), reservationId: '', scope: root.scope || 'key', limitCents: active.limitCents, usedCents: active.usedCents };
    }

    // reserve the estimated amount atomically
    const reservationId = crypto.randomUUID();
    const reserveAmount = Math.max(input.estimatedCents, 1);

    root.reservedCents = (root.reservedCents || 0) + reserveAmount;
    await this.ctx.storage.put('root', root);

    if (active !== root) {
      active.reservedCents = (active.reservedCents || 0) + reserveAmount;
      await this.ctx.storage.put(`s:${input.sessionId}`, active);
    }

    await this.ctx.storage.put(`r:${reservationId}`, {
      amount: reserveAmount,
      sessionId: input.sessionId,
      createdAt: Date.now(),
    });

    return { allowed: true, remaining: remaining - reserveAmount, reservationId, scope: root.scope || 'key', limitCents: active.limitCents, usedCents: active.usedCents };
  }

  async record(input: RecordInput): Promise<RecordResult> {
    const root = await this.ctx.storage.get<BudgetState>('root');
    if (!root) return { usedCents: 0, limitCents: 0 };

    // settle the reservation: release reserved amount, add actual cost
    let reservedAmount = 0;
    if (input.reservationId) {
      const reservation = await this.ctx.storage.get<{ amount: number; sessionId?: string }>(
        `r:${input.reservationId}`,
      );
      if (reservation) {
        reservedAmount = reservation.amount;
        await this.ctx.storage.delete(`r:${input.reservationId}`);
      }
    }

    let key = 'root';
    let target = root;

    if (root.scope === 'session' && input.sessionId) {
      const sKey = `s:${input.sessionId}`;
      const session = await this.ctx.storage.get<BudgetState>(sKey);
      if (session) {
        key = sKey;
        target = session;
      }
    }

    // settle: remove reservation, add actual cost
    target.reservedCents = Math.max(0, (target.reservedCents || 0) - reservedAmount);
    if (input.costCents > 0) {
      target.usedCents += input.costCents;
    }
    await this.ctx.storage.put(key, target);

    if (key !== 'root') {
      root.reservedCents = Math.max(0, (root.reservedCents || 0) - reservedAmount);
      if (input.costCents > 0) {
        root.usedCents += input.costCents;
      }
      await this.ctx.storage.put('root', root);
    }

    if (input.costCents <= 0) {
      return { usedCents: target.usedCents, limitCents: target.limitCents };
    }

    const threshold = target.alertThreshold ?? root.alertThreshold ?? 0.8;
    const webhookUrl = target.alertWebhookUrl ?? root.alertWebhookUrl;
    const pct = target.usedCents / target.limitCents;

    let alert: RecordResult['alert'];

    if (webhookUrl?.startsWith('https://') && pct >= threshold) {
      const alreadyAlerted = target.lastAlertAt
        && target.resetAt > 0
        && target.lastAlertAt > (target.resetAt - periodMs(target.period));

      if (!alreadyAlerted) {
        target.lastAlertAt = Date.now();
        await this.ctx.storage.put(key, target);
        alert = {
          webhookUrl,
          budgetId: this.ctx.id.name ?? this.ctx.id.toString(),
          usedCents: target.usedCents,
          limitCents: target.limitCents,
          percentage: Math.round(pct * 100),
          period: target.period,
        };
      }
    }

    // anomaly detection: check if this cost is 3x+ the recent median
    if (input.costCents > 0 && webhookUrl) {
      const costsKey = 'recent_costs';
      const recentCosts = (await this.ctx.storage.get<number[]>(costsKey)) ?? [];
      recentCosts.push(input.costCents);
      if (recentCosts.length > 20) recentCosts.shift();
      await this.ctx.storage.put(costsKey, recentCosts);

      if (recentCosts.length >= 5) {
        const sorted = [...recentCosts].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
        const anomalyLastKey = 'anomaly_last_alert';
        if (median > 0 && input.costCents > median * 3) {
          const lastAnomaly = await this.ctx.storage.get<number>(anomalyLastKey);
          if (!lastAnomaly || Date.now() - lastAnomaly > 3600000) {
            await this.ctx.storage.put(anomalyLastKey, Date.now());
            if (!alert) {
              alert = {
                webhookUrl,
                budgetId: this.ctx.id.name ?? this.ctx.id.toString(),
                usedCents: target.usedCents,
                limitCents: target.limitCents,
                percentage: Math.round(pct * 100),
                period: target.period,
                anomaly: { costCents: input.costCents, medianCents: median, multiplier: +(input.costCents / median).toFixed(1) },
              };
            }
          }
        }
      }
    }

    return { usedCents: target.usedCents, limitCents: target.limitCents, alert };
  }

  async release(reservationId: string): Promise<void> {
    if (!reservationId) return;
    const reservation = await this.ctx.storage.get<{ amount: number; sessionId?: string }>(
      `r:${reservationId}`,
    );
    if (!reservation) return;

    await this.ctx.storage.delete(`r:${reservationId}`);

    const root = await this.ctx.storage.get<BudgetState>('root');
    if (!root) return;

    root.reservedCents = Math.max(0, (root.reservedCents || 0) - reservation.amount);
    await this.ctx.storage.put('root', root);

    if (root.scope === 'session' && reservation.sessionId) {
      const sKey = `s:${reservation.sessionId}`;
      const session = await this.ctx.storage.get<BudgetState>(sKey);
      if (session) {
        session.reservedCents = Math.max(0, (session.reservedCents || 0) - reservation.amount);
        await this.ctx.storage.put(sKey, session);
      }
    }
  }

  async configure(state: Omit<BudgetState, 'reservedCents'> & { reservedCents?: number }): Promise<void> {
    await this.ctx.storage.put('root', { ...state, reservedCents: state.reservedCents ?? 0 });
  }

  async alarm(): Promise<void> {
    const cutoff = Date.now() - SESSION_TTL;
    const reservationCutoff = Date.now() - RESERVATION_TTL;
    const entries = await this.ctx.storage.list({ prefix: 's:' });
    const reservations = await this.ctx.storage.list<{ amount: number; sessionId?: string; createdAt: number }>({ prefix: 'r:' });

    // clean stale sessions
    const toDelete: string[] = [];
    let hasSessions = false;

    for (const [key, val] of entries) {
      if (!key.endsWith(':ts')) continue;
      if (typeof val === 'number' && val < cutoff) {
        toDelete.push(key, key.slice(0, -3));
      } else {
        hasSessions = true;
      }
    }

    // clean stale reservations (request crashed or timed out without settling)
    let staleReserved = 0;
    for (const [key, val] of reservations) {
      if (val && typeof val === 'object' && val.createdAt < reservationCutoff) {
        staleReserved += val.amount;
        toDelete.push(key);
      }
    }

    if (toDelete.length > 0) {
      await this.ctx.storage.delete(toDelete);
    }

    // reclaim stale reservation amounts from root
    if (staleReserved > 0) {
      const root = await this.ctx.storage.get<BudgetState>('root');
      if (root) {
        root.reservedCents = Math.max(0, (root.reservedCents || 0) - staleReserved);
        await this.ctx.storage.put('root', root);
      }
    }

    if (hasSessions || reservations.size > toDelete.length) {
      await this.ctx.storage.setAlarm(Date.now() + DAY_MS);
    }
  }

  private async clearReservations(): Promise<void> {
    const reservations = await this.ctx.storage.list({ prefix: 'r:' });
    if (reservations.size > 0) {
      await this.ctx.storage.delete([...reservations.keys()]);
    }
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
