import type { CostBreakdown, TokenUsage } from '@f3d1/llmkit-shared';
import { createMiddleware } from 'hono/factory';
import type { RequestInsert } from '../db';
import { logRequest } from '../db';
import type { Env, ResponseMeta } from '../env';
import { formatFirstSuccess, notifyTelegram } from '../notify';
import { recordUsage, sendAlert } from './budget';

// per-isolate dedup for first-success notifications (resets on cold start, which is fine)
const seenUsers = new Set<string>();

export interface TrackParams {
  sessionId: string | undefined;
  apiKey: string | undefined;
  apiKeyId: string | undefined;
  userId: string | undefined;
  budgetId: string | undefined;
  budgetReservationId: string | undefined;
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

  if (p.cost.totalCost === 0 && (p.usage.inputTokens > 0 || p.usage.outputTokens > 0)) {
    console.warn(
      `ZERO COST WARNING: ${p.provider}/${p.model} processed ${p.usage.inputTokens + p.usage.outputTokens} tokens but cost is $0. Model likely missing from pricing data.`,
    );
  }

  if (p.budgetId && (p.cost.totalCost > 0 || p.budgetReservationId)) {
    const costCents = Math.ceil(p.cost.totalCost * 100);
    const alert = await recordUsage(p.env.BUDGET_DO, p.budgetId, p.sessionId, costCents, p.budgetReservationId);
    if (alert) {
      p.ctx.waitUntil(sendAlert(alert));
    }
  }

  if (p.apiKeyId && p.userId && p.env.SUPABASE_URL && p.env.SUPABASE_KEY) {
    persistAndNotify(p as TrackParams & { userId: string; apiKeyId: string });
  }
}

function persistAndNotify(p: TrackParams & { userId: string; apiKeyId: string }) {
  const url = p.env.SUPABASE_URL;
  const key = p.env.SUPABASE_KEY;
  if (!url || !key) return;

  const row: RequestInsert = {
    user_id: p.userId,
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
  p.ctx.waitUntil(logRequest(url, key, row));

  if (p.env.TELEGRAM_BOT_TOKEN && p.env.TELEGRAM_CHAT_ID && !seenUsers.has(p.userId)) {
    seenUsers.add(p.userId);
    p.ctx.waitUntil(
      notifyTelegram(
        p.env.TELEGRAM_BOT_TOKEN,
        p.env.TELEGRAM_CHAT_ID,
        formatFirstSuccess(p.userId, p.provider, p.model, p.cost.totalCost),
      ),
    );
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
      userId: c.get('userId'),
      budgetId: c.get('budgetId'),
      budgetReservationId: c.get('budgetReservationId'),
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
