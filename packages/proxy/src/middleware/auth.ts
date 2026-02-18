import { createMiddleware } from 'hono/factory';
import { AuthError } from '@llmkit/shared';
import type { Env } from '../env';
import { findApiKey } from '../db';

export function auth() {
  return createMiddleware<Env>(async (c, next) => {
    const raw = c.req.header('Authorization')?.replace('Bearer ', '');
    if (!raw) throw new AuthError();

    // dev mode: skip DB validation if Supabase isn't configured
    if (!c.env.SUPABASE_URL) {
      c.set('apiKey', raw.slice(0, 8) + '...');
      return await next();
    }

    const hash = await sha256(raw);
    const keyRecord = await findApiKey(c.env.SUPABASE_URL, c.env.SUPABASE_KEY, hash);
    if (!keyRecord) throw new AuthError();

    c.set('apiKey', keyRecord.key_prefix);
    c.set('apiKeyId', keyRecord.id);
    c.set('userId', keyRecord.user_id);

    // use API key's default budget if no per-request override
    if (keyRecord.budget_id) {
      c.set('budgetId', keyRecord.budget_id);
    }

    await next();
  });
}

async function sha256(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
