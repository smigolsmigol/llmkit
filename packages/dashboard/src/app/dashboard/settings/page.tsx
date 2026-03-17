export const dynamic = 'force-dynamic';

import { auth } from '@clerk/nextjs/server';
import { getBudgets, getAccount } from '@/lib/queries';
import { BudgetManager } from '@/components/budget-manager';
import { McpSetup } from '@/components/mcp-setup';

const planLabels: Record<string, string> = {
  free: 'Free',
  beta: 'Beta Tester',
  pro: 'Pro',
  enterprise: 'Enterprise',
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
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Settings</h1>

      {!connected ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-muted-foreground">
            Supabase not connected. Add env vars to .env.local
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-muted-foreground">Plan</h2>
            <div className="rounded-lg border border-border bg-card p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-semibold">{planName}</p>
                  {account?.plan === 'beta' && !expires && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      Lifetime access - all features, no limits
                    </p>
                  )}
                  {expires && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      Expires {expires}
                    </p>
                  )}
                  {account?.note && (
                    <p className="mt-1 text-xs text-muted-foreground">{account.note}</p>
                  )}
                </div>
              </div>

              {(account?.plan === 'free' || !account?.plan) && (
                <div className="mt-4 rounded-md bg-secondary/50 p-4">
                  <p className="text-sm font-medium">Free during beta</p>
                  <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                    <li>Unlimited API requests</li>
                    <li>All 11 providers (OpenAI, Anthropic, Gemini, ...)</li>
                    <li>Budget enforcement and cost tracking</li>
                    <li>No credit card required</li>
                  </ul>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Paid plans coming soon. You bring your own provider API keys, so
                    you only pay the AI providers directly.
                  </p>
                </div>
              )}
            </div>
          </div>

          <BudgetManager budgets={budgets} />

          <McpSetup />

          <div className="space-y-4">
            <h2 className="text-sm font-medium text-muted-foreground">Account</h2>
            <div className="rounded-lg border border-border bg-card p-6">
              <p className="text-xs text-muted-foreground">User ID</p>
              <code className="mt-1 block font-mono text-sm text-primary">{userId}</code>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
