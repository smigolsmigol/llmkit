import { createMiddleware } from 'hono/factory';
import { AuthError } from '@llmkit/shared';

export function auth() {
  return createMiddleware(async (c, next) => {
    const key = c.req.header('Authorization')?.replace('Bearer ', '');
    if (!key) throw new AuthError();

    // TODO: validate key against DB, attach key metadata to context
    c.set('apiKey', key);
    await next();
  });
}
