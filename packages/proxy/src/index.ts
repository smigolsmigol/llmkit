import { LLMKitError } from '@f3d1/llmkit-shared';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Env } from './env';
import { auth } from './middleware/auth';
import { budgetCheck } from './middleware/budget';
import { costLogger } from './middleware/logger';
import { rateLimit } from './middleware/ratelimit';
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

app.onError((err, c) => {
  if (err instanceof LLMKitError) {
    return c.json(
      { error: { code: err.code, message: err.message } },
      err.statusCode as ContentfulStatusCode,
    );
  }
  console.error('unhandled:', err);
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } }, 500);
});

app.get('/health', (c) => c.json({ status: 'ok', version: '0.0.1' }));

app.use('/v1/*', auth());
app.use('/v1/*', rateLimit());
app.use('/v1/*', budgetCheck());
app.use('/v1/*', costLogger());

app.route('/v1', providerRouter);
app.route('/v1', keysRouter);

// MCP endpoint: auth only, no budget/rate-limit (read-only queries)
app.use('/mcp/*', auth());
app.route('/mcp', mcpRouter);

export default app;
