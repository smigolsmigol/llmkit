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
const RESERVATION_TTL = 5 * 60_000;
const ANOMALY_MULTIPLIER = 3;
const ANOMALY_HISTORY_SIZE = 20;
const ANOMALY_MIN_SAMPLES = 5;
const ANOMALY_COOLDOWN_MS = 3_600_000;
const DEFAULT_ALERT_THRESHOLD = 0.8;

export class BudgetDO extends DurableObject {

  // --- check: can this request proceed? ---

  async check(input: CheckInput): Promise<CheckResult> {
    const root = await this.initOrSyncRoot(input.budgetConfig);
    if (!root) return { allowed: true, remaining: Infinity, reservationId: '', scope: 'key', limitCents: 0, usedCents: 0 };

    await this.resetPeriodIfDue(root);

    const active = await this.resolveTarget(root, input.sessionId);
    const remaining = this.computeRemaining(active, root);

    if (remaining <= 0 || (input.estimatedCents > 0 && remaining < input.estimatedCents)) {
      return { allowed: false, remaining: Math.max(0, remaining), reservationId: '', scope: root.scope || 'key', limitCents: active.limitCents, usedCents: active.usedCents };
    }

    const reservationId = await this.createReservation(root, active, input);
    return { allowed: true, remaining: remaining - Math.max(input.estimatedCents, 1), reservationId, scope: root.scope || 'key', limitCents: active.limitCents, usedCents: active.usedCents };
  }

  // --- record: settle actual cost after response ---

  async record(input: RecordInput): Promise<RecordResult> {
    const root = await this.ctx.storage.get<BudgetState>('root');
    if (!root) return { usedCents: 0, limitCents: 0 };

    await this.resetPeriodIfDue(root);

    const reservedAmount = await this.settleReservation(input.reservationId);
    const { key, target } = await this.resolveRecordTarget(root, input.sessionId);

    this.applyCostSettlement(target, reservedAmount, input.costCents);
    await this.ctx.storage.put(key, target);

    if (key !== 'root') {
      this.applyCostSettlement(root, reservedAmount, input.costCents);
      await this.ctx.storage.put('root', root);
    }

    if (input.costCents <= 0) return { usedCents: target.usedCents, limitCents: target.limitCents };

    const alert = await this.checkAlerts(target, root, key, input.costCents);
    return { usedCents: target.usedCents, limitCents: target.limitCents, alert };
  }

  // --- release: free reservation without recording cost ---

