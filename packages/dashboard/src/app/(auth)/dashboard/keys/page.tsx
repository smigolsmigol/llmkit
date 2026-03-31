export const dynamic = 'force-dynamic';

import { auth } from '@clerk/nextjs/server';
import { getApiKeys, getBudgets } from '@/lib/queries';
import { formatDate } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { CreateKeyForm } from './create-key-form';
import { RevokeKeyButton } from '@/components/revoke-key-button';
import { KeyBudgetSelector } from '@/components/key-budget-selector';

export default async function KeysPage() {
  const { userId } = await auth();
  if (!userId) return null;

  let keys: Awaited<ReturnType<typeof getApiKeys>> = [];
  let budgets: Awaited<ReturnType<typeof getBudgets>> = [];
  let connected = true;

  try {
    [keys, budgets] = await Promise.all([getApiKeys(userId), getBudgets(userId)]);
  } catch {
    connected = false;
  }

  if (!connected) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold">API Keys</h1>
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-muted-foreground">
            Unable to load data. Please refresh to try again.
          </p>
        </div>
      </div>
    );
  }

  const budgetMap = new Map(budgets.map(b => [b.id, b]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">API Keys</h1>
        <CreateKeyForm budgets={budgets} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="px-4 py-2.5 font-medium">Key</th>
              <th className="px-4 py-2.5 font-medium">Created</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Budget</th>
              <th className="px-4 py-2.5 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => {
              const revoked = !!key.revoked_at;
              return (
                <tr key={key.id} className="border-b border-border/50 transition-colors hover:bg-secondary/50">
                  <td className="px-4 py-2.5">{key.name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                    {key.key_prefix}...
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{formatDate(key.created_at)}</td>
                  <td className="px-4 py-2.5">
                    <Badge variant={revoked ? 'destructive' : 'success'}>
                      {revoked ? 'Revoked' : 'Active'}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    {!revoked ? (
                      <KeyBudgetSelector keyId={key.id} currentBudgetId={key.budget_id} budgets={budgets} />
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {key.budget_id ? budgetMap.get(key.budget_id)?.name ?? '-' : '-'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {!revoked && <RevokeKeyButton keyId={key.id} keyName={key.name} />}
                  </td>
                </tr>
              );
            })}
            {keys.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                  No API keys yet. Create your first key to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}
