import type { CostBreakdown, TokenUsage } from '@f3d1/llmkit-shared';
import { createMiddleware } from 'hono/factory';
import type { RequestInsert } from '../db';
import { logRequest } from '../db';
import type { Env, ResponseMeta } from '../env';
import { recordUsage, sendAlert } from './budget';

export interface TrackParams {
  sessionId: string | undefined;
  apiKey: string | undefined;
  apiKeyId: string | undefined;
  budgetId: string | undefined;
  provider: string;
  model: string;
  usage: TokenUsage;
  cost: CostBreakdown;
  latencyMs: number;
  env: Env['Bindings'];
  ctx: ExecutionContext;
}

export async function trackRequest(p: TrackParams): Promise<void> {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    sessionId: p.sessionId,
    apiKey: p.apiKey,
    provider: p.provider,
    model: p.model,
    latencyMs: p.latencyMs,
    usage: p.usage,
    cost: p.cost,
  }));

  if (p.budgetId && p.cost.totalCost > 0) {
    const costCents = Math.ceil(p.cost.totalCost * 100);
    const alert = await recordUsage(p.env.BUDGET_DO, p.budgetId, p.sessionId, costCents);
    if (alert) {
      p.ctx.waitUntil(sendAlert(alert));
    }
  }

  if (p.apiKeyId && p.env.SUPABASE_URL && p.env.SUPABASE_KEY) {
    const row: RequestInsert = {
      api_key_id: p.apiKeyId,
      session_id: p.sessionId || null,
      provider: p.provider,
      model: p.model,
      input_tokens: p.usage.inputTokens,
      output_tokens: p.usage.outputTokens,
      cache_read_tokens: p.usage.cacheReadTokens || 0,
      cache_write_tokens: p.usage.cacheWriteTokens || 0,
      cost_cents: +(p.cost.totalCost * 100).toFixed(4),
      latency_ms: p.latencyMs,
      status: 'success',
      error_code: null,
    };
    p.ctx.waitUntil(logRequest(p.env.SUPABASE_URL, p.env.SUPABASE_KEY, row));
  }
}

export function costLogger() {
  return createMiddleware<Env>(async (c, next) => {
    const start = Date.now();
    await next();

    const meta: ResponseMeta | undefined = c.get('llmkit_response');
    if (!meta) return;

    await trackRequest({
      sessionId: c.req.header('x-llmkit-session-id') || undefined,
      apiKey: c.get('apiKey'),
      apiKeyId: c.get('apiKeyId'),
      budgetId: c.get('budgetId'),
      provider: meta.provider,
      model: meta.model || 'unknown',
      usage: meta.usage,
      cost: meta.cost,
      latencyMs: Date.now() - start,
      env: c.env,
      ctx: c.executionCtx,
    });
  });
}
