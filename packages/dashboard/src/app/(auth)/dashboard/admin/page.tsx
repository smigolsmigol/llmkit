export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { TimeRangeSelector } from '@/components/time-range-selector';
import { AnalyticsStatus } from '@/components/analytics-status';
import {
  getAccountPlan,
  getAdminProviderHealth,
  getAdminProviderSpend,
  getAdminRequestTimeseries,
  getAdminStatsTrend,
  getAdminTopModels,
  getAdminUserBreakdown,
  getAllAccounts,
} from '@/lib/queries';
import { AdminTabs } from './admin-tabs';

export const metadata: Metadata = { title: 'Admin - LLMKit' };

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; tab?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect('/dashboard');
  const plan = await getAccountPlan(userId);
  if (plan !== 'admin') redirect('/dashboard');

  const params = await searchParams;
  const days = params.days !== undefined ? Number(params.days) : 30;

  let accounts: Awaited<ReturnType<typeof getAllAccounts>>;
  let trend: Awaited<ReturnType<typeof getAdminStatsTrend>>;
  let timeseries: Awaited<ReturnType<typeof getAdminRequestTimeseries>>;
  let userBreakdown: Awaited<ReturnType<typeof getAdminUserBreakdown>>;
  let topModels: Awaited<ReturnType<typeof getAdminTopModels>>;
  let providerHealth: Awaited<ReturnType<typeof getAdminProviderHealth>>;
  let providerSpend: Awaited<ReturnType<typeof getAdminProviderSpend>>;

  try {
    [accounts, trend, timeseries, userBreakdown, topModels, providerHealth, providerSpend] = await Promise.all([
      getAllAccounts(),
      getAdminStatsTrend(days),
      getAdminRequestTimeseries(days),
      getAdminUserBreakdown(days),
      getAdminTopModels(days),
      getAdminProviderHealth(days),
      getAdminProviderSpend(days),
    ]);
  } catch {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold">Admin</h1>
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-muted-foreground">
            Unable to load data. Please refresh to try again.
          </p>
        </div>
      </div>
    );
  }

  const stats = trend.current;
  const totalTokens = stats.totalInputTokens + stats.totalOutputTokens;
  const activeUsers = userBreakdown.filter((u) => u.requests > 0).length;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Admin</h1>
        <TimeRangeSelector />
      </div>

      <AnalyticsStatus />

      <AdminTabs
        stats={stats}
        deltas={trend.deltas}
        totalTokens={totalTokens}
        activeUsers={activeUsers}
        timeseries={timeseries}
        providerSpend={providerSpend}
        providerHealth={providerHealth}
        topModels={topModels}
        userBreakdown={userBreakdown}
        accounts={accounts}
      />
    </div>
  );
}
