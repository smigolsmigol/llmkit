'use server';

import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase';
import { revalidatePath } from 'next/cache';

function assertAdmin(userId: string | null) {
  if (!userId || userId !== process.env.ADMIN_USER_ID) {
    throw new Error('Unauthorized');
  }
}

export async function updateAccount(
  targetUserId: string,
  plan: string,
  expiresAt: string | null,
  note: string,
) {
  const { userId } = await auth();
  assertAdmin(userId);

  const db = createServerClient();
  const { error } = await db
    .from('accounts')
    .update({
      plan,
      plan_expires_at: expiresAt || null,
      note: note || null,
      granted_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', targetUserId);

  if (error) throw new Error(error.message);
  revalidatePath('/dashboard/admin');
}
