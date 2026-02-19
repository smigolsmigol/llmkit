import { createMiddleware } from 'hono/factory';
import { BudgetExceededError, getModelPricing } from '@llmkit/shared';
import type { ProviderName } from '@llmkit/shared';
import type { Env, BudgetRecord } from '../env';

export function budgetCheck() {
  return createMiddleware<Env>(async (c, next) => {
    // budget comes from API key record (set by auth middleware)
    // no per-request override - prevents users pointing to other budgets
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
      await c.env.BUDGET.put(budgetId, JSON.stringify(budget));
    }

    const remaining = budget.limitCents - budget.usedCents;
    if (remaining <= 0) {
      throw new BudgetExceededError(budgetId, budget.limitCents, budget.usedCents);
    }

    // rough cost estimate to catch obvious overages before calling the provider
    const body = await c.req.json();
    const provider = (c.req.header('x-llmkit-provider') || body.provider || 'anthropic') as ProviderName;
    const estimatedCents = estimateCost(body, provider);

    if (estimatedCents > 0 && remaining < estimatedCents) {
      throw new BudgetExceededError(budgetId, budget.limitCents, budget.usedCents);
    }

    c.set('budgetId', budgetId);
    c.set('budgetRecord', budget);
    await next();
  });
}

// called after a request completes to record actual spend
// non-atomic read-modify-write: concurrent requests can overshoot by one request's cost
// v2 upgrades to Durable Objects for true atomicity
export async function recordUsage(
  kv: KVNamespace,
  budgetId: string,
  costCents: number
): Promise<void> {
  if (costCents <= 0) return;

  const raw = await kv.get(budgetId);
  if (!raw) return;

  let budget: BudgetRecord;
  try {
    budget = JSON.parse(raw);
  } catch {
    console.error(`corrupt budget record in recordUsage: ${budgetId}`);
    return;
  }
  budget.usedCents += costCents;
  await kv.put(budgetId, JSON.stringify(budget));
}

function estimateCost(body: Record<string, unknown>, provider: ProviderName): number {
  const model = body.model as string;
  if (!model) return 0;

  const pricing = getModelPricing(provider, model);
  if (!pricing) return 0;

  // ~4 chars per token is a safe overestimate
  const messages = body.messages as Array<{ content: string }> | undefined;
  const inputChars = messages
    ? messages.reduce((sum, m) => sum + (m.content?.length || 0), 0)
    : 0;
  const inputTokens = Math.ceil(inputChars / 4);

  // use max_tokens if set, fall back to a conservative 1024
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

  // monthly: first day of next month at midnight UTC
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).getTime();
}
