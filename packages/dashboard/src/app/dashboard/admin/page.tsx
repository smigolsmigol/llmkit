import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { getAllAccounts, getAdminStats, getAdminUserBreakdown, getAdminTopModels } from '@/lib/queries';
import { StatCard } from '@/components/stat-card';
import { formatCents } from '@/lib/format';
import { AccountTable } from './account-table';

export default async function AdminPage() {
  const { userId } = await auth();
  if (!userId || userId !== process.env.ADMIN_USER_ID) {
    redirect('/dashboard');
  }

  const [accounts, stats, userBreakdown, topModels] = await Promise.all([
    getAllAccounts(),
    getAdminStats(),
    getAdminUserBreakdown(),
    getAdminTopModels(),
  ]);

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Admin</h1>

      <div className="grid grid-cols-4 gap-4">
        <div className="glow-hover rounded-lg border border-primary/20 bg-card p-5">
          <p className="text-sm text-muted-foreground">Platform Spend</p>
          <p className="mt-1 font-mono text-3xl font-bold text-primary">
            {formatCents(stats.totalSpendCents)}
          </p>
        </div>
        <StatCard label="Total Requests" value={stats.totalRequests.toLocaleString()} />
        <StatCard label="Accounts" value={String(stats.totalAccounts)} />
        <StatCard label="Active Keys" value={String(stats.activeUsers)} />
      </div>

      {topModels.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Top Models</h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-secondary text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2">Model</th>
                  <th className="px-3 py-2">Provider</th>
                  <th className="px-3 py-2 text-right">Requests</th>
                  <th className="px-3 py-2 text-right">Spend</th>
                </tr>
              </thead>
              <tbody>
                {topModels.slice(0, 10).map((m) => (
                  <tr key={m.model} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-xs">{m.model}</td>
                    <td className="px-3 py-2 text-xs">{m.provider}</td>
                    <td className="px-3 py-2 text-right">{m.requests}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatCents(m.spendCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {userBreakdown.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Per-User Breakdown</h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-secondary text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">Plan</th>
                  <th className="px-3 py-2">Note</th>
                  <th className="px-3 py-2 text-right">Requests</th>
                  <th className="px-3 py-2 text-right">Spend</th>
                  <th className="px-3 py-2">Last Active</th>
                </tr>
              </thead>
              <tbody>
                {userBreakdown.map((u) => (
                  <tr key={u.userId} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-xs">{u.userId.slice(0, 16)}...</td>
                    <td className="px-3 py-2 text-xs">{u.plan}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{u.note || ''}</td>
                    <td className="px-3 py-2 text-right">{u.requests}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatCents(u.spendCents)}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {u.lastActive ? new Date(u.lastActive).toLocaleDateString() : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">
          Accounts ({accounts.length})
        </h2>
        <AccountTable accounts={accounts} />
      </div>
    </div>
  );
}
