'use server';

import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase';
import { revalidatePath } from 'next/cache';

export async function createApiKey(name: string) {
  const { userId } = await auth();
  if (!userId) throw new Error('Unauthorized');

  if (!name || name.length > 100) throw new Error('Key name must be 1-100 characters');
  if (!/^[\w\s\-.]+$/.test(name)) throw new Error('Key name contains invalid characters');

  const array = new Uint8Array(32);
  globalThis.crypto.getRandomValues(array);
  const raw = Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
  const prefix = `llmk_${raw.slice(0, 8)}`;
  const fullKey = `llmk_${raw}`;

  const encoder = new TextEncoder();
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(fullKey));
  const hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

  const db = createServerClient();
  const { error } = await db.from('api_keys').insert({
    user_id: userId,
    name,
    key_prefix: prefix,
    key_hash: hash,
  });

  if (error) {
    console.error('createApiKey failed:', error.message);
    throw new Error('Failed to create API key');
  }

  revalidatePath('/dashboard/keys');
  return { key: fullKey, prefix };
}

export async function revokeApiKey(keyId: string) {
  const { userId } = await auth();
  if (!userId) throw new Error('Unauthorized');

  const db = createServerClient();

  const { data: key } = await db
    .from('api_keys')
    .select('user_id')
    .eq('id', keyId)
    .single();

  if (!key || key.user_id !== userId) throw new Error('Key not found');

  const { error } = await db
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId);

  if (error) {
    console.error('revokeApiKey failed:', error.message);
    throw new Error('Failed to revoke API key');
  }

  revalidatePath('/dashboard/keys');
}
