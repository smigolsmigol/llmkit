'use server';

import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase';
import { revalidatePath } from 'next/cache';

export async function createBudget(
  name: string,
  limitCents: number,
  period: string,
  scope: string = 'key',
  alertWebhookUrl?: string,
) {
  const { userId } = await auth();
  if (!userId) throw new Error('Unauthorized');

  const db = createServerClient();
  const { error } = await db.from('budgets').insert({
    user_id: userId,
    name,
    limit_cents: limitCents,
    period,
    scope,
    alert_webhook_url: alertWebhookUrl || null,
  });

  if (error) throw new Error(error.message);
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

  if (error) throw new Error(error.message);
  revalidatePath('/dashboard/settings');
}
