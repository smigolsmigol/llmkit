import { RateLimitError } from '@llmkit/shared';
import { createMiddleware } from 'hono/factory';
import type { Env } from '../env';

const DEFAULT_RPM = 60;

export function rateLimit() {
  return createMiddleware<Env>(async (c, next) => {
    const apiKey = c.get('apiKey');
    if (!apiKey) return await next();

    const stub = c.env.RATE_LIMIT_DO.get(c.env.RATE_LIMIT_DO.idFromName(apiKey));
    // TODO: per-key RPM limits from API key record
    const result = await stub.hit({ limit: DEFAULT_RPM });

    c.header('X-RateLimit-Limit', String(result.limit));
    c.header('X-RateLimit-Remaining', String(result.remaining));

    if (!result.allowed) {
      c.header('Retry-After', String(result.retryAfterSeconds));
      throw new RateLimitError((result.retryAfterSeconds ?? 60) * 1000);
    }

    await next();
  });
}
