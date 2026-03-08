import { inferProvider, LLMKitError } from '@f3d1/llmkit-shared';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { logRequest } from './db';
import type { Env } from './env';
import { auth } from './middleware/auth';
import { budgetCheck, releaseReservation } from './middleware/budget';
import { costLogger } from './middleware/logger';
import { rateLimit } from './middleware/ratelimit';
import { formatErrorStreak, formatNewUser, notifyTelegram } from './notify';

// per-isolate tracking for new-user notifications (resets on cold start)
const notifiedUsers = new Set<string>();
import { analyticsRouter } from './routes/analytics';
import { providerRouter } from './routes/chat';
import { keysRouter } from './routes/keys';
import { mcpRouter } from './routes/mcp';

export { BudgetDO } from './do/budget-do';
export { RateLimitDO } from './do/ratelimit-do';

const app = new Hono<Env>();

app.use('*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization', 'x-llmkit-provider', 'x-llmkit-provider-key', 'x-llmkit-fallback', 'x-llmkit-session-id', 'x-llmkit-format'],
  exposeHeaders: ['x-llmkit-cost', 'x-llmkit-provider', 'x-llmkit-latency-ms', 'x-llmkit-session-id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After'],
  allowMethods: ['POST', 'GET', 'DELETE', 'OPTIONS'],
}));

app.onError(async (err, c) => {
  const code = err instanceof LLMKitError ? err.code : 'INTERNAL_ERROR';
  const status = err instanceof LLMKitError ? err.statusCode : 500;

  // log failed requests to Supabase (only if auth succeeded, so we have user context)
  const apiKeyId = c.get('apiKeyId');
  const userId = c.get('userId');
  if (apiKeyId && userId && c.env.SUPABASE_URL && c.env.SUPABASE_KEY) {
    let provider = c.get('requestProvider') || c.req.header('x-llmkit-provider') || 'unknown';
    let model = c.get('requestModel') || 'unknown';
    if (model === 'unknown') {
      try { const b = await c.req.json(); model = b?.model || 'unknown'; if (provider === 'unknown') provider = b?.provider || inferProvider(model) || 'unknown'; } catch {}
    }
    c.executionCtx.waitUntil(
      logRequest(c.env.SUPABASE_URL, c.env.SUPABASE_KEY, {
        user_id: userId,
        api_key_id: apiKeyId,
        session_id: c.req.header('x-llmkit-session-id') || null,
        provider,
        model,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        cost_cents: 0,
        latency_ms: 0,
        status: 'error',
        error_code: code,
      }),
    );

    if (c.env.TELEGRAM_BOT_TOKEN && c.env.TELEGRAM_CHAT_ID) {
      const tg = { token: c.env.TELEGRAM_BOT_TOKEN, chat: c.env.TELEGRAM_CHAT_ID };

      // notify on first-ever request from a new user
      if (!notifiedUsers.has(userId)) {
        notifiedUsers.add(userId);
        c.executionCtx.waitUntil(
          notifyTelegram(tg.token, tg.chat, formatNewUser(userId, c.get('apiKey') || '???')),
        );
      }

      // notify on user errors (skip rate limit, auth - those are normal)
      if (code !== 'RATE_LIMIT' && code !== 'AUTH_ERROR') {
        c.executionCtx.waitUntil(
          notifyTelegram(tg.token, tg.chat, formatErrorStreak(userId, c.get('apiKey') || '???', code, model, provider, 1)),
        );
      }
    }
  }

  // release budget reservation on error (don't lock up budget for failed requests)
  const budgetId = c.get('budgetId');
  const reservationId = c.get('budgetReservationId');
  if (budgetId && reservationId) {
    c.executionCtx.waitUntil(releaseReservation(c.env.BUDGET_DO, budgetId, reservationId));
  }

  if (!(err instanceof LLMKitError)) console.error('unhandled:', err);
  return c.json(
    { error: { code, message: err instanceof LLMKitError ? err.message : 'Something went wrong' } },
    status as ContentfulStatusCode,
  );
});

app.get('/health', (c) => c.json({ status: 'ok', version: '0.0.1' }));

app.use('/v1/*', auth());
app.use('/v1/*', rateLimit());
app.use('/v1/*', budgetCheck());
app.use('/v1/*', costLogger());

app.route('/v1', providerRouter);
app.route('/v1', keysRouter);
app.route('/v1', analyticsRouter);

// MCP server card for discovery (Smithery, Glama connectors)
app.get('/.well-known/mcp/server-card.json', (c) => c.json({
  name: 'llmkit',
  description: 'AI API cost tracking and budget enforcement across 11 providers',
  version: '0.1.0',
  url: 'https://llmkit-proxy.smigolsmigol.workers.dev/mcp',
  authentication: { type: 'bearer' },
  capabilities: { tools: true },
}));

// MCP endpoint: auth only, no budget/rate-limit (read-only queries)
app.use('/mcp', auth());
app.use('/mcp/*', auth());
app.route('/mcp', mcpRouter);

export default app;
