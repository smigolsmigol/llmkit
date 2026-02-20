import { auth } from '@clerk/nextjs/server';
import { getBudgets } from '@/lib/queries';
import { BudgetManager } from '@/components/budget-manager';

export default async function SettingsPage() {
  const { userId } = await auth();
  if (!userId) return null;

  let budgets: Awaited<ReturnType<typeof getBudgets>> = [];
  let connected = true;

  try {
    budgets = await getBudgets(userId);
  } catch {
    connected = false;
  }

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
          <BudgetManager budgets={budgets} />

          <div className="space-y-4">
            <h2 className="text-sm font-medium text-muted-foreground">Account</h2>
            <div className="rounded-lg border border-border bg-card p-6">
              <p className="text-sm text-muted-foreground">
                Account settings and provider key management coming soon.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