  async release(reservationId: string): Promise<void> {
    if (!reservationId) return;
    const reservation = await this.ctx.storage.get<{ amount: number; sessionId?: string }>(`r:${reservationId}`);
    if (!reservation) return;

    await this.ctx.storage.delete(`r:${reservationId}`);

    const root = await this.ctx.storage.get<BudgetState>('root');
    if (!root) return;

    root.reservedCents = Math.max(0, (root.reservedCents || 0) - reservation.amount);
    await this.ctx.storage.put('root', root);

    if (root.scope === 'session' && reservation.sessionId) {
      const session = await this.ctx.storage.get<BudgetState>(`s:${reservation.sessionId}`);
      if (session) {
        session.reservedCents = Math.max(0, (session.reservedCents || 0) - reservation.amount);
        await this.ctx.storage.put(`s:${reservation.sessionId}`, session);
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

    let staleReserved = 0;
    const staleBySession: Record<string, number> = {};
    for (const [key, val] of reservations) {
      if (val && typeof val === 'object' && val.createdAt < reservationCutoff) {
        staleReserved += val.amount;
        toDelete.push(key);
        if (val.sessionId) {
          staleBySession[val.sessionId] = (staleBySession[val.sessionId] || 0) + val.amount;
        }
      }
    }

    if (toDelete.length > 0) await this.ctx.storage.delete(toDelete);

    if (staleReserved > 0) {
      const root = await this.ctx.storage.get<BudgetState>('root');
      if (root) {
        root.reservedCents = Math.max(0, (root.reservedCents || 0) - staleReserved);
        await this.ctx.storage.put('root', root);
      }

      for (const [sessionId, amount] of Object.entries(staleBySession)) {
        const session = await this.ctx.storage.get<BudgetState>(`s:${sessionId}`);
        if (session) {
          session.reservedCents = Math.max(0, (session.reservedCents || 0) - amount);
          await this.ctx.storage.put(`s:${sessionId}`, session);
        }
      }
    }

    if (hasSessions || reservations.size > toDelete.length) {
      await this.ctx.storage.setAlarm(Date.now() + DAY_MS);
    }
  }

  // --- private: check sub-methods ---

  private async initOrSyncRoot(budgetConfig?: { limitCents: number; period: string }): Promise<BudgetState | null> {
    let root = await this.ctx.storage.get<BudgetState>('root');

    if (!root && budgetConfig) {
      const period = budgetConfig.period as BudgetState['period'];
      root = { limitCents: budgetConfig.limitCents, usedCents: 0, reservedCents: 0, period, resetAt: period !== 'total' ? nextReset(period) : 0 };
      await this.ctx.storage.put('root', root);
    }

    if (root && budgetConfig && (root.limitCents !== budgetConfig.limitCents || root.period !== budgetConfig.period)) {
      root.limitCents = budgetConfig.limitCents;
      const newPeriod = budgetConfig.period as BudgetState['period'];
      if (root.period !== newPeriod) {
        root.period = newPeriod;
        root.resetAt = newPeriod !== 'total' ? nextReset(newPeriod) : 0;
      }
      await this.ctx.storage.put('root', root);
    }

    return root ?? null;
  }

  private async resetPeriodIfDue(root: BudgetState): Promise<void> {
    if (root.period !== 'total' && root.resetAt > 0 && Date.now() >= root.resetAt) {
      root.usedCents = 0;
      root.reservedCents = 0;
      root.resetAt = nextReset(root.period);
      root.lastAlertAt = undefined;
      await this.ctx.storage.put('root', root);
      await this.clearReservations();
      await this.clearSessions();
    }
  }

  private async resolveTarget(root: BudgetState, sessionId?: string): Promise<BudgetState> {
    if (root.scope !== 'session' || !sessionId) return root;

    const sKey = `s:${sessionId}`;
    let session = await this.ctx.storage.get<BudgetState>(sKey);

    if (!session) {
      session = { limitCents: root.limitCents, usedCents: 0, reservedCents: 0, period: root.period, resetAt: root.resetAt, alertThreshold: root.alertThreshold, alertWebhookUrl: root.alertWebhookUrl };
    }

    await this.ctx.storage.put(sKey, session);
    await this.ctx.storage.put(`${sKey}:ts`, Date.now());

    if (!(await this.ctx.storage.getAlarm())) {
      await this.ctx.storage.setAlarm(Date.now() + DAY_MS);
    }

    return session;
  }

  private computeRemaining(active: BudgetState, root: BudgetState): number {
    const sessionRemaining = active.limitCents - active.usedCents - (active.reservedCents || 0);
    const rootRemaining = root.limitCents - root.usedCents - (root.reservedCents || 0);
    return Math.min(sessionRemaining, rootRemaining);
  }

  private async createReservation(root: BudgetState, active: BudgetState, input: CheckInput): Promise<string> {
    const reservationId = crypto.randomUUID();
    const amount = Math.max(input.estimatedCents, 1);

    root.reservedCents = (root.reservedCents || 0) + amount;
    await this.ctx.storage.put('root', root);

    if (active !== root && input.sessionId) {
      active.reservedCents = (active.reservedCents || 0) + amount;
      await this.ctx.storage.put(`s:${input.sessionId}`, active);
    }

    await this.ctx.storage.put(`r:${reservationId}`, { amount, sessionId: input.sessionId, createdAt: Date.now() });
    return reservationId;
  }

  // --- private: record sub-methods ---

  private async settleReservation(reservationId: string): Promise<number> {
    if (!reservationId) return 0;
    const reservation = await this.ctx.storage.get<{ amount: number }>(`r:${reservationId}`);
    if (!reservation) return 0;
    await this.ctx.storage.delete(`r:${reservationId}`);
    return reservation.amount;
  }

  private async resolveRecordTarget(root: BudgetState, sessionId?: string): Promise<{ key: string; target: BudgetState }> {
    if (root.scope === 'session' && sessionId) {
      const sKey = `s:${sessionId}`;
      const session = await this.ctx.storage.get<BudgetState>(sKey);
      if (session) return { key: sKey, target: session };
    }
    return { key: 'root', target: root };
  }

  private applyCostSettlement(state: BudgetState, reservedAmount: number, costCents: number): void {
    state.reservedCents = Math.max(0, (state.reservedCents || 0) - reservedAmount);
    if (costCents > 0) state.usedCents += costCents;
  }

  private async checkAlerts(target: BudgetState, root: BudgetState, key: string, costCents: number): Promise<RecordResult['alert']> {
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
        await this.ctx.storage.put(key, target);
        alert = { webhookUrl, budgetId: this.ctx.id.name ?? this.ctx.id.toString(), usedCents: target.usedCents, limitCents: target.limitCents, percentage: Math.round(pct * 100), period: target.period };
      }
    }

    if (webhookUrl) {
      const anomaly = await this.checkAnomaly(costCents);
      if (anomaly && !alert) {
        alert = { webhookUrl, budgetId: this.ctx.id.name ?? this.ctx.id.toString(), usedCents: target.usedCents, limitCents: target.limitCents, percentage: Math.round(pct * 100), period: target.period, anomaly };
      }
    }

    return alert;
  }

  private async checkAnomaly(costCents: number): Promise<{ costCents: number; medianCents: number; multiplier: number } | undefined> {
    const recentCosts = (await this.ctx.storage.get<number[]>('recent_costs')) ?? [];
    recentCosts.push(costCents);
    if (recentCosts.length > ANOMALY_HISTORY_SIZE) recentCosts.shift();
    await this.ctx.storage.put('recent_costs', recentCosts);

    if (recentCosts.length < ANOMALY_MIN_SAMPLES) return undefined;

    const sorted = [...recentCosts].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    if (median <= 0 || costCents <= median * ANOMALY_MULTIPLIER) return undefined;

    const lastAnomaly = await this.ctx.storage.get<number>('anomaly_last_alert');
    if (lastAnomaly && Date.now() - lastAnomaly < ANOMALY_COOLDOWN_MS) return undefined;

    await this.ctx.storage.put('anomaly_last_alert', Date.now());
    return { costCents, medianCents: median, multiplier: +(costCents / median).toFixed(1) };
  }

  private async clearReservations(): Promise<void> {
    const reservations = await this.ctx.storage.list({ prefix: 'r:' });
    if (reservations.size > 0) await this.ctx.storage.delete([...reservations.keys()]);
  }

  private async clearSessions(): Promise<void> {
    const sessions = await this.ctx.storage.list({ prefix: 's:' });
    if (sessions.size > 0) await this.ctx.storage.delete([...sessions.keys()]);
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
