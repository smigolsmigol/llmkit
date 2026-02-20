import { auth } from '@clerk/nextjs/server';
import { getTotalSpend, getSpendByProvider, getDailySpend, getRecentRequests } from '@/lib/queries';
import { StatCard } from '@/components/stat-card';
import { CostChart } from '@/components/charts/cost-chart';
import { ProviderChart } from '@/components/charts/provider-chart';
import { RequestFeed } from '@/components/request-feed';
import { formatCents } from '@/lib/format';

export default async function OverviewPage() {
  const { userId } = await auth();
  if (!userId) return null;

  const [spend, providers, dailySpend, recent] = await Promise.all([
    getTotalSpend(userId),
    getSpendByProvider(userId),
    getDailySpend(userId, 30),
    getRecentRequests(userId, 10),
  ]);

  const chartData = dailySpend.map((d) => ({
    date: d.date,
    cost: d.costCents / 100,
  }));

  const providerData = providers
    .map((p) => ({
      provider: p.provider,
      cost: p.totalCostCents / 100,
      count: p.count,
    }))
    .sort((a, b) => b.cost - a.cost);

  const totalRequests = providers.reduce((sum, p) => sum + p.count, 0);

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Overview</h1>

      <div className="grid grid-cols-4 gap-4">
        <div className="glow-hover rounded-lg border border-primary/20 bg-card p-5">
          <p className="text-sm text-muted-foreground">Total Spend (30d)</p>
          <p className="mt-1 font-mono text-3xl font-bold text-primary">
            {formatCents(spend.month)}
          </p>
        </div>
        <StatCard label="Today" value={formatCents(spend.today)} />
        <StatCard label="This Week" value={formatCents(spend.week)} />
        <StatCard label="Total Requests" value={totalRequests.toLocaleString()} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 rounded-lg border border-border bg-card p-5">
          <h2 className="mb-4 text-sm font-medium text-muted-foreground">Daily Spend</h2>
          <CostChart data={chartData} />
        </div>
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="mb-4 text-sm font-medium text-muted-foreground">By Provider</h2>
          <ProviderChart data={providerData} />
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Recent Requests</h2>
        <RequestFeed requests={recent} />
      </div>
    </div>
  );
}
