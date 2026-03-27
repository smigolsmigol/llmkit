'use server';

import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase';
import { revalidatePath } from 'next/cache';

async function assertAdmin(userId: string | null) {
  if (!userId) throw new Error('Unauthorized');
  const db = createServerClient();
  const { data } = await db.from('accounts').select('plan').eq('user_id', userId).single();
  if (data?.plan !== 'admin') throw new Error('Unauthorized');
}

const VALID_PLANS = ['free', 'beta', 'pro', 'enterprise', 'admin'] as const;

export async function updateAccount(
  targetUserId: string,
  plan: string,
  expiresAt: string | null,
  note: string,
) {
  const { userId } = await auth();
  await assertAdmin(userId);

  if (!VALID_PLANS.includes(plan as (typeof VALID_PLANS)[number])) {
    throw new Error('Invalid plan');
  }

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

  if (error) {
    console.error('admin updateAccount failed:', error.message);
    throw new Error('Failed to update account');
  }
  revalidatePath('/dashboard/admin');
}
