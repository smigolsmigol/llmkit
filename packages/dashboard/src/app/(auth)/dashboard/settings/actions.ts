'use server';

import { auth } from '@clerk/nextjs/server';
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase';

const VALID_PERIODS = ['daily', 'weekly', 'monthly'] as const;
const VALID_SCOPES = ['key', 'session'] as const;
const NAME_PATTERN = /^[a-zA-Z0-9 -]+$/;

const recentBudgetOps = new Map<string, number[]>();

function checkBudgetRateLimit(userId: string): boolean {
  const now = Date.now();
  const hourAgo = now - 3600000;
  const timestamps = (recentBudgetOps.get(userId) ?? []).filter(t => t > hourAgo);
  if (timestamps.length >= 10) return false;
  timestamps.push(now);
  recentBudgetOps.set(userId, timestamps);
  return true;
}

export async function createBudget(
  name: string,
  limitCents: number,
  period: string,
  scope: string = 'key',
  alertWebhookUrl?: string,
) {
  const { userId } = await auth();
  if (!userId) throw new Error('Unauthorized');
  if (!checkBudgetRateLimit(userId)) throw new Error('Rate limit exceeded. Max 10 budget operations per hour.');

  if (!name || name.length > 100 || !NAME_PATTERN.test(name)) {
    throw new Error('Invalid budget name');
  }
  if (!VALID_PERIODS.includes(period as (typeof VALID_PERIODS)[number])) {
    throw new Error('Invalid period');
  }
  if (!VALID_SCOPES.includes(scope as (typeof VALID_SCOPES)[number])) {
    throw new Error('Invalid scope');
  }
  if (typeof limitCents !== 'number' || limitCents <= 0 || !Number.isFinite(limitCents)) {
    throw new Error('Invalid limit');
  }
  if (alertWebhookUrl) {
    try {
      const url = new URL(alertWebhookUrl);
      if (url.protocol !== 'https:') throw new Error();
    } catch {
      throw new Error('Webhook URL must be a valid https:// URL');
    }
  }

  const db = createServerClient();
  const { error } = await db.from('budgets').insert({
    user_id: userId,
    name,
    limit_cents: limitCents,
    period,
    scope,
    alert_webhook_url: alertWebhookUrl || null,
  });

  if (error) {
    console.error('createBudget failed:', error.message);
    throw new Error('Failed to create budget');
  }
  revalidatePath('/dashboard/settings');
}

export async function deleteBudget(budgetId: string) {
  const { userId } = await auth();
  if (!userId) throw new Error('Unauthorized');

  const db = createServerClient();

  // verify ownership
  const { data: budget } = await db
    .from('budgets')
    .select('user_id')
    .eq('id', budgetId)
    .single();

  if (!budget || budget.user_id !== userId) throw new Error('Budget not found');

  const { count: receiptCount, error: receiptError } = await db
    .from('requests')
    .select('id', { count: 'exact', head: true })
    .eq('budget_id', budgetId);

  if (receiptError) {
    console.error('deleteBudget receipt check failed:', receiptError.message);
    throw new Error('Failed to verify budget history');
  }
  if ((receiptCount ?? 0) > 0) {
    return { deleted: false as const, reason: 'receipt_history' as const };
  }

  const { count: keyCount, error: keyError } = await db
    .from('api_keys')
    .select('id', { count: 'exact', head: true })
    .eq('budget_id', budgetId);
  if (keyError) {
    console.error('deleteBudget key check failed:', keyError.message);
    throw new Error('Failed to verify budget assignments');
  }
  if ((keyCount ?? 0) > 0) {
    return { deleted: false as const, reason: 'active_keys' as const };
  }

  const { error } = await db.from('budgets').delete().eq('id', budgetId);

  if (error) {
    if (error.code === '23503') {
      const reason = error.message.includes('api_keys_budget_owner_fkey')
        ? 'active_keys' as const
        : 'receipt_history' as const;
      return { deleted: false as const, reason };
    }
    console.error('deleteBudget failed:', error.message);
    throw new Error('Failed to delete budget');
  }
  revalidatePath('/dashboard/settings');
  return { deleted: true as const };
}
