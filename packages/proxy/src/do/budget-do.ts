import { DurableObject } from 'cloudflare:workers';

export interface BudgetState {
  limitCents: number;
  usedCents: number;
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
}

export interface CheckResult {
  allowed: boolean;
  remaining: number;
  scope: 'key' | 'session';
  limitCents: number;
  usedCents: number;
}

export interface RecordInput {
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
  };
}

const DAY_MS = 86_400_000;
const SESSION_TTL = 7 * DAY_MS;

export class BudgetDO extends DurableObject {

  async check(input: CheckInput): Promise<CheckResult> {
    const root = await this.ctx.storage.get<BudgetState>('root');
    if (!root) {
      return { allowed: true, remaining: Infinity, scope: 'key', limitCents: 0, usedCents: 0 };
    }

    if (root.period !== 'total' && root.resetAt > 0 && Date.now() >= root.resetAt) {
      root.usedCents = 0;
      root.resetAt = nextReset(root.period);
      root.lastAlertAt = undefined;
      await this.ctx.storage.put('root', root);
    }

    let active = root;

    if (root.scope === 'session' && input.sessionId) {
      const sKey = `s:${input.sessionId}`;
      let session = await this.ctx.storage.get<BudgetState>(sKey);

      if (!session) {
        session = {
          limitCents: root.limitCents,
          usedCents: 0,
          period: root.period,
          resetAt: root.resetAt,
          alertThreshold: root.alertThreshold,
          alertWebhookUrl: root.alertWebhookUrl,
        };
      }

      await this.ctx.storage.put(sKey, session);
      await this.ctx.storage.put(`${sKey}:ts`, Date.now());
      active = session;

      // schedule cleanup alarm if not already set
      const existing = await this.ctx.storage.getAlarm();
      if (!existing) {
        await this.ctx.storage.setAlarm(Date.now() + DAY_MS);
      }
    }

    // enforce both session limit AND root aggregate limit
    const sessionRemaining = active.limitCents - active.usedCents;
    const rootRemaining = root.limitCents - root.usedCents;
    const remaining = Math.min(sessionRemaining, rootRemaining);

    if (remaining <= 0 || (input.estimatedCents > 0 && remaining < input.estimatedCents)) {
      return { allowed: false, remaining: Math.max(0, remaining), scope: root.scope || 'key', limitCents: active.limitCents, usedCents: active.usedCents };
    }

    return { allowed: true, remaining, scope: root.scope || 'key', limitCents: active.limitCents, usedCents: active.usedCents };
  }

  async record(input: RecordInput): Promise<RecordResult> {
    if (input.costCents <= 0) {
      return { usedCents: 0, limitCents: 0 };
    }

    const root = await this.ctx.storage.get<BudgetState>('root');
    if (!root) return { usedCents: 0, limitCents: 0 };

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

    target.usedCents += input.costCents;
    await this.ctx.storage.put(key, target);

    // always track aggregate spend on root so session-scoped budgets
    // can't bypass the total limit by creating new sessions
    if (key !== 'root') {
      root.usedCents += input.costCents;
      await this.ctx.storage.put('root', root);
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

    return { usedCents: target.usedCents, limitCents: target.limitCents, alert };
  }

  async configure(state: BudgetState): Promise<void> {
    await this.ctx.storage.put('root', state);
  }

  async alarm(): Promise<void> {
    const cutoff = Date.now() - SESSION_TTL;
    const entries = await this.ctx.storage.list<number>({ prefix: 's:' });

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

    if (toDelete.length > 0) {
      await this.ctx.storage.delete(toDelete);
    }

    if (hasSessions) {
      await this.ctx.storage.setAlarm(Date.now() + DAY_MS);
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
