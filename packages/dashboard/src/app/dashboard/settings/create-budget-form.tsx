'use client';

import { useState } from 'react';
import { createBudget } from './actions';

export function CreateBudgetForm() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [name, setName] = useState('');
  const [limit, setLimit] = useState('');
  const [period, setPeriod] = useState('monthly');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !limit) return;

    const limitDollars = parseFloat(limit);
    if (isNaN(limitDollars) || limitDollars <= 0) {
      setError('Limit must be a positive number');
      return;
    }

    setPending(true);
    setError(null);
    try {
      await createBudget(name.trim(), Math.round(limitDollars * 100), period);
      setOpen(false);
      setName('');
      setLimit('');
      setPeriod('monthly');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create budget');
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Create Budget
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="mx-4 w-full max-w-md rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold">Create Budget</h2>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label htmlFor="budget-name" className="mb-1.5 block text-sm text-muted-foreground">
              Name
            </label>
            <input
              id="budget-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Production limit"
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label htmlFor="budget-limit" className="mb-1.5 block text-sm text-muted-foreground">
              Limit (USD)
            </label>
            <input
              id="budget-limit"
              type="number"
              step="0.01"
              min="0.01"
              required
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              placeholder="100.00"
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label htmlFor="budget-period" className="mb-1.5 block text-sm text-muted-foreground">
              Period
            </label>
            <select
              id="budget-period"
              required
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setOpen(false); setError(null); }}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {pending ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
