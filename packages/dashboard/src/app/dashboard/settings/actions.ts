'use server';

import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase';
import { revalidatePath } from 'next/cache';

const VALID_PERIODS = ['daily', 'weekly', 'monthly'] as const;
const VALID_SCOPES = ['key', 'session'] as const;
const NAME_PATTERN = /^[a-zA-Z0-9 -]+$/;

export async function createBudget(
  name: string,
  limitCents: number,
  period: string,
  scope: string = 'key',
  alertWebhookUrl?: string,
) {
  const { userId } = await auth();
  if (!userId) throw new Error('Unauthorized');

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

  const { error } = await db.from('budgets').delete().eq('id', budgetId);

  if (error) {
    console.error('deleteBudget failed:', error.message);
    throw new Error('Failed to delete budget');
  }
  revalidatePath('/dashboard/settings');
}
