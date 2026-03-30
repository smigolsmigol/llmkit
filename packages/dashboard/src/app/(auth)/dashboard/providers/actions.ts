'use server';

import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase';

const VALID_PROVIDERS = [
  'openai', 'anthropic', 'gemini', 'groq', 'together',
  'fireworks', 'deepseek', 'mistral', 'xai', 'ollama', 'openrouter',
];

function keyPrefix(key: string): string {
  if (key.length <= 8) return `${key.slice(0, 3)}...`;
  return `${key.slice(0, 7)}...${key.slice(-4)}`;
}

async function encryptKey(plaintext: string, encryptionKey: string, context: string) {
  const keyBytes = Uint8Array.from(atob(encryptionKey), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(context) },
    cryptoKey,
    encoded,
  );
  const toBase64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  return { ciphertext: toBase64(cipherBuf), iv: toBase64(iv.buffer) };
}

export async function addProviderKey(provider: string, key: string, name?: string) {
  const { userId } = await auth();
  if (!userId) throw new Error('not authenticated');

  if (!VALID_PROVIDERS.includes(provider)) {
    throw new Error(`invalid provider: ${provider}`);
  }
  if (!key || key.length < 8) {
    throw new Error('key must be at least 8 characters');
  }

  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) throw new Error('encryption not configured');

  const context = `${userId}:${provider}`;
  const { ciphertext, iv } = await encryptKey(key, encryptionKey, context);

  const db = createServerClient();
  const { error } = await db.from('provider_keys').insert({
    id: crypto.randomUUID(),
    user_id: userId,
    provider,
    encrypted_key: ciphertext,
    iv,
    key_prefix: keyPrefix(key),
    key_name: name || 'default',
  });

  if (error) throw new Error('failed to store key');
}

export async function revokeProviderKey(keyId: string) {
  const { userId } = await auth();
  if (!userId) throw new Error('not authenticated');

  const db = createServerClient();
  const { error } = await db
    .from('provider_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId)
    .eq('user_id', userId);

  if (error) throw new Error('failed to revoke key');
}
