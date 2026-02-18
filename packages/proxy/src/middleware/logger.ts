import { createMiddleware } from 'hono/factory';

export function costLogger() {
  return createMiddleware(async (c, next) => {
    const start = Date.now();
    const sessionId = c.req.header('x-llmkit-session-id');

    await next();

    const latency = Date.now() - start;

    // TODO: extract usage from response, calculate cost, log to supabase
    // TODO: update budget counters in KV (post-request)
    // TODO: group by sessionId for agent session tracking
  });
}
