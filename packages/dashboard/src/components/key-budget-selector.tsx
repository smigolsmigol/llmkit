'use client';

import { useState, useTransition } from 'react';
import { updateKeyBudget } from '@/app/(auth)/dashboard/keys/actions';

interface Budget {
  id: string;
  name: string;
  limit_cents: number;
  period: string;
}

export function KeyBudgetSelector({ keyId, currentBudgetId, budgets }: {
  keyId: string;
  currentBudgetId: string | null;
  budgets: Budget[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  function handleChange(value: string) {
    setError(false);
    startTransition(async () => {
      try {
        await updateKeyBudget(keyId, value || null);
      } catch {
        setError(true);
      }
    });
  }

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={currentBudgetId ?? ''}
        onChange={(e) => handleChange(e.target.value)}
        disabled={pending}
        className={`h-7 rounded border bg-secondary px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 ${error ? 'border-red-500' : 'border-border'}`}
      >
        <option value="">None</option>
        {budgets.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name} (${(b.limit_cents / 100).toFixed(2)}/{b.period})
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-red-400">Failed</span>}
    </div>
  );
}
