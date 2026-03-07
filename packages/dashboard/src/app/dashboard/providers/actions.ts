'use server';

import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase';

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
