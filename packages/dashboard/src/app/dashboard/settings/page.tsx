export const dynamic = 'force-dynamic';

import { auth } from '@clerk/nextjs/server';
import { getBudgets, getAccount } from '@/lib/queries';
import { BudgetManager } from '@/components/budget-manager';


const planLabels: Record<string, string> = {
  free: 'Free',
  beta: 'Beta Tester',
  pro: 'Pro',
  enterprise: 'Enterprise',
  admin: 'Admin',
};

export default async function SettingsPage() {
  const { userId } = await auth();
  if (!userId) return null;

  let budgets: Awaited<ReturnType<typeof getBudgets>> = [];
  let connected = true;
  let account: Awaited<ReturnType<typeof getAccount>> = null;

  try {
    [budgets, account] = await Promise.all([
      getBudgets(userId),
      getAccount(userId),
    ]);
  } catch {
    connected = false;
  }

  const planName = planLabels[account?.plan || 'free'] || account?.plan || 'Free';
  const expires = account?.plan_expires_at
    ? new Date(account.plan_expires_at).toLocaleDateString()
    : null;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>

      {!connected ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-zinc-500">
            Unable to load data. Please refresh to try again.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* plan card */}
          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="mb-4 text-xs font-medium uppercase tracking-wider text-zinc-500">Plan</h2>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-violet-400"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/></svg>
              </div>
              <div>
                <p className="text-lg font-semibold">{planName}</p>
                {account?.plan === 'beta' && !expires && (
                  <p className="text-sm text-zinc-500">Lifetime access</p>
                )}
                {expires && (
                  <p className="text-sm text-zinc-500">Expires {expires}</p>
                )}
              </div>
            </div>
            {account?.note && (
              <p className="mt-3 text-xs text-zinc-500">{account.note}</p>
            )}
            {(account?.plan === 'free' || !account?.plan) && (
              <div className="mt-5 rounded-lg bg-violet-500/5 border border-violet-500/10 p-4">
                <p className="text-sm font-medium text-violet-400">Free during beta</p>
                <p className="mt-2 text-xs leading-relaxed text-zinc-400">
                  Unlimited requests, all 11 providers, budget enforcement, no credit card.
                  You bring your own provider API keys.
                </p>
              </div>
            )}
          </div>

          {/* account card */}
          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="mb-4 text-xs font-medium uppercase tracking-wider text-zinc-500">Account</h2>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-violet-400"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              </div>
              <div>
                <p className="text-xs text-zinc-500">User ID</p>
                <code className="mt-0.5 block font-mono text-sm text-violet-400">{userId}</code>
              </div>
            </div>
          </div>

          {/* budgets - full width */}
          <div className="lg:col-span-2 rounded-xl border border-border bg-card p-6">
            <BudgetManager budgets={budgets} />
          </div>

          {/* MCP link */}
          <div className="lg:col-span-2">
            <div className="rounded-xl border border-border bg-card p-6">
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">MCP Server</h2>
              <p className="text-sm text-zinc-400">
                Track costs from Claude Code, Cursor, or Cline. Local tools work without an API key.
              </p>
              <a href="/mcp" className="mt-3 inline-block text-sm text-violet-400 hover:text-violet-300 transition">
                Setup guide and all 14 tools {'\u2192'}
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
