import { type ProviderName, ValidationError } from '@f3d1/llmkit-shared';
import { Hono } from 'hono';
import { encrypt } from '../crypto';
import { listProviderKeys, revokeProviderKey, storeProviderKey } from '../db';
import type { Env } from '../env';

const VALID_PROVIDERS = new Set<string>([
  'anthropic', 'openai', 'gemini', 'groq', 'together',
  'fireworks', 'deepseek', 'mistral', 'xai', 'ollama', 'openrouter',
]);

function keyPrefix(key: string): string {
  if (key.length <= 8) return `${key.slice(0, 3)}...`;
  return `${key.slice(0, 7)}...${key.slice(-4)}`;
}

export const keysRouter = new Hono<Env>();

keysRouter.post('/provider-keys', async (c) => {
  const userId = c.get('userId');
  if (!userId) throw new ValidationError('authenticated user required to manage provider keys');

  if (!c.env.ENCRYPTION_KEY || !c.env.SUPABASE_URL || !c.env.SUPABASE_KEY) {
    return c.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'key vault not configured' } }, 503);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    throw new ValidationError('invalid JSON body');
  }
  const { provider, key, name } = body as { provider?: string; key?: string; name?: string };

  if (!provider || !VALID_PROVIDERS.has(provider)) {
    throw new ValidationError(`provider must be one of: ${[...VALID_PROVIDERS].join(', ')}`);
  }
  if (!key || typeof key !== 'string' || key.length < 8) {
    throw new ValidationError('key is required and must be at least 8 characters');
  }

  const keyName = name || 'default';
  const context = `${userId}:${provider}`;
  const { ciphertext, iv } = await encrypt(key, c.env.ENCRYPTION_KEY, context);

  const id = crypto.randomUUID();
  await storeProviderKey(c.env.SUPABASE_URL, c.env.SUPABASE_KEY, {
    id,
    user_id: userId,
    provider: provider as ProviderName,
    encrypted_key: ciphertext,
    iv,
    key_prefix: keyPrefix(key),
    key_name: keyName,
  });

  return c.json({
    id,
    provider,
    key_prefix: keyPrefix(key),
    key_name: keyName,
  }, 201);
});

keysRouter.get('/provider-keys', async (c) => {
  const userId = c.get('userId');
  if (!userId) throw new ValidationError('authenticated user required to manage provider keys');

  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_KEY) {
    return c.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'key vault not configured' } }, 503);
  }

  const keys = await listProviderKeys(c.env.SUPABASE_URL, c.env.SUPABASE_KEY, userId);
  return c.json({ keys });
});

keysRouter.delete('/provider-keys/:id', async (c) => {
  const userId = c.get('userId');
  if (!userId) throw new ValidationError('authenticated user required to manage provider keys');

  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_KEY) {
    return c.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'key vault not configured' } }, 503);
  }

  const keyId = c.req.param('id');
  await revokeProviderKey(c.env.SUPABASE_URL, c.env.SUPABASE_KEY, keyId, userId);
  return c.json({ revoked: true });
});
