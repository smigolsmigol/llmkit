import { createMiddleware } from 'hono/factory';

export function costLogger() {
  return createMiddleware(async (c, next) => {
    const start = Date.now();
    const sessionId = c.req.header('x-llmkit-session-id');

    await next();

    const latency = Date.now() - start;
    const meta = c.get('llmkit_response') as Record<string, unknown> | undefined;
    if (!meta) return;

    const logEntry = {
      timestamp: new Date().toISOString(),
      sessionId,
      apiKey: (c.get('apiKey') as string)?.slice(0, 8) + '...', // never log full key
      provider: meta.provider,
      model: meta.model,
      latencyMs: latency,
      usage: meta.usage,
      cost: meta.cost,
    };

    // TODO: batch write to Supabase (don't block the response)
    // TODO: update budget counters in KV
    // for now, use cf workers console for observability
    console.log(JSON.stringify(logEntry));
  });
}
