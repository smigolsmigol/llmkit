import { RateLimitError } from '@llmkit/shared';
import { createMiddleware } from 'hono/factory';
import type { Env } from '../env';

const DEFAULT_RPM = 60;

export function rateLimit() {
  return createMiddleware<Env>(async (c, next) => {
    const apiKey = c.get('apiKey');
    if (!apiKey) return await next();

    const minute = Math.floor(Date.now() / 60_000);
    const kvKey = `rl:${apiKey}:${minute}`;

    const raw = await c.env.RATE_LIMIT.get(kvKey);
    const count = raw ? parseInt(raw, 10) : 0;

    // TODO: per-key RPM limits from API key record
    const limit = DEFAULT_RPM;

    if (count >= limit) {
      const secondsLeft = 60 - (Math.floor(Date.now() / 1000) % 60);
      c.header('Retry-After', String(secondsLeft));
      c.header('X-RateLimit-Limit', String(limit));
      c.header('X-RateLimit-Remaining', '0');
      throw new RateLimitError(secondsLeft * 1000);
    }

    // increment counter, 120s TTL covers current + next window
    await c.env.RATE_LIMIT.put(kvKey, String(count + 1), { expirationTtl: 120 });

    c.header('X-RateLimit-Limit', String(limit));
    c.header('X-RateLimit-Remaining', String(limit - count - 1));

    await next();
  });
}
