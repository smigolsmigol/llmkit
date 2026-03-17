export const dynamic = 'force-dynamic';

import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { getAccountPlan } from '@/lib/queries';
import { AnalyticsView } from './analytics-view';

export default async function AdminAnalyticsPage() {
  const { userId } = await auth();
  if (!userId) redirect('/dashboard');
  const plan = await getAccountPlan(userId);
  if (plan !== 'admin') redirect('/dashboard');

  return <AnalyticsView />;
}
