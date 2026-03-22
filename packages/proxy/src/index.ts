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
import { formatErrorStreak, formatNewUser, formatRequestLog, notifyTelegram } from './notify';
import { analyticsRouter } from './routes/analytics';
import { providerRouter } from './routes/chat';
import { keysRouter } from './routes/keys';
import { mcpRouter } from './routes/mcp';

export { BudgetDO } from './do/budget-do';
export { RateLimitDO } from './do/ratelimit-do';

// per-isolate cache (warm-start dedup only, DB is source of truth)
const notifiedUsers = new Set<string>();

async function hasExistingRequests(supabaseUrl: string, supabaseKey: string, apiKeyId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/requests?select=id&api_key_id=eq.${encodeURIComponent(apiKeyId)}&limit=1`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } },
    );
    const data = await res.json() as unknown[];
    return data.length > 0;
  } catch {
    return false;
  }
}

function resolveErrorContext(c: { get: (k: string) => string | undefined; req: { json(): Promise<Record<string, unknown>>; header(n: string): string | undefined } }) {
  const provider = c.get('requestProvider') || c.req.header('x-llmkit-provider') || 'unknown';
  const model = c.get('requestModel') || 'unknown';
  return { provider, model };
}

async function resolveModelFromBody(c: { req: { json(): Promise<Record<string, unknown>> } }, ctx: { provider: string; model: string }) {
  if (ctx.model !== 'unknown') return;
  try {
    const b = await c.req.json();
    ctx.model = (b?.model as string) || 'unknown';
    if (ctx.provider === 'unknown') ctx.provider = (b?.provider as string) || inferProvider(ctx.model) || 'unknown';
  } catch {}
}

function sendErrorNotifications(
  ctx: ExecutionContext,
  env: Env['Bindings'],
  userId: string,
  apiKeyId: string,
  apiKey: string,
  code: string,
  model: string,
  provider: string,
) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID || !env.SUPABASE_URL || !env.SUPABASE_KEY) return;
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chat, SUPABASE_URL: dbUrl, SUPABASE_KEY: dbKey } = env;

  if (!notifiedUsers.has(userId)) {
    notifiedUsers.add(userId);
    ctx.waitUntil(
      hasExistingRequests(dbUrl, dbKey, apiKeyId).then((exists) => {
        if (!exists) return notifyTelegram(token, chat, formatNewUser(userId, apiKey));
      }),
    );
  }

  if (code !== 'RATE_LIMIT' && code !== 'AUTH_ERROR') {
    ctx.waitUntil(notifyTelegram(token, chat, formatErrorStreak(userId, apiKey, code, model, provider, 1)));
  }

  if (env.TELEGRAM_VERBOSE) {
    ctx.waitUntil(notifyTelegram(token, chat, formatRequestLog(userId, provider, model, 0, 0, 0, 0, code)));
  }
}

const app = new Hono<Env>();

app.use('*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization', 'x-llmkit-provider', 'x-llmkit-provider-key', 'x-llmkit-fallback', 'x-llmkit-session-id', 'x-llmkit-user-id', 'x-llmkit-format'],
  exposeHeaders: ['x-llmkit-cost', 'x-llmkit-provider', 'x-llmkit-latency-ms', 'x-llmkit-session-id', 'x-llmkit-user-id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After'],
  allowMethods: ['POST', 'GET', 'DELETE', 'OPTIONS'],
}));

app.onError(async (err, c) => {
  const code = err instanceof LLMKitError ? err.code : 'INTERNAL_ERROR';
  const status = err instanceof LLMKitError ? err.statusCode : 500;

  const apiKeyId = c.get('apiKeyId');
  const userId = c.get('userId');
  if (apiKeyId && userId && c.env.SUPABASE_URL && c.env.SUPABASE_KEY) {
    const ctx = resolveErrorContext(c);
    await resolveModelFromBody(c, ctx);

    c.executionCtx.waitUntil(
      logRequest(c.env.SUPABASE_URL, c.env.SUPABASE_KEY, {
        user_id: userId,
        api_key_id: apiKeyId,
        session_id: c.req.header('x-llmkit-session-id') || null,
        end_user_id: c.req.header('x-llmkit-user-id') || null,
        provider: ctx.provider,
        model: ctx.model,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        cost_cents: 0,
        latency_ms: 0,
        status: 'error',
        error_code: code,
        source: 'proxy',
      }),
    );

    sendErrorNotifications(c.executionCtx, c.env, userId, apiKeyId, c.get('apiKey') || '???', code, ctx.model, ctx.provider);
  }

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
