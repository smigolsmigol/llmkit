import { createMiddleware } from 'hono/factory';
import { logRequest } from '../db';
import type { Env, ResponseMeta } from '../env';
import { recordUsage, sendAlert } from './budget';

export function costLogger() {
  return createMiddleware<Env>(async (c, next) => {
    const start = Date.now();
    const sessionId = c.req.header('x-llmkit-session-id');

    await next();

    const latency = Date.now() - start;
    const meta: ResponseMeta | undefined = c.get('llmkit_response');
    if (!meta) return;

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      sessionId,
      apiKey: c.get('apiKey'),
      provider: meta.provider,
      model: meta.model,
      latencyMs: latency,
      usage: meta.usage,
      cost: meta.cost,
    }));

    const budgetId: string | undefined = c.get('budgetId');
    if (budgetId && meta.cost) {
      const costCents = Math.ceil(meta.cost.totalCost * 100);
      const alert = await recordUsage(c.env.BUDGET_DO, budgetId, sessionId || undefined, costCents);
      if (alert) {
        c.executionCtx.waitUntil(sendAlert(alert));
      }
    }

    const apiKeyId: string | undefined = c.get('apiKeyId');
    if (apiKeyId && c.env.SUPABASE_URL && c.env.SUPABASE_KEY) {
      c.executionCtx.waitUntil(
        logRequest(c.env.SUPABASE_URL, c.env.SUPABASE_KEY, {
          api_key_id: apiKeyId,
          session_id: sessionId || null,
          provider: meta.provider,
          model: meta.model || 'unknown',
          input_tokens: meta.usage.inputTokens,
          output_tokens: meta.usage.outputTokens,
          cache_read_tokens: meta.usage.cacheReadTokens || 0,
          cache_write_tokens: meta.usage.cacheWriteTokens || 0,
          cost_cents: +(meta.cost.totalCost * 100).toFixed(4),
          latency_ms: latency,
          status: 'success',
          error_code: null,
        })
      );
    }
  });
}
