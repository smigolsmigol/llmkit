import { createMiddleware } from 'hono/factory';
import { BudgetExceededError, getModelPricing } from '@llmkit/shared';
import type { ProviderName } from '@llmkit/shared';
import type { Env, BudgetRecord } from '../env';

export function budgetCheck() {
  return createMiddleware<Env>(async (c, next) => {
    const budgetId: string | undefined = c.get('budgetId');
    if (!budgetId) return await next();

    const raw = await c.env.BUDGET.get(budgetId);
    if (!raw) return await next();

    let budget: BudgetRecord;
    try {
      budget = JSON.parse(raw);
    } catch {
      console.error(`corrupt budget record: ${budgetId}`);
      return await next();
    }

    // reset if the current period expired
    if (budget.period !== 'total' && budget.resetAt > 0 && Date.now() >= budget.resetAt) {
      budget.usedCents = 0;
      budget.resetAt = nextReset(budget.period);
      budget.lastAlertAt = undefined;
      await c.env.BUDGET.put(budgetId, JSON.stringify(budget));
    }

    // resolve the actual KV key based on scope
    const sessionId = c.req.header('x-llmkit-session-id');
    let kvKey = budgetId;
    let activeBudget = budget;

    if (budget.scope === 'session' && sessionId) {
      kvKey = `${budgetId}:s:${sessionId}`;
      const sessionRaw = await c.env.BUDGET.get(kvKey);

      if (sessionRaw) {
        try {
          activeBudget = JSON.parse(sessionRaw);
        } catch {
          activeBudget = { limitCents: budget.limitCents, usedCents: 0, period: budget.period, resetAt: budget.resetAt };
        }
      } else {
        // first request for this session - create a fresh record
        activeBudget = { limitCents: budget.limitCents, usedCents: 0, period: budget.period, resetAt: budget.resetAt };
        await c.env.BUDGET.put(kvKey, JSON.stringify(activeBudget), { expirationTtl: 7 * 86400 });
      }
    }

    const remaining = activeBudget.limitCents - activeBudget.usedCents;
    if (remaining <= 0) {
      throw new BudgetExceededError(budgetId, activeBudget.limitCents, activeBudget.usedCents);
    }

    const body = await c.req.json();
    const provider = (c.req.header('x-llmkit-provider') || body.provider || 'anthropic') as ProviderName;
    const estimatedCents = estimateCost(body, provider);

    if (estimatedCents > 0 && remaining < estimatedCents) {
      throw new BudgetExceededError(budgetId, activeBudget.limitCents, activeBudget.usedCents);
    }

    c.set('budgetId', budgetId);
    c.set('budgetRecord', activeBudget);
    c.set('budgetScope', budget.scope || 'key');
    c.set('budgetKvKey', kvKey);
    await next();
  });
}

export async function recordUsage(
  kv: KVNamespace,
  kvKey: string,
  costCents: number,
): Promise<BudgetRecord | null> {
  if (costCents <= 0) return null;

  const raw = await kv.get(kvKey);
  if (!raw) return null;

  let budget: BudgetRecord;
  try {
    budget = JSON.parse(raw);
  } catch {
    console.error(`corrupt budget record in recordUsage: ${kvKey}`);
    return null;
  }
  budget.usedCents += costCents;
  await kv.put(kvKey, JSON.stringify(budget));
  return budget;
}

export async function maybeSendAlert(
  kv: KVNamespace,
  kvKey: string,
  budget: BudgetRecord,
): Promise<void> {
  if (!budget.alertWebhookUrl) return;

  const threshold = budget.alertThreshold ?? 0.8;
  const pct = budget.usedCents / budget.limitCents;
  if (pct < threshold) return;

  // already alerted this period
  if (budget.lastAlertAt && budget.resetAt > 0 && budget.lastAlertAt > (budget.resetAt - periodMs(budget.period))) {
    return;
  }

  try {
    await fetch(budget.alertWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'budget.threshold',
        budgetId: kvKey,
        usedCents: budget.usedCents,
        limitCents: budget.limitCents,
        percentage: Math.round(pct * 100),
        period: budget.period,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (err) {
    console.error('budget alert webhook failed:', err);
    return;
  }

  budget.lastAlertAt = Date.now();
  await kv.put(kvKey, JSON.stringify(budget));
}

function estimateCost(body: Record<string, unknown>, provider: ProviderName): number {
  const model = body.model as string;
  if (!model) return 0;

  const pricing = getModelPricing(provider, model);
  if (!pricing) return 0;

  const messages = body.messages as Array<{ content: string }> | undefined;
  const inputChars = messages
    ? messages.reduce((sum, m) => sum + (m.content?.length || 0), 0)
    : 0;
  const inputTokens = Math.ceil(inputChars / 4);

  const maxOutput = (body.max_tokens as number) || (body.maxTokens as number) || 1024;

  const costUsd =
    (inputTokens / 1_000_000) * pricing.inputPerMillion +
    (maxOutput / 1_000_000) * pricing.outputPerMillion;

  return Math.ceil(costUsd * 100);
}

function nextReset(period: 'daily' | 'weekly' | 'monthly'): number {
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

function periodMs(period: string): number {
  if (period === 'daily') return 86400000;
  if (period === 'weekly') return 7 * 86400000;
  return 30 * 86400000;
}
