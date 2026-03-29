'use client';

import { useState, useTransition } from 'react';
import { createBudget, deleteBudget } from '@/app/dashboard/settings/actions';
import { Button } from '@/components/ui/button';
import type { BudgetRow } from '@/lib/queries';

interface BudgetManagerProps {
  budgets: BudgetRow[];
}

export function BudgetManager({ budgets }: BudgetManagerProps) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [limit, setLimit] = useState('');
  const [period, setPeriod] = useState('monthly');
  const [scope, setScope] = useState<'key' | 'session'>('key');
  const [alertUrl, setAlertUrl] = useState('');
  const [pending, startTransition] = useTransition();

  function handleCreate() {
    if (!name.trim() || !limit) return;
    const limitCents = Math.round(parseFloat(limit) * 100);
    if (isNaN(limitCents) || limitCents <= 0) return;

    startTransition(async () => {
      await createBudget(name.trim(), limitCents, period, scope, alertUrl.trim() || undefined);
      setName('');
      setLimit('');
      setScope('key');
      setAlertUrl('');
      setCreating(false);
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteBudget(id);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">Budgets</h2>
        {!creating && (
          <Button size="sm" onClick={() => setCreating(true)} className="bg-violet-600 text-white hover:bg-violet-500">
            + Add Budget
          </Button>
        )}
      </div>

      {creating && (
        <div className="rounded-lg border border-border bg-background p-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Production"
                className="w-full rounded-md border border-border bg-secondary px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Limit ($)</label>
              <input
                type="number"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                placeholder="100.00"
                min="0"
                step="0.01"
                className="w-full rounded-md border border-border bg-secondary px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Period</label>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="w-full rounded-md border border-border bg-secondary px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Scope</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setScope('key')}
                  className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                    scope === 'key'
                      ? 'bg-primary/10 text-primary border border-primary/30'
                      : 'bg-secondary text-muted-foreground border border-border'
                  }`}
                >
                  Per Key
                </button>
                <button
                  type="button"
                  onClick={() => setScope('session')}
                  className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                    scope === 'session'
                      ? 'bg-primary/10 text-primary border border-primary/30'
                      : 'bg-secondary text-muted-foreground border border-border'
                  }`}
                >
                  Per Session
                </button>
              </div>
              {scope === 'session' && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Limits spending per agent session (x-llmkit-session-id)
                </p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Alert webhook (optional)</label>
              <input
                value={alertUrl}
                onChange={(e) => setAlertUrl(e.target.value)}
                placeholder="https://hooks.slack.com/..."
                className="w-full rounded-md border border-border bg-secondary px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                POST when budget hits 80%
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>Cancel</Button>
            <Button size="sm" onClick={handleCreate} disabled={pending}>
              {pending ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {budgets.map((b) => (
          <div key={b.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="font-medium">{b.name}</p>
              <span className="rounded bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                {b.period}
              </span>
            </div>
            <p className="mt-2 font-mono text-lg font-semibold">
              ${(b.limit_cents / 100).toFixed(2)}
            </p>
            <div className="mt-3 flex justify-end">
              <button
                onClick={() => handleDelete(b.id)}
                disabled={pending}
                className="text-xs text-muted-foreground transition-colors hover:text-red-400"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        {budgets.length === 0 && !creating && (
          <p className="col-span-full text-sm text-muted-foreground">
            No budgets configured. Add one to set spending limits.
          </p>
        )}
      </div>
    </div>
  );
}
