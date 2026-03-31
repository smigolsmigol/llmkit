import { AuthError } from '@f3d1/llmkit-shared';
import { createMiddleware } from 'hono/factory';
import { findApiKey } from '../db';
import type { Env } from '../env';

export function auth() {
  return createMiddleware<Env>(async (c, next) => {
    const authHeader = c.req.header('Authorization') || '';
    const raw = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!raw) throw new AuthError();

    const devMode = c.env.DEV_MODE === 'true';
    if (devMode && c.env.SUPABASE_URL) {
      console.warn('[llmkit] DEV_MODE ignored: SUPABASE_URL is set, running in production mode');
    }

    if (!c.env.SUPABASE_URL || !c.env.SUPABASE_KEY) {
      if (!devMode) {
        throw new Error('SUPABASE_URL/SUPABASE_KEY not set. Set DEV_MODE=true to bypass auth in development.');
      }
      console.warn('[llmkit] DEV_MODE: auth bypassed, do not use in production');
      c.set('apiKey', `${raw.slice(0, 8)}...`);
      return await next();
    }

    const hash = await sha256(raw);
    const keyRecord = await findApiKey(c.env.SUPABASE_URL, c.env.SUPABASE_KEY, hash);
    if (!keyRecord) throw new AuthError();

    c.set('apiKey', keyRecord.key_prefix);
    c.set('apiKeyId', keyRecord.id);
    c.set('userId', keyRecord.user_id);

    if (keyRecord.budget_id) {
      c.set('budgetId', keyRecord.budget_id);
      if (keyRecord.budgets) {
        c.set('budgetConfig', {
          limitCents: keyRecord.budgets.limit_cents,
          period: keyRecord.budgets.period,
          scope: keyRecord.budgets.scope,
          alertWebhookUrl: keyRecord.budgets.alert_webhook_url,
        });
      }
    }
    if (keyRecord.rpm_limit) {
      c.set('rpmLimit', keyRecord.rpm_limit);
    }

    await next();
  });
}

async function sha256(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
