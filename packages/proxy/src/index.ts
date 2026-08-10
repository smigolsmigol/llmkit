import { inferProvider, LLMKitError } from '@f3d1/llmkit-shared';
import { type Context, Hono, type ExecutionContext as HonoExecutionContext } from 'hono';
import { cors } from 'hono/cors';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { supabaseServiceHeaders } from './db';
import type { Env } from './env';
import { auth } from './middleware/auth';
import { budgetCheck } from './middleware/budget';
import { idempotency } from './middleware/idempotency';
import { costLogger, trackFailedRequest } from './middleware/logger';
import { rateLimit } from './middleware/ratelimit';
import { requestEvidence } from './middleware/request-evidence';
import { formatErrorStreak, formatNewUser, formatRequestLog, notifyTelegram } from './notify';
import { analyticsRouter } from './routes/analytics';
import { providerRouter } from './routes/chat';
import { keysRouter } from './routes/keys';
import { mcpRouter } from './routes/mcp';
import { pricingRouter } from './routes/pricing';
import { responsesRouter } from './routes/responses';

export { BudgetDO } from './do/budget-do';
export { IdempotencyDO } from './do/idempotency-do';
export { RateLimitDO } from './do/ratelimit-do';

function sanitizeHeader(value: string | undefined, pattern: RegExp): string | null {
  if (!value) return null;
  return pattern.test(value) ? value : null;
}

// per-isolate cache (warm-start dedup only, DB is source of truth)
const notifiedUsers = new Set<string>();

async function hasExistingRequests(supabaseUrl: string, supabaseKey: string, apiKeyId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/requests?select=id&api_key_id=eq.${encodeURIComponent(apiKeyId)}&limit=1`,
      { headers: supabaseServiceHeaders(supabaseKey) },
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
  ctx: HonoExecutionContext,
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
  allowHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'x-llmkit-provider', 'x-llmkit-provider-key', 'x-llmkit-fallback', 'x-llmkit-customer-id', 'x-llmkit-workflow-id', 'x-llmkit-agent-id', 'x-llmkit-session-id', 'x-llmkit-user-id', 'x-llmkit-format', 'x-llmkit-revenue', 'x-llmkit-revenue-token'],
  exposeHeaders: ['Idempotency-Key', 'x-llmkit-idempotency-status', 'x-llmkit-request-id', 'x-llmkit-cost', 'x-llmkit-provider', 'x-llmkit-latency-ms', 'x-llmkit-session-id', 'x-llmkit-user-id', 'x-llmkit-provider-cost', 'x-llmkit-extra-costs', 'x-llmkit-margin', 'x-llmkit-settlement-status', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After'],
  allowMethods: ['POST', 'GET', 'DELETE', 'OPTIONS'],
}));

export async function handleAppError(err: Error, c: Context<Env>): Promise<Response> {
  const code = err instanceof LLMKitError ? err.code : 'INTERNAL_ERROR';
  const status = err instanceof LLMKitError ? err.statusCode : 500;

  const apiKeyId = c.get('apiKeyId');
  const userId = c.get('userId');
  const ctx = resolveErrorContext(c);
  await resolveModelFromBody(c, ctx);
  await trackFailedRequest({
    requestId: c.get('requestId'),
    customerId: c.get('customerId'),
    workflowId: c.get('workflowId'),
    agentId: c.get('agentId'),
    sessionId: c.get('sessionId') || sanitizeHeader(c.req.header('x-llmkit-session-id'), /^[\w-]{1,128}$/) || undefined,
    endUserId: c.get('endUserId') || sanitizeHeader(c.req.header('x-llmkit-user-id'), /^[\w@.+-]{1,256}$/) || undefined,
    idempotencyKeyHash: c.get('idempotencyKeyHash'),
    apiKeyId,
    userId,
    budgetId: c.get('budgetId'),
    budgetReservationId: c.get('budgetReservationId'),
    provider: ctx.provider,
    model: ctx.model,
    errorCode: code,
    env: c.env,
    ctx: c.executionCtx,
  });

  if (apiKeyId && userId && c.env.SUPABASE_URL && c.env.SUPABASE_KEY) {
    sendErrorNotifications(c.executionCtx, c.env, userId, apiKeyId, c.get('apiKey') || '???', code, ctx.model, ctx.provider);
  }

  if (!(err instanceof LLMKitError)) console.error('unhandled:', err);
  return c.json(
    { error: { code, message: err instanceof LLMKitError ? err.message : 'Something went wrong' } },
    status as ContentfulStatusCode,
  );
}

app.onError(handleAppError);

app.get('/health', (c) => c.json({ status: 'ok', version: '0.0.1' }));

// public pricing API (no auth required)
app.route('/v1', pricingRouter);

app.use('/v1/*', auth());
app.use('/v1/*', requestEvidence());
app.use('/v1/*', idempotency());
app.use('/v1/*', rateLimit());
app.use('/v1/*', budgetCheck());
app.use('/v1/*', costLogger());

app.route('/v1', providerRouter);
app.route('/v1', responsesRouter);
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
