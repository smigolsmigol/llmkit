import type { ProviderName } from '@f3d1/llmkit-shared';
import { BudgetExceededError, ValidationError } from '@f3d1/llmkit-shared';
import { createMiddleware } from 'hono/factory';
import type { BudgetDO } from '../do/budget-do';
import type { Env } from '../env';
import { resolvePricing } from '../pricing';

function validateSessionId(sessionId: string | undefined): void {
  if (sessionId && !/^[\w-]{1,128}$/.test(sessionId)) {
    throw new ValidationError('invalid session ID format');
  }
}

async function parseBody(c: { req: { json(): Promise<Record<string, unknown>> } }): Promise<Record<string, unknown>> {
  try {
    return await c.req.json();
  } catch {
    throw new ValidationError('invalid JSON body');
  }
}

export function budgetCheck() {
  return createMiddleware<Env>(async (c, next) => {
    const budgetId: string | undefined = c.get('budgetId');
    if (!budgetId) return await next();

    const sessionId = c.req.header('x-llmkit-session-id');
    validateSessionId(sessionId);

    const body = await parseBody(c);
    const provider = (c.req.header('x-llmkit-provider') || body.provider || 'anthropic') as ProviderName;
    const estimated = await estimateCost(body, provider);

    const stub = c.env.BUDGET_DO.get(c.env.BUDGET_DO.idFromName(budgetId));
    const budgetConfig = c.get('budgetConfig');
    const result = await stub.check({
      sessionId: sessionId || undefined,
      estimatedCents: estimated,
      budgetConfig,
    });

    if (!result.allowed) {
      throw new BudgetExceededError(budgetId, result.limitCents, result.usedCents);
    }

    const clamped = await affordableMaxTokens(result.remaining, body, provider);
    if (clamped !== undefined && clamped < 10) {
      // release reservation before rejecting
      if (result.reservationId) {
        await stub.release(result.reservationId);
      }
      throw new BudgetExceededError(budgetId, result.limitCents, result.usedCents);
    }

    c.set('budgetId', budgetId);
    c.set('budgetScope', result.scope);
    c.set('budgetReservationId', result.reservationId);
    if (clamped !== undefined) c.set('budgetMaxTokens', clamped);
    await next();
  });
}

export async function recordUsage(
  doNamespace: DurableObjectNamespace<BudgetDO>,
  budgetId: string,
  sessionId: string | undefined,
  costCents: number,
  reservationId?: string,
): Promise<{ webhookUrl: string; body: Record<string, unknown> } | null> {
  const stub = doNamespace.get(doNamespace.idFromName(budgetId));
  const result = await stub.record({ reservationId: reservationId || '', sessionId, costCents });

  if (result.alert) {
    return {
      webhookUrl: result.alert.webhookUrl,
      body: {
        type: 'budget.threshold',
        budgetId: result.alert.budgetId,
        usedCents: result.alert.usedCents,
        limitCents: result.alert.limitCents,
        percentage: result.alert.percentage,
        period: result.alert.period,
        timestamp: new Date().toISOString(),
      },
    };
  }

  return null;
}

export async function sendAlert(alert: { webhookUrl: string; body: Record<string, unknown> }): Promise<void> {
  try {
    if (!alert.webhookUrl.startsWith('https://')) return;
    await fetch(alert.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(alert.body),
    });
  } catch (err) {
    console.error('budget alert webhook failed:', err);
  }
}

// pure functions for cost estimation (exported for testing)

export async function estimateCost(body: Record<string, unknown>, provider: ProviderName): Promise<number> {
  const model = body.model as string;
  if (!model) return 0;

  const pricing = await resolvePricing(provider, model);
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

export async function affordableMaxTokens(
  remainingCents: number,
  body: Record<string, unknown>,
  provider: ProviderName,
): Promise<number | undefined> {
  const model = body.model as string;
  if (!model) return undefined;

  const pricing = await resolvePricing(provider, model);
  if (!pricing || pricing.outputPerMillion === 0) return undefined;

  const messages = body.messages as Array<{ content: string }> | undefined;
  const inputChars = messages
    ? messages.reduce((sum, m) => sum + (m.content?.length || 0), 0)
    : 0;
  const inputTokens = Math.ceil(inputChars / 4);
  const inputCostCents = ((inputTokens / 1_000_000) * pricing.inputPerMillion) * 100;

  const centsForOutput = remainingCents - inputCostCents;
  if (centsForOutput <= 0) return 0;

  const affordable = Math.floor((centsForOutput / 100 / pricing.outputPerMillion) * 1_000_000);
  const userMax = (body.max_tokens as number) ?? (body.maxTokens as number);

  if (userMax && affordable >= userMax) return undefined;

  return affordable;
}
